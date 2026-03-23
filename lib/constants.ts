// Canvas configuration
export const CANVAS_WIDTH = 50;
export const CANVAS_HEIGHT = 50;
const BASE_GRID_PX = 640;
const SCALE_FACTOR = 5; // 5x larger tiles → borders look thinner when zoomed
export const TILE_SIZE_PX = (BASE_GRID_PX / 50) * SCALE_FACTOR; // 64px; grid is 3200x3200

// Timing configuration
export const TILE_LOCK_DURATION_SECONDS = 90;
export const USER_COOLDOWN_SECONDS = 120;

// Validation limits
export const MAX_PROMPT_LENGTH = 1000;

// Image generation
export const GENERATED_IMAGE_SIZE = 512; // 512x512px square images

// Worker configuration
export const WORKER_POLL_INTERVAL_MS = 5000; // 5 seconds
