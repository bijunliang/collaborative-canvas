-- Verification script to check if migration 002 was applied correctly
-- Run this to verify the migration worked

-- Check if lock_by is nullable
SELECT 
  column_name, 
  is_nullable,
  data_type
FROM information_schema.columns 
WHERE table_name = 'canvas_tiles' 
  AND column_name IN ('lock_by', 'updated_by');

-- Check if user_id in generation_jobs is nullable
SELECT 
  column_name, 
  is_nullable,
  data_type
FROM information_schema.columns 
WHERE table_name = 'generation_jobs' 
  AND column_name = 'user_id';

-- Check for remaining foreign key constraints
SELECT
  tc.table_name, 
  kcu.column_name, 
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('canvas_tiles', 'generation_jobs', 'tile_history', 'user_cooldowns')
  AND (kcu.column_name LIKE '%user%' OR kcu.column_name LIKE '%lock%' OR kcu.column_name LIKE '%updated%');
