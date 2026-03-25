// Canvas configuration - bounded square (1:1)
export const CANVAS_WIDTH_PX = 6566;
export const CANVAS_HEIGHT_PX = 6566;

// Legacy grid dimensions (for backward compat)
export const CANVAS_WIDTH = 40;
export const CANVAS_HEIGHT = 40;
export const TILE_SIZE_PX = 64;

// Generation frame - fixed size for outpainting (canvas px)
export const FRAME_WIDTH = 1024;
export const FRAME_HEIGHT = 1024;

// Frame display size on screen (fixed, does not scale with zoom)
export const FRAME_SCREEN_SIZE = 160;

// Timing configuration
export const PATCH_LOCK_DURATION_SECONDS = 90;
export const TILE_LOCK_DURATION_SECONDS = 90; // legacy alias
export const USER_COOLDOWN_SECONDS = 120;

// Validation limits
export const MAX_PROMPT_LENGTH = 1000;

// Image generation
export const GENERATED_IMAGE_SIZE = 512; // 512x512px square images

// Worker configuration
export const WORKER_POLL_INTERVAL_MS = 5000; // 5 seconds
