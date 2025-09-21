-- Update stuck documents to failed status so users can retry
UPDATE documents 
SET upload_status = 'failed', updated_at = now()
WHERE upload_status = 'processing';