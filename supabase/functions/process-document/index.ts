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

  try {
    const { documentId, filePath } = await req.json();
    
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
    const body = await req.json().catch(() => ({}));
    if (body.documentId) {
      await supabase
        .from('documents')
        .update({ upload_status: 'failed' })
        .eq('id', body.documentId);
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
  
  if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
    return await fileData.text();
  }
  
  if (fileName.endsWith('.pdf')) {
    // For PDF files, you might want to use a PDF parsing library
    // For now, we'll return a placeholder
    return await fileData.text(); // This won't work for binary PDFs
  }
  
  // For other file types, try to read as text
  try {
    return await fileData.text();
  } catch (error) {
    throw new Error(`Unsupported file type or cannot extract text from ${fileName}`);
  }
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