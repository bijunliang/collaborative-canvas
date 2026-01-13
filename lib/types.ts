export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface CanvasTile {
  x: number;
  y: number;
  current_image_url: string | null;
  current_prompt: string | null;
  updated_by: string | null;
  updated_at: string;
  lock_until: string | null;
  lock_by: string | null;
  version: number;
}

export interface TileHistory {
  id: string;
  x: number;
  y: number;
  image_url: string;
  prompt: string;
  user_id: string;
  created_at: string;
}

export interface GenerationJob {
  id: string;
  x: number;
  y: number;
  prompt: string;
  status: JobStatus;
  result_image_url: string | null;
  error: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserCooldown {
  user_id: string;
  cooldown_until: string;
}

export interface TileCoordinates {
  x: number;
  y: number;
}
