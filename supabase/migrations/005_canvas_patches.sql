-- Merged painting: patch-based canvas for inpainting/outpainting
-- Patches are placed at arbitrary (x,y) positions, no grid

CREATE TABLE canvas_patches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 512,
  height INTEGER NOT NULL DEFAULT 512,
  image_url TEXT NOT NULL,
  prompt TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_until TIMESTAMPTZ,
  lock_by UUID REFERENCES auth.users(id),
  CONSTRAINT valid_patch_coords CHECK (x >= 0 AND y >= 0 AND width > 0 AND height > 0)
);

CREATE INDEX idx_canvas_patches_updated_at ON canvas_patches(updated_at);
CREATE INDEX idx_canvas_patches_bbox ON canvas_patches(x, y, width, height);

-- Extend generation_jobs for frame-based outpainting
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_x INTEGER;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_y INTEGER;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_width INTEGER;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_height INTEGER;

-- Make x,y nullable for frame-only jobs
ALTER TABLE generation_jobs ALTER COLUMN x DROP NOT NULL;
ALTER TABLE generation_jobs ALTER COLUMN y DROP NOT NULL;

-- RLS for canvas_patches
ALTER TABLE canvas_patches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read canvas patches"
  ON canvas_patches FOR SELECT
  USING (true);
