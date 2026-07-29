-- Add playback_status column to voice_notes
ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS playback_status text DEFAULT 'READY';

-- Update existing notes: mark zero-byte notes as CORRUPT
UPDATE voice_notes
SET playback_status = 'CORRUPT'
WHERE file_size_bytes = 0
  AND playback_status IS NULL OR playback_status = 'READY';

-- Mark notes where file_size is suspiciously small (< 500 bytes for webm) as CORRUPT
UPDATE voice_notes
SET playback_status = 'CORRUPT'
WHERE file_size_bytes < 500
  AND mime_type LIKE 'audio/webm%';

NOTIFY pgrst, 'reload schema';
