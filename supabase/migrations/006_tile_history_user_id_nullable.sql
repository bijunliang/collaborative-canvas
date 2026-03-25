-- Make user_id nullable in tile_history (legacy path uses anonymous users)
ALTER TABLE tile_history
  ALTER COLUMN user_id DROP NOT NULL;
