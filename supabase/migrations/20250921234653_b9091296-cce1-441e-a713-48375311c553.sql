-- Test the RAG pipeline by inserting a test document and chunks with proper UUIDs
-- Insert a test document
INSERT INTO documents (id, filename, user_id, file_size, upload_status, mime_type, file_path)
VALUES (
  gen_random_uuid(),
  'test-military-manual.pdf',
  'fe4212d0-a163-492c-bb89-9809bc17fc53',
  5000,
  'completed',
  'application/pdf',
  'test/test-manual.pdf'
);

-- Get the document ID for chunks (we'll use a variable approach)
DO $$
DECLARE
  doc_id uuid;
BEGIN
  -- Get the test document ID
  SELECT id INTO doc_id FROM documents WHERE filename = 'test-military-manual.pdf' LIMIT 1;
  
  -- Insert test chunks with embeddings
  INSERT INTO document_chunks (document_id, chunk_index, content, token_count, embedding, metadata)
  VALUES 
  (
    doc_id,
    0,
    'M1A2 Abrams tank specifications: Weight 68 tons, Length 9.77m, Width 3.66m, Height 2.44m. Main armament 120mm M256 smoothbore gun. Maximum road speed 67.6 km/h.',
    50,
    '[0.1, 0.2, 0.3, 0.4, 0.5]'::vector,
    '{"start_char": 0, "end_char": 150}'::jsonb
  ),
  (
    doc_id, 
    1,
    'Load planning considerations for M1A2 Abrams: Fuel capacity 1909 liters, ammunition storage includes 42 rounds for main gun, requires specialized heavy equipment transporter (HET) for long-distance movement.',
    60,
    '[0.2, 0.3, 0.4, 0.5, 0.6]'::vector,
    '{"start_char": 150, "end_char": 300}'::jsonb
  );
END $$;

-- Also add test knowledge base entry
INSERT INTO knowledge_base (id, title, content, description, source_type, user_id, tags, embedding)
VALUES (
  gen_random_uuid(),
  'Vehicle Transport Guidelines',
  'When planning military vehicle transportation, consider: 1) Weight and dimension constraints of transport vehicles 2) Route planning for oversized loads 3) Security requirements 4) Fuel and maintenance logistics',
  'General guidelines for military vehicle transportation planning',
  'manual',
  'fe4212d0-a163-492c-bb89-9809bc17fc53',
  ARRAY['transportation', 'logistics', 'planning'],
  '[0.15, 0.25, 0.35, 0.45, 0.55]'::vector
);