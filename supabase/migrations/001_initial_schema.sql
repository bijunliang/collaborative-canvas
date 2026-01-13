-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for job status
CREATE TYPE job_status AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- Canvas tiles table - current state of each tile
CREATE TABLE canvas_tiles (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  current_image_url TEXT,
  current_prompt TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_until TIMESTAMPTZ,
  lock_by UUID REFERENCES auth.users(id),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (x, y),
  CONSTRAINT valid_coordinates CHECK (x >= 0 AND y >= 0)
);

-- Tile history table - audit trail of all changes
CREATE TABLE tile_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generation jobs table - queue for async image generation
CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  result_image_url TEXT,
  error TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User cooldowns table - track user placement cooldowns
CREATE TABLE user_cooldowns (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  cooldown_until TIMESTAMPTZ NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_canvas_tiles_updated_at ON canvas_tiles(updated_at);
CREATE INDEX idx_canvas_tiles_lock_until ON canvas_tiles(lock_until) WHERE lock_until IS NOT NULL;
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX idx_generation_jobs_user_status ON generation_jobs(user_id, status);
CREATE INDEX idx_generation_jobs_created_at ON generation_jobs(created_at);
CREATE INDEX idx_tile_history_coords ON tile_history(x, y);
CREATE INDEX idx_tile_history_created_at ON tile_history(created_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at for generation_jobs
CREATE TRIGGER update_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies

-- Enable RLS on all tables
ALTER TABLE canvas_tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tile_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cooldowns ENABLE ROW LEVEL SECURITY;

-- Canvas tiles: public read, write only via service role
CREATE POLICY "Anyone can read canvas tiles"
  ON canvas_tiles FOR SELECT
  USING (true);

-- Tile history: public read
CREATE POLICY "Anyone can read tile history"
  ON tile_history FOR SELECT
  USING (true);

-- Generation jobs: users can read their own jobs
CREATE POLICY "Users can read their own jobs"
  ON generation_jobs FOR SELECT
  USING (auth.uid() = user_id);

-- Generation jobs: users can insert their own jobs (but validation happens in API)
CREATE POLICY "Users can create their own jobs"
  ON generation_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Generation jobs: users can update their own jobs (for cancellation)
CREATE POLICY "Users can update their own jobs"
  ON generation_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- User cooldowns: users can read their own cooldown
CREATE POLICY "Users can read their own cooldown"
  ON user_cooldowns FOR SELECT
  USING (auth.uid() = user_id);
