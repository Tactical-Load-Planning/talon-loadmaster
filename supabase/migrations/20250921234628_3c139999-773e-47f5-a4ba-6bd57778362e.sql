-- Test the RAG pipeline by inserting a test document and chunks with proper UUIDs
-- Insert a test document
INSERT INTO documents (id, filename, user_id, file_size, upload_status, mime_type, file_path)
VALUES (
  'a0b1c2d3-e4f5-6789-abcd-ef1234567890',
  'test-military-manual.pdf',
  'fe4212d0-a163-492c-bb89-9809bc17fc53',
  5000,
  'completed',
  'application/pdf',
  'test/test-manual.pdf'
);

-- Insert test chunks with embeddings (using proper 5-dimensional vectors for testing)
INSERT INTO document_chunks (document_id, chunk_index, content, token_count, embedding, metadata)
VALUES 
(
  'a0b1c2d3-e4f5-6789-abcd-ef1234567890',
  0,
  'M1A2 Abrams tank specifications: Weight 68 tons, Length 9.77m, Width 3.66m, Height 2.44m. Main armament 120mm M256 smoothbore gun. Maximum road speed 67.6 km/h.',
  50,
  '[0.1, 0.2, 0.3, 0.4, 0.5]'::vector,
  '{"start_char": 0, "end_char": 150}'::jsonb
),
(
  'a0b1c2d3-e4f5-6789-abcd-ef1234567890', 
  1,
  'Load planning considerations for M1A2 Abrams: Fuel capacity 1909 liters, ammunition storage includes 42 rounds for main gun, requires specialized heavy equipment transporter (HET) for long-distance movement.',
  60,
  '[0.2, 0.3, 0.4, 0.5, 0.6]'::vector,
  '{"start_char": 150, "end_char": 300}'::jsonb
);