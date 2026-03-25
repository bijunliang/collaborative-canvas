-- Run this in Supabase SQL Editor to fix "frame_height column not found" error.
-- Adds columns needed for the merged painting / frame-based generation.

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_x INTEGER;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_y INTEGER;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_width INTEGER;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_height INTEGER;

-- Allow null x,y for frame-only jobs
ALTER TABLE generation_jobs ALTER COLUMN x DROP NOT NULL;
ALTER TABLE generation_jobs ALTER COLUMN y DROP NOT NULL;

-- Fix: tile_history.user_id nullable (legacy path with anonymous users)
ALTER TABLE tile_history ALTER COLUMN user_id DROP NOT NULL;
