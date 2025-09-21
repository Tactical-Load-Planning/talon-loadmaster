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
    const { message, conversationHistory } = await req.json();
    
    console.log(`Processing chat message: ${message}`);

    // Generate embedding for the user's question
    const questionEmbedding = await generateEmbedding(message);

    // Search for relevant chunks using vector similarity
    const { data: relevantChunks, error: searchError } = await supabase.rpc('search_chunks', {
      query_embedding: questionEmbedding,
      match_threshold: 0.7,
      match_count: 5
    });

    if (searchError) {
      console.error('Error searching chunks:', searchError);
    }

    // Also search knowledge base
    const { data: relevantKnowledge, error: knowledgeError } = await supabase.rpc('search_knowledge', {
      query_embedding: questionEmbedding,
      match_threshold: 0.7,
      match_count: 3
    });

    if (knowledgeError) {
      console.error('Error searching knowledge base:', knowledgeError);
    }

    // Prepare context from retrieved documents
    let context = '';
    if (relevantChunks && relevantChunks.length > 0) {
      context += 'Relevant document excerpts:\n\n';
      relevantChunks.forEach((chunk: any, index: number) => {
        context += `[${index + 1}] ${chunk.content}\n\n`;
      });
    }

    if (relevantKnowledge && relevantKnowledge.length > 0) {
      context += 'Relevant knowledge base entries:\n\n';
      relevantKnowledge.forEach((entry: any, index: number) => {
        context += `[KB${index + 1}] ${entry.title}: ${entry.content}\n\n`;
      });
    }

    // Build conversation history for context
    const recentHistory = conversationHistory?.slice(-6) || []; // Last 6 messages
    const conversationContext = recentHistory
      .map((msg: any) => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Create system prompt for TALON
    const systemPrompt = `You are TALON, a specialized AI assistant for military vehicle load planning and transportation operations. Your expertise includes:

- Military vehicle specifications and capabilities
- Load planning procedures and calculations
- Equipment and munition considerations
- Transportation logistics and operations
- Infrastructure requirements and constraints
- Safety protocols and regulations

Always provide accurate, professional, and actionable advice. If you don't have specific information, clearly state your limitations and suggest consulting official military documentation or subject matter experts.

${context ? `Use the following context information to inform your response:\n\n${context}` : ''}

Respond in a helpful, professional manner appropriate for military personnel.`;

    // Generate response using OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentHistory,
          { role: 'user', content: message }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const assistantResponse = data.choices[0].message.content;

    console.log(`Generated response for user message`);

    return new Response(
      JSON.stringify({ 
        response: assistantResponse,
        contextsUsed: {
          documentChunks: relevantChunks?.length || 0,
          knowledgeEntries: relevantKnowledge?.length || 0
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in chat function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Chat processing failed',
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