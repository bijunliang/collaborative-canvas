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

export interface CanvasPatch {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image_url: string;
  prompt: string | null;
  updated_by: string | null;
  updated_at: string;
  lock_until: string | null;
  lock_by: string | null;
}

export interface GenerationJob {
  id: string;
  x: number | null; // legacy tile coords
  y: number | null;
  frame_x: number | null;
  frame_y: number | null;
  frame_width: number | null;
  frame_height: number | null;
  prompt: string;
  status: JobStatus;
  result_image_url: string | null;
  error: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCooldown {
  user_id: string;
  cooldown_until: string;
}

export interface FrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
