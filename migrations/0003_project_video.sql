ALTER TABLE projects ADD COLUMN video_key TEXT;
ALTER TABLE projects ADD COLUMN video_url TEXT;
ALTER TABLE project_steps ADD COLUMN video_timestamp_ms INTEGER;
ALTER TABLE content_elements ADD COLUMN video_timestamp_ms INTEGER;
