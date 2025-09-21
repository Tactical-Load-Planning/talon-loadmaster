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
    const { url } = await req.json();
    const authHeader = req.headers.get('Authorization');
    
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Validate user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    console.log(`Processing URL: ${url} for user: ${user.id}`);

    // Fetch content from URL
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TALON-Bot/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    
    // Simple HTML content extraction (you may want to use a proper HTML parser)
    const textContent = extractTextFromHTML(content);
    
    if (!textContent || textContent.trim().length < 50) {
      throw new Error('No meaningful content could be extracted from the URL');
    }

    // Generate title from URL or first part of content
    const title = extractTitleFromContent(textContent, url);
    
    // Generate embedding
    const embedding = await generateEmbedding(textContent);

    // Store in knowledge base
    const { error: insertError } = await supabase
      .from('knowledge_base')
      .insert({
        title,
        description: `Content extracted from: ${url}`,
        source_type: 'url',
        source_reference: url,
        content: textContent,
        embedding,
        user_id: user.id,
        tags: ['url', 'web-content']
      });

    if (insertError) {
      throw insertError;
    }

    console.log(`Successfully processed URL: ${url}`);

    return new Response(
      JSON.stringify({ 
        success: true,
        title,
        contentLength: textContent.length,
        message: 'URL content processed and added to knowledge base'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error processing URL:', error);
    return new Response(
      JSON.stringify({ 
        error: 'URL processing failed',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function extractTextFromHTML(html: string): string {
  // Simple HTML tag removal - in production, you might want to use a proper HTML parser
  let text = html
    .replace(/<script[^>]*>.*?<\/script>/gsi, '')
    .replace(/<style[^>]*>.*?<\/style>/gsi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  return text;
}

function extractTitleFromContent(content: string, url: string): string {
  // Try to extract a title from the first line or URL
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length > 10 && firstLine.length < 100) {
    return firstLine;
  }
  
  // Fallback to URL-based title
  try {
    const urlObj = new URL(url);
    return `Content from ${urlObj.hostname}`;
  } catch {
    return 'Web Content';
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate text if it's too long for the embedding model
  const maxLength = 8000; // Safe limit for ada-002
  const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;
  
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: truncatedText,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}