-- Make authentication optional by allowing NULL values for user-related fields
-- This allows the app to work without requiring user authentication

-- Make lock_by nullable in canvas_tiles and remove foreign key constraint
ALTER TABLE canvas_tiles 
  ALTER COLUMN lock_by DROP NOT NULL;

-- Drop foreign key constraints if they exist (they may have different names)
DO $$ 
BEGIN
  ALTER TABLE canvas_tiles DROP CONSTRAINT IF EXISTS canvas_tiles_lock_by_fkey;
  ALTER TABLE canvas_tiles DROP CONSTRAINT IF EXISTS canvas_tiles_updated_by_fkey;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Make updated_by nullable in canvas_tiles  
ALTER TABLE canvas_tiles 
  ALTER COLUMN updated_by DROP NOT NULL;

-- For generation_jobs, remove the FK constraint and make user_id nullable
-- This allows jobs to be created without authentication
DO $$ 
BEGIN
  ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_user_id_fkey;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE generation_jobs
  ALTER COLUMN user_id DROP NOT NULL;

-- For tile_history, remove the FK constraint as well
ALTER TABLE tile_history
  DROP CONSTRAINT IF EXISTS tile_history_user_id_fkey;

-- For user_cooldowns, remove the FK constraint
ALTER TABLE user_cooldowns
  DROP CONSTRAINT IF EXISTS user_cooldowns_user_id_fkey;
