-- Fix: Make user_id nullable in generation_jobs
-- Run this in Supabase SQL Editor

-- Remove NOT NULL constraint from user_id
ALTER TABLE generation_jobs
  ALTER COLUMN user_id DROP NOT NULL;

-- Verify the change (fixed variable name conflict)
DO $$
DECLARE
  nullable_status text;
BEGIN
  SELECT c.is_nullable INTO nullable_status
  FROM information_schema.columns c
  WHERE c.table_name = 'generation_jobs' 
    AND c.column_name = 'user_id';
  
  IF nullable_status = 'NO' THEN
    RAISE EXCEPTION 'Migration failed: user_id is still NOT NULL';
  END IF;
  
  RAISE NOTICE 'Success: user_id is now nullable';
END $$;
