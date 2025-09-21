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
    const { title, content, tags } = await req.json();
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

    console.log(`Adding manual knowledge: "${title}" for user: ${user.id}`);

    if (!title?.trim() || !content?.trim()) {
      throw new Error('Title and content are required');
    }

    // Generate embedding for the content
    const embedding = await generateEmbedding(content);

    // Store in knowledge base
    const { error: insertError } = await supabase
      .from('knowledge_base')
      .insert({
        title: title.trim(),
        description: `Manual entry: ${title.trim()}`,
        source_type: 'manual',
        source_reference: null,
        content: content.trim(),
        embedding,
        tags: tags || [],
        user_id: user.id
      });

    if (insertError) {
      throw insertError;
    }

    console.log(`Successfully added manual knowledge entry: "${title}"`);

    return new Response(
      JSON.stringify({ 
        success: true,
        title,
        contentLength: content.length,
        message: 'Knowledge entry added successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error adding manual knowledge:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to add knowledge entry',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

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