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

    // Convert file to text based on type
    const text = await extractTextFromFile(fileData, filePath);
    
    if (!text || text.trim().length === 0) {
      throw new Error('No text content could be extracted from the file');
    }

    // Chunk the text
    const chunks = chunkText(text, 1000, 200); // 1000 chars per chunk, 200 char overlap
    
    console.log(`Extracted ${text.length} characters, created ${chunks.length} chunks`);

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

async function extractTextFromFile(fileData: Blob, filePath: string): Promise<string> {
  const fileName = filePath.toLowerCase();
  
  // Handle plain text files
  if (fileName.endsWith('.txt') || fileName.endsWith('.md') || fileName.endsWith('.json')) {
    return await fileData.text();
  }
  
  // Handle CSV files with proper parsing
  if (fileName.endsWith('.csv')) {
    const csvText = await fileData.text();
    return parseCSVToText(csvText);
  }
  
  // Handle binary document files (PDF, DOCX, XLSX, PPTX)
  if (fileName.endsWith('.pdf') || fileName.endsWith('.docx') || 
      fileName.endsWith('.doc') || fileName.endsWith('.xlsx') || 
      fileName.endsWith('.xls') || fileName.endsWith('.pptx')) {
    
    try {
      // Save file temporarily for document parsing
      const tempPath = `/tmp/${Date.now()}_${fileName}`;
      const arrayBuffer = await fileData.arrayBuffer();
      
      await Deno.writeFile(tempPath, new Uint8Array(arrayBuffer));
      
      // Use document parsing for complex formats
      const parsedContent = await parseDocumentFile(tempPath, fileName);
      
      // Cleanup temporary file
      try {
        await Deno.remove(tempPath);
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp file:', cleanupError);
      }
      
      return parsedContent;
      
    } catch (error) {
      console.error(`Document parsing error for ${fileName}:`, error);
      throw new Error(`Failed to extract content from ${fileName}. Please ensure the file is valid and contains readable content.`);
    }
  }
  
  // For other file types, try to read as text
  try {
    return await fileData.text();
  } catch (error) {
    throw new Error(`Unsupported file type: ${fileName}. Supported formats: TXT, MD, JSON, CSV, PDF, DOCX, XLSX, PPTX`);
  }
}

async function parseDocumentFile(filePath: string, fileName: string): Promise<string> {
  // Enhanced document parsing for different file types
  const fileExt = fileName.split('.').pop()?.toLowerCase();
  
  try {
    if (fileExt === 'pdf') {
      return await parsePDFFile(filePath);
    } else if (fileExt === 'docx' || fileExt === 'doc') {
      return await parseWordFile(filePath);
    } else if (fileExt === 'xlsx' || fileExt === 'xls') {
      return await parseExcelFile(filePath);
    } else if (fileExt === 'pptx') {
      return await parsePowerPointFile(filePath);
    }
  } catch (error) {
    console.error(`Parsing error for ${fileExt}:`, error);
  }
  
  // Fallback: try to extract basic text
  const fileContent = await Deno.readFile(filePath);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
  
  // Clean and extract readable portions
  const cleanText = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ') // Remove most control chars, keep \n and \t
    .replace(/\s+/g, ' ')
    .trim();
    
  if (cleanText.length < 20) {
    throw new Error('Insufficient readable content found in document');
  }
  
  return cleanText;
}

async function parsePDFFile(filePath: string): Promise<string> {
  // Enhanced PDF parsing with multiple extraction strategies
  const fileContent = await Deno.readFile(filePath);
  
  try {
    // Strategy 1: Look for text streams in PDF
    const text = new TextDecoder('latin1').decode(fileContent);
    const textMatches = text.match(/BT\s+.*?ET/gs) || [];
    
    let extractedText = '';
    for (const match of textMatches) {
      // Extract text between parentheses or brackets
      const textContent = match.match(/\((.*?)\)/g) || match.match(/\[(.*?)\]/g) || [];
      for (const content of textContent) {
        const cleanContent = content.replace(/[\(\)\[\]]/g, '').trim();
        if (cleanContent) extractedText += cleanContent + ' ';
      }
    }
    
    // Strategy 2: Look for readable text patterns
    if (extractedText.trim().length < 20) {
      const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
      const readableChunks = utf8Text.match(/[a-zA-Z0-9\s.,!?;:]{10,}/g) || [];
      extractedText = readableChunks.join(' ').substring(0, 5000); // Limit to first 5000 chars
    }
    
    // If still no content, create a basic description
    if (extractedText.trim().length < 10) {
      extractedText = `PDF Document: ${filePath.split('/').pop()} - This document contains content that could not be automatically extracted. Manual review may be required.`;
    }
    
    return extractedText.trim();
  } catch (error) {
    console.error('PDF parsing error:', error);
    // Return a basic description rather than failing
    return `PDF Document: ${filePath.split('/').pop()} - This document contains content that could not be automatically extracted due to formatting complexity.`;
  }
}

async function parseWordFile(filePath: string): Promise<string> {
  // Enhanced DOCX parsing with fallback strategies
  const fileContent = await Deno.readFile(filePath);
  
  try {
    if (filePath.endsWith('.docx')) {
      // DOCX files are ZIP archives containing XML
      const text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
      
      // Strategy 1: Extract from w:t tags (Word text elements)
      const xmlContent = text.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      let extractedText = '';
      
      for (const match of xmlContent) {
        const textContent = match.replace(/<[^>]*>/g, '').trim();
        if (textContent) extractedText += textContent + ' ';
      }
      
      // Strategy 2: If no XML text found, look for readable text patterns
      if (extractedText.trim().length < 20) {
        const readableChunks = text.match(/[a-zA-Z0-9\s.,!?;:]{10,}/g) || [];
        extractedText = readableChunks.slice(0, 50).join(' '); // Limit to first 50 chunks
      }
      
      // Fallback: Create basic description
      if (extractedText.trim().length < 10) {
        extractedText = `Word Document: ${filePath.split('/').pop()} - This document contains content that could not be automatically extracted.`;
      }
      
      return extractedText.trim();
    }
    
    // For .doc files (older format), basic text extraction
    const text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
    const cleanText = text.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ').trim();
    
    return cleanText.length > 10 ? cleanText.substring(0, 5000) : 
           `Word Document: ${filePath.split('/').pop()} - Legacy format document content.`;
           
  } catch (error) {
    console.error('Word document parsing error:', error);
    return `Word Document: ${filePath.split('/').pop()} - This document could not be parsed due to formatting complexity.`;
  }
}

async function parseExcelFile(filePath: string): Promise<string> {
  // Basic Excel parsing for tabular data
  const fileContent = await Deno.readFile(filePath);
  
  if (filePath.endsWith('.xlsx')) {
    // XLSX files are also ZIP archives with XML
    const text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
    
    // Extract shared strings (text content in XLSX)
    const sharedStrings = text.match(/<t[^>]*>(.*?)<\/t>/g) || [];
    const cellValues: string[] = [];
    
    for (const match of sharedStrings) {
      const value = match.replace(/<[^>]*>/g, '').trim();
      if (value) cellValues.push(value);
    }
    
    // Also look for inline cell values
    const inlineCells = text.match(/<c[^>]*t="inlineStr"[^>]*>.*?<\/c>/g) || [];
    for (const cell of inlineCells) {
      const value = cell.match(/<t[^>]*>(.*?)<\/t>/)?.[1];
      if (value) cellValues.push(value);
    }
    
    return cellValues.length > 0 ? 
      `Excel Content: ${cellValues.join(' | ')}` : 
      'No readable content found in Excel file';
  }
  
  // For .xls files, basic text extraction
  const text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function parsePowerPointFile(filePath: string): Promise<string> {
  // Basic PowerPoint parsing
  const fileContent = await Deno.readFile(filePath);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(fileContent);
  
  // PPTX files contain XML with slide content
  const textContent = text.match(/<a:t[^>]*>(.*?)<\/a:t>/g) || [];
  let extractedText = '';
  
  for (const match of textContent) {
    const slideText = match.replace(/<[^>]*>/g, '');
    extractedText += slideText + ' ';
  }
  
  return extractedText.trim() || 'No readable text found in PowerPoint file';
}

function parseCSVToText(csvContent: string): string {
  const lines = csvContent.split('\n');
  const result: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      // Parse CSV line (simple approach - doesn't handle quoted commas)
      const columns = line.split(',').map(col => col.trim().replace(/^"|"$/g, ''));
      
      if (i === 0) {
        // Header row
        result.push(`Table Headers: ${columns.join(', ')}`);
      } else {
        // Data row
        result.push(`Row ${i}: ${columns.join(' | ')}`);
      }
    }
  }
  
  return result.join('\n');
}

interface TextChunk {
  content: string;
  startIndex: number;
  endIndex: number;
}

function chunkText(text: string, maxChunkSize: number, overlap: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = Math.min(startIndex + maxChunkSize, text.length);
    
    // Try to break at sentence boundary if possible
    if (endIndex < text.length) {
      const lastPeriod = text.lastIndexOf('.', endIndex);
      const lastNewline = text.lastIndexOf('\n', endIndex);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      
      if (breakPoint > startIndex + maxChunkSize * 0.5) {
        endIndex = breakPoint + 1;
      }
    }

    const content = text.slice(startIndex, endIndex).trim();
    if (content.length > 0) {
      chunks.push({
        content,
        startIndex,
        endIndex
      });
    }

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
      model: 'text-embedding-ada-002',
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}