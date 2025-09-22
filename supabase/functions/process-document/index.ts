import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openAIApiKey = Deno.env.get('OPENAI_API_KEY')!;
const unstructuredApiKey = Deno.env.get('UNSTRUCTURED_API_KEY');

const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let documentId: string;
  let filePath: string;

  try {
    const body = await req.json();
    documentId = body.documentId;
    filePath = body.filePath;
    
    console.log(`Processing document ${documentId} at path ${filePath}`);
    console.log(`Unstructured API key available: ${!!unstructuredApiKey}`);

    // Update status to processing
    await supabase
      .from('documents')
      .update({ upload_status: 'processing' })
      .eq('id', documentId);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(filePath);

    if (downloadError) {
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    // Convert file to Markdown using Unstructured.io
    console.log('Converting file to Markdown using Unstructured.io...');
    const markdownContent = await convertToMarkdownWithUnstructured(fileData, filePath);
    
    if (!markdownContent || markdownContent.trim().length === 0) {
      throw new Error('No content could be extracted from the file');
    }

    console.log(`Extracted Markdown length: ${markdownContent.length} characters`);

    // Chunk the Markdown content with semantic chunking
    const chunks = chunkMarkdown(markdownContent, 1000, 200);
    
    console.log(`Extracted ${markdownContent.length} characters, created ${chunks.length} chunks`);

    // Process chunks in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchPromises = batch.map(async (chunk, index) => {
        try {
          // Generate embedding
          const embedding = await generateEmbedding(chunk.content);
          
          // Store chunk with embedding
          const { error: insertError } = await supabase
            .from('document_chunks')
            .insert({
              document_id: documentId,
              chunk_index: i + index,
              content: chunk.content,
              token_count: estimateTokens(chunk.content),
              embedding: embedding,
              metadata: {
                start_char: chunk.startIndex,
                end_char: chunk.endIndex,
              }
            });

          if (insertError) {
            console.error(`Failed to insert chunk ${i + index}:`, insertError);
          }
        } catch (chunkError) {
          console.error(`Failed to process chunk ${i + index}:`, chunkError);
        }
      });

      await Promise.all(batchPromises);
      
      // Small delay between batches to respect rate limits
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update status to completed
    await supabase
      .from('documents')
      .update({ upload_status: 'completed' })
      .eq('id', documentId);

    console.log(`Successfully processed document ${documentId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        chunksCreated: chunks.length,
        message: 'Document processed successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error processing document:', error);

    // Update status to failed if we have documentId
    try {
      if (documentId) {
        await supabase
          .from('documents')
          .update({ upload_status: 'failed' })
          .eq('id', documentId);
      }
    } catch (updateError) {
      console.error('Failed to update document status:', updateError);
    }

    return new Response(
      JSON.stringify({ 
        error: 'Document processing failed',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Convert file to Markdown using Unstructured.io
async function convertToMarkdownWithUnstructured(fileData: Blob, filePath: string): Promise<string> {
  const fileName = filePath.split('/').pop() || '';
  
  // If Unstructured API key is not available, fallback to original method
  if (!unstructuredApiKey) {
    console.log('Unstructured API key not found, falling back to original extraction');
    return await extractTextFromFileFallback(fileData, filePath);
  }
  
  try {
    console.log(`Converting ${fileName} to Markdown using Unstructured.io`);
    
    // Create form data for the API request
    const formData = new FormData();
    formData.append('files', fileData, fileName);
    formData.append('strategy', 'hi_res'); // High resolution for better quality
    formData.append('output_format', 'text/markdown');
    formData.append('chunking_strategy', 'none'); // We'll handle chunking ourselves
    
    // Make request to Unstructured.io API
    const response = await fetch('https://api.unstructured.io/general/v0/general', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${unstructuredApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Unstructured.io API error:', response.status, errorText);
      console.log('Falling back to original extraction method');
      return await extractTextFromFileFallback(fileData, filePath);
    }

    const result = await response.json();
    console.log('Unstructured.io response received, elements:', result.length);
    
    // Convert the structured elements to Markdown
    let markdownContent = '';
    
    for (const element of result) {
      if (element.text && element.text.trim()) {
        // Add appropriate formatting based on element type
        switch (element.type) {
          case 'Title':
            markdownContent += `# ${element.text}\n\n`;
            break;
          case 'Header':
            markdownContent += `## ${element.text}\n\n`;
            break;
          case 'SubHeader':
            markdownContent += `### ${element.text}\n\n`;
            break;
          case 'Table':
            markdownContent += `${element.text}\n\n`;
            break;
          case 'ListItem':
            markdownContent += `- ${element.text}\n`;
            break;
          case 'NarrativeText':
          case 'Text':
          default:
            markdownContent += `${element.text}\n\n`;
            break;
        }
      }
    }
    
    if (!markdownContent.trim()) {
      console.log('No content extracted from Unstructured.io, falling back');
      return await extractTextFromFileFallback(fileData, filePath);
    }
    
    console.log(`Successfully converted to Markdown: ${markdownContent.length} characters`);
    return markdownContent.trim();
    
  } catch (error) {
    console.error('Error converting to Markdown with Unstructured.io:', error);
    console.log('Falling back to original extraction method');
    return await extractTextFromFileFallback(fileData, filePath);
  }
}

// Simplified fallback text extraction for immediate functionality
async function extractTextFromFileFallback(fileData: Blob, filePath: string): Promise<string> {
  const fileName = filePath.toLowerCase();
  
  console.log(`Using fallback extraction for ${fileName}`);
  
  // Handle plain text files
  if (fileName.endsWith('.txt') || fileName.endsWith('.md') || fileName.endsWith('.json')) {
    console.log('Extracting as plain text');
    return await fileData.text();
  }
  
  // Handle CSV files with proper parsing
  if (fileName.endsWith('.csv')) {
    console.log('Extracting CSV content');
    const csvText = await fileData.text();
    return parseCSVToText(csvText);
  }
  
  // For PDF and other complex documents, provide a basic text extraction
  // This is a simplified version for immediate functionality
  if (fileName.endsWith('.pdf') || fileName.endsWith('.docx') || 
      fileName.endsWith('.doc') || fileName.endsWith('.xlsx') || 
      fileName.endsWith('.xls') || fileName.endsWith('.pptx')) {
    
    console.log(`Processing binary document: ${fileName}`);
    
    // For now, return a basic placeholder that indicates the document was received
    // but content extraction requires the Unstructured.io API
    const fileSize = fileData.size;
    const basicContent = `Document: ${fileName}
File Size: ${fileSize} bytes
Type: ${fileName.split('.').pop()?.toUpperCase()} document

This document was uploaded successfully but requires the Unstructured.io API for full content extraction.
Please configure the UNSTRUCTURED_API_KEY environment variable to enable advanced document parsing.

To configure the API key:
1. Sign up at unstructured.io
2. Get your API key
3. Add it as a secret in your Supabase project

The document is stored and ready for processing once the API key is configured.`;

    console.log('Returning basic document info since advanced parsing is not available');
    return basicContent;
  }
  
  // For other file types, try to read as text
  try {
    console.log('Attempting to read as plain text');
    return await fileData.text();
  } catch (error) {
    console.error('Failed to read file as text:', error);
    throw new Error(`Unable to extract content from ${fileName}. This file type may require the Unstructured.io API for proper parsing.`);
  }
}

function parseCSVToText(csvText: string): string {
  const lines = csvText.split('\n');
  let result = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      if (i === 0) {
        result += `CSV Headers: ${line}\n\n`;
      } else {
        result += `Row ${i}: ${line}\n`;
      }
    }
  }
  
  return result;
}

interface TextChunk {
  content: string;
  startIndex: number;
  endIndex: number;
}

function chunkMarkdown(content: string, maxChunkSize: number = 1000, overlap: number = 200): TextChunk[] {
  const chunks: TextChunk[] = [];
  
  // Split by major sections (headers)
  const sections = content.split(/(?=^#{1,3}\s)/m);
  
  let currentIndex = 0;
  
  for (const section of sections) {
    if (section.trim().length === 0) {
      currentIndex += section.length;
      continue;
    }
    
    if (section.length <= maxChunkSize) {
      // Section fits in one chunk
      chunks.push({
        content: section.trim(),
        startIndex: currentIndex,
        endIndex: currentIndex + section.length
      });
      currentIndex += section.length;
    } else {
      // Section needs to be split further
      const sectionChunks = chunkLargeMarkdownSection(section, maxChunkSize, overlap);
      for (const chunk of sectionChunks) {
        chunks.push({
          content: chunk.content,
          startIndex: currentIndex + chunk.startIndex,
          endIndex: currentIndex + chunk.endIndex
        });
      }
      currentIndex += section.length;
    }
  }
  
  return chunks;
}

function chunkLargeMarkdownSection(section: string, maxChunkSize: number, overlap: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  const paragraphs = section.split(/\n\s*\n/);
  
  let currentChunk = '';
  let chunkStartIndex = 0;
  let currentIndex = 0;
  
  for (const paragraph of paragraphs) {
    const paragraphWithSpacing = paragraph + '\n\n';
    
    if (currentChunk.length + paragraphWithSpacing.length > maxChunkSize && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        content: currentChunk.trim(),
        startIndex: chunkStartIndex,
        endIndex: currentIndex
      });
      
      // Start new chunk with overlap
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + paragraphWithSpacing;
      chunkStartIndex = currentIndex - overlapText.length;
    } else {
      if (currentChunk.length === 0) {
        chunkStartIndex = currentIndex;
      }
      currentChunk += paragraphWithSpacing;
    }
    
    currentIndex += paragraphWithSpacing.length;
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      startIndex: chunkStartIndex,
      endIndex: currentIndex
    });
  }
  
  return chunks;
}

// Legacy chunking function (kept for compatibility)
function chunkText(text: string, maxChunkSize: number = 1000, overlap: number = 200): TextChunk[] {
  const chunks: TextChunk[] = [];
  
  if (text.length <= maxChunkSize) {
    return [{
      content: text,
      startIndex: 0,
      endIndex: text.length
    }];
  }
  
  let startIndex = 0;
  
  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + maxChunkSize, text.length);
    
    // Try to end at a sentence boundary
    if (endIndex < text.length) {
      const lastSentenceEnd = text.lastIndexOf('.', endIndex);
      const lastNewline = text.lastIndexOf('\n', endIndex);
      const lastSpace = text.lastIndexOf(' ', endIndex);
      
      const bestEndIndex = Math.max(lastSentenceEnd, lastNewline, lastSpace);
      if (bestEndIndex > startIndex + maxChunkSize * 0.5) {
        endIndex = bestEndIndex + 1;
      }
    }
    
    const chunkContent = text.slice(startIndex, endIndex).trim();
    if (chunkContent) {
      chunks.push({
        content: chunkContent,
        startIndex,
        endIndex
      });
    }
    
    // Move start index with overlap
    startIndex = Math.max(startIndex + 1, endIndex - overlap);
  }
  
  return chunks;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}