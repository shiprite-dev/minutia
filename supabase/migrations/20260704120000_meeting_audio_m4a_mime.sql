-- The macOS companion writes AAC-in-MP4 segments and uploads them via
-- supabase-swift, which derives the part's content type from the ".m4a" file
-- extension as "audio/x-m4a" (ignoring an explicit "audio/mp4" FileOptions type).
-- The meeting-audio allow-list only permitted bare containers, so every companion
-- upload was rejected 415 "mime type audio/x-m4a is not supported" and no segment
-- or recording ever reached storage. Admit the m4a/aac essence types the Mac
-- produces. Browser (webm) uploads are unaffected.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav'
]
WHERE id = 'meeting-audio';
