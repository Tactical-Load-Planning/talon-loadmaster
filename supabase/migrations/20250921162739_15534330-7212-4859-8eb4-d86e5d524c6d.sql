-- Enable pgvector extension for vector operations
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table to store original file metadata
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create chunks table to store processed text chunks
CREATE TABLE public.document_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  embedding vector(1536), -- OpenAI ada-002 embedding dimension
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create knowledge_base table for RAG context
CREATE TABLE public.knowledge_base (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('document', 'url', 'manual')),
  source_reference TEXT,
  content TEXT NOT NULL,
  embedding vector(1536),
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

-- RLS Policies for documents
CREATE POLICY "Users can view their own documents" 
ON public.documents 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" 
ON public.documents 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents" 
ON public.documents 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own documents" 
ON public.documents 
FOR DELETE 
USING (auth.uid() = user_id);

-- RLS Policies for document_chunks
CREATE POLICY "Users can view chunks of their documents" 
ON public.document_chunks 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.documents d 
    WHERE d.id = document_chunks.document_id 
    AND d.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert chunks for their documents" 
ON public.document_chunks 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.documents d 
    WHERE d.id = document_chunks.document_id 
    AND d.user_id = auth.uid()
  )
);

-- RLS Policies for knowledge_base
CREATE POLICY "Users can view their own knowledge base entries" 
ON public.knowledge_base 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own knowledge base entries" 
ON public.knowledge_base 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own knowledge base entries" 
ON public.knowledge_base 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own knowledge base entries" 
ON public.knowledge_base 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_documents_status ON public.documents(upload_status);
CREATE INDEX idx_document_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX idx_knowledge_base_user_id ON public.knowledge_base(user_id);

-- Create vector similarity search indexes
CREATE INDEX idx_document_chunks_embedding ON public.document_chunks 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_knowledge_base_embedding ON public.knowledge_base 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documents', 'documents', false);

-- Storage policies for document uploads
CREATE POLICY "Users can upload their own documents" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own documents" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own documents" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own documents" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Add trigger for updating timestamps
CREATE TRIGGER update_documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_knowledge_base_updated_at
BEFORE UPDATE ON public.knowledge_base
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();