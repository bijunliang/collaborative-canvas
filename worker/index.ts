import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateImage } from '../lib/image-generation';
import {
  WORKER_POLL_INTERVAL_MS,
  GENERATED_IMAGE_SIZE,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TILE_SIZE_PX,
} from '../lib/constants';
import { config } from 'dotenv';
import { resolve } from 'path';
import sharp from 'sharp';

const WORKER_VERSION = '4.0-outpainting';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Solid neutral background for empty canvas areas (avoids confusing the model)
const CONTEXT_BG = { r: 240, g: 240, b: 240, alpha: 255 };

function makeSolidBackground(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const c = CONTEXT_BG;
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    buf[idx] = c.r;
    buf[idx + 1] = c.g;
    buf[idx + 2] = c.b;
    buf[idx + 3] = c.alpha;
  }
  return buf;
}

/**
 * Create a single-channel alpha mask that fades from 0 at edges to 255 in the
 * center over `radius` pixels. Used to feather inpainted tiles so they blend
 * smoothly into the existing canvas content.
 */
function createFeatherMask(width: number, height: number, radius: number): Buffer {
  const buf = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dL = x;
      const dR = width - 1 - x;
      const dT = y;
      const dB = height - 1 - y;
      const minDist = Math.min(dL, dR, dT, dB);
      const alpha = Math.min(1, minDist / radius);
      buf[y * width + x] = Math.round(alpha * 255);
    }
  }
  return buf;
}

function parseJobPromptAndFrame(rawPrompt: string): {
  prompt: string;
  frameWidth?: number;
  frameHeight?: number;
} {
  const match = rawPrompt.match(/\[\[FRAME:(\d+)x(\d+)\]\]\s*$/);
  if (!match) return { prompt: rawPrompt.trim() };
  const frameWidth = Number.parseInt(match[1], 10);
  const frameHeight = Number.parseInt(match[2], 10);
  const prompt = rawPrompt.replace(/\s*\[\[FRAME:\d+x\d+\]\]\s*$/, '').trim();
  return { prompt, frameWidth, frameHeight };
}

/**
 * Build a context image for inpainting using ONLY the selection area content.
 * By sending just the selection area, the model naturally sizes generated
 * content to fit within the frame — no boundary markers or cropping needed.
 */
async function buildContextImage(
  fx: number,
  fy: number,
  fw: number,
  fh: number
): Promise<string | undefined> {
  console.log(`  📐 Building context for selection: (${fx},${fy}) ${fw}x${fh}`);

  const { data: tiles } = await supabase
    .from('canvas_tiles')
    .select('x, y, current_prompt, current_image_url')
    .not('current_image_url', 'is', null);

  if (!tiles || tiles.length === 0) return undefined;

  interface OverlapInfo {
    imageUrl: string;
    px: number;
    py: number;
    pw: number;
    ph: number;
  }

  const overlapping: OverlapInfo[] = [];
  for (const tile of tiles) {
    const isGrid = tile.x < CANVAS_WIDTH && tile.y < CANVAS_HEIGHT;
    const px = isGrid ? tile.x * TILE_SIZE_PX : tile.x;
    const py = isGrid ? tile.y * TILE_SIZE_PX : tile.y;

    // Determine tile display size from [[SIZE:WxH]] tag or defaults
    let pw = isGrid ? TILE_SIZE_PX : FRAME_WIDTH;
    let ph = isGrid ? TILE_SIZE_PX : FRAME_HEIGHT;
    const sizeMatch = (tile.current_prompt ?? '').match(/\[\[SIZE:(\d+)x(\d+)\]\]/);
    if (sizeMatch && !isGrid) {
      pw = Number.parseInt(sizeMatch[1], 10);
      ph = Number.parseInt(sizeMatch[2], 10);
    }

    if (px + pw > fx && px < fx + fw && py + ph > fy && py < fy + fh) {
      overlapping.push({ imageUrl: tile.current_image_url, px, py, pw, ph });
    }
  }

  if (overlapping.length === 0) return undefined;

  console.log(`  📐 Found ${overlapping.length} overlapping tile(s) for context`);

  const composites: sharp.OverlayOptions[] = [];

  for (const tile of overlapping) {
    try {
      const response = await fetch(tile.imageUrl);
      if (!response.ok) continue;
      const imageBuffer = Buffer.from(await (await response.blob()).arrayBuffer());

      const resized = await sharp(imageBuffer)
        .resize(tile.pw, tile.ph, { fit: 'cover' })
        .toBuffer();

      const cropLeft = Math.max(0, fx - tile.px);
      const cropTop = Math.max(0, fy - tile.py);
      const overlapRight = Math.min(tile.px + tile.pw, fx + fw);
      const overlapBottom = Math.min(tile.py + tile.ph, fy + fh);
      const cropWidth = overlapRight - Math.max(tile.px, fx);
      const cropHeight = overlapBottom - Math.max(tile.py, fy);

      if (cropWidth <= 0 || cropHeight <= 0) continue;

      const cropped = await sharp(resized)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .toBuffer();

      composites.push({
        input: cropped,
        left: Math.max(0, tile.px - fx),
        top: Math.max(0, tile.py - fy),
      });
    } catch (err) {
      console.warn(`  ⚠️ Failed to fetch tile at (${tile.px}, ${tile.py}):`, err);
    }
  }

  if (composites.length === 0) return undefined;

  const baseRaw = makeSolidBackground(fw, fh);
  const contextBuffer = await sharp(baseRaw, {
    raw: { width: fw, height: fh, channels: 4 },
  })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();

  const base64 = contextBuffer.toString('base64');
  console.log(`  📸 Context image: ${(contextBuffer.length / 1024).toFixed(0)} KB buffer, ${(base64.length / 1024).toFixed(0)} KB base64 (${fw}x${fh})`);

  return base64;
}

async function processJob(jobId: string) {
  console.log(`Processing job ${jobId}`);

  try {
    const { data: updateData, error: updateError } = await supabase
      .from('generation_jobs')
      .update({ status: 'running' })
      .eq('id', jobId)
      .eq('status', 'queued')
      .select('id');

    if (updateError || !updateData || updateData.length === 0) {
      console.log(`Job ${jobId} already claimed by another process, skipping`);
      return;
    }

    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`Failed to fetch job ${jobId}:`, jobError);
      return;
    }

    const fx = (job.frame_x ?? job.x) ?? 0;
    const fy = (job.frame_y ?? job.y) ?? 0;
    const parsed = parseJobPromptAndFrame(job.prompt);
    const cleanPrompt = parsed.prompt;
    const isFrameJob =
      job.frame_x != null ||
      job.frame_y != null ||
      job.frame_width != null ||
      job.frame_height != null ||
      fx > 50 ||
      fy > 50;
    const fw = isFrameJob
      ? parsed.frameWidth ?? job.frame_width ?? FRAME_WIDTH
      : GENERATED_IMAGE_SIZE;
    const fh = isFrameJob
      ? parsed.frameHeight ?? job.frame_height ?? FRAME_HEIGHT
      : GENERATED_IMAGE_SIZE;

    console.log(
      `Generating image for job ${jobId} (${isFrameJob ? 'frame' : 'tile'}) at (${fx},${fy}) ${fw}x${fh}`
    );
    console.log(`  Prompt: "${cleanPrompt}"`);

    let imageUrl: string;

    try {
      // Build context image from overlapping existing tiles (inpainting)
      let contextBase64: string | undefined;
      if (isFrameJob) {
        contextBase64 = await buildContextImage(fx, fy, fw, fh);
        if (contextBase64) {
          console.log('  🎨 Using inpainting (existing content found in selection)');
        } else {
          console.log('  🆕 No overlapping content, generating fresh');
        }
      }

      const generatedUrl = await generateImage(cleanPrompt, contextBase64);
      console.log(`Generated URL type: ${generatedUrl.substring(0, 50)}...`);

      let imageBuffer: Buffer;

      if (generatedUrl.startsWith('data:image/')) {
        const commaIndex = generatedUrl.indexOf(',');
        if (commaIndex === -1) {
          throw new Error('Invalid base64 data URL format: no comma found');
        }
        const base64Data = generatedUrl.substring(commaIndex + 1);
        if (!base64Data || base64Data.length < 100) {
          throw new Error('Invalid base64 data URL format: data too short');
        }
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        const imageResponse = await fetch(generatedUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download image: ${imageResponse.statusText}`);
        }
        imageBuffer = Buffer.from(await (await imageResponse.blob()).arrayBuffer());
      }

      const metadata = await sharp(imageBuffer).metadata();
      const modelW = metadata.width ?? 1024;
      const modelH = metadata.height ?? 1024;
      console.log(`  Model output: ${metadata.format} ${modelW}x${modelH}`);

      const targetW = isFrameJob ? fw : GENERATED_IMAGE_SIZE;
      const targetH = isFrameJob ? fh : GENERATED_IMAGE_SIZE;

      let processedBuffer = await sharp(imageBuffer)
        .resize(targetW, targetH, { fit: 'cover', position: 'center' })
        .png({ quality: 100, compressionLevel: 6 })
        .toBuffer();

      // Feather the edges of inpainted tiles so they blend into existing content
      if (contextBase64) {
        const featherRadius = Math.round(Math.min(targetW, targetH) * 0.12);
        console.log(`  🌫️ Feathering edges (radius: ${featherRadius}px)`);
        const maskRaw = createFeatherMask(targetW, targetH, featherRadius);
        const maskPng = await sharp(maskRaw, {
          raw: { width: targetW, height: targetH, channels: 1 },
        })
          .png()
          .toBuffer();

        const rgbBuffer = await sharp(processedBuffer).removeAlpha().toBuffer();
        processedBuffer = await sharp(rgbBuffer)
          .joinChannel(maskPng)
          .png({ compressionLevel: 6 })
          .toBuffer();
      }

      console.log(
        `  Processed to ${targetW}x${targetH}: ${(processedBuffer.length / 1024).toFixed(0)} KB`
      );

      const maxSize = 5 * 1024 * 1024;
      const hasAlpha = !!contextBase64;
      if (!hasAlpha && processedBuffer.length > maxSize) {
        console.log('Image still too large, converting to high-quality JPEG...');
        processedBuffer = await sharp(imageBuffer)
          .resize(targetW, targetH, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 92, mozjpeg: true, progressive: true })
          .toBuffer();
        console.log(
          `Compressed to JPEG: ${processedBuffer.length} bytes (${(processedBuffer.length / 1024 / 1024).toFixed(2)} MB)`
        );
      }

      // Feathered (inpainted) tiles must stay PNG to preserve alpha transparency
      const useJpeg = !hasAlpha && (
        processedBuffer.length > maxSize ||
        processedBuffer.length < imageBuffer.length * 0.5
      );
      const fileExtension = useJpeg ? 'jpg' : 'png';
      const contentType = useJpeg ? 'image/jpeg' : 'image/png';

      const fileName = `${fx}_${fy}_${Date.now()}.${fileExtension}`;
      console.log(`Uploading image as ${fileExtension} (${contentType})...`);

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('tile-images')
        .upload(fileName, processedBuffer, { contentType, upsert: false });

      if (uploadError) {
        console.error('Upload error details:', uploadError);
        throw new Error(`Failed to upload image: ${uploadError.message}`);
      }
      if (!uploadData) {
        throw new Error('Upload succeeded but no data returned');
      }

      console.log(`✅ Image uploaded successfully: ${fileName}`);

      const { data: urlData } = supabase.storage
        .from('tile-images')
        .getPublicUrl(fileName);

      if (!urlData?.publicUrl) {
        throw new Error('Failed to get public URL for uploaded image');
      }

      imageUrl = urlData.publicUrl;
      console.log(`✅ Public URL generated: ${imageUrl}`);

      try {
        const verifyResponse = await fetch(imageUrl, { method: 'HEAD' });
        if (!verifyResponse.ok) {
          console.warn(
            `⚠️ Image URL verification failed: ${verifyResponse.status}`
          );
        } else {
          console.log(`✅ Image URL verified - accessible at ${imageUrl}`);
        }
      } catch (verifyError) {
        console.warn('⚠️ Could not verify image URL (non-critical)');
      }
    } catch (error) {
      console.error(`Image generation failed for job ${jobId}:`, error);
      await supabase
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', jobId);
      return;
    }

    const { error: tileError } = await supabase.from('canvas_tiles').upsert(
      {
        x: fx,
        y: fy,
        current_image_url: imageUrl,
        current_prompt: `${cleanPrompt}\n[[SIZE:${fw}x${fh}]]`,
        updated_by: job.user_id,
        lock_until: null,
        lock_by: null,
        version: 1,
      },
      { onConflict: 'x,y' }
    );
    if (tileError) {
      console.error('Failed to upsert canvas_tile:', tileError);
      await supabase
        .from('generation_jobs')
        .update({ status: 'failed', error: tileError.message })
        .eq('id', jobId);
      return;
    }
    await supabase
      .from('generation_jobs')
      .update({ status: 'succeeded', result_image_url: imageUrl })
      .eq('id', jobId);
    console.log(
      `✅ Job ${jobId} completed - tile upserted at (${fx}, ${fy}) ${fw}x${fh}`
    );
  } catch (error) {
    console.error(`Unexpected error processing job ${jobId}:`, error);
    await supabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unexpected error',
      })
      .eq('id', jobId);
  }
}

let isProcessing = false;

async function pollJobs() {
  if (isProcessing) return; // Prevent overlapping job processing

  const { data: jobs, error } = await supabase
    .from('generation_jobs')
    .select('id, status, created_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error polling jobs:', error);
    return;
  }

  if (jobs && jobs.length > 0) {
    isProcessing = true;
    try {
      console.log(`Found ${jobs.length} queued job(s), processing...`);
      await processJob(jobs[0].id);
    } finally {
      isProcessing = false;
    }
  } else {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckJobs } = await supabase
      .from('generation_jobs')
      .select('id, status, created_at')
      .eq('status', 'running')
      .lt('created_at', fiveMinutesAgo)
      .limit(1);

    if (stuckJobs && stuckJobs.length > 0) {
      console.log(
        `Found ${stuckJobs.length} stuck running job(s), resetting to queued...`
      );
      await supabase
        .from('generation_jobs')
        .update({ status: 'queued' })
        .eq('id', stuckJobs[0].id);
    }
  }
}

console.log('=========================================');
console.log(`Worker v${WORKER_VERSION} started`);
console.log('Context-aware outpainting enabled');
console.log('Polling interval:', WORKER_POLL_INTERVAL_MS, 'ms');
console.log('=========================================');
setInterval(pollJobs, WORKER_POLL_INTERVAL_MS);
pollJobs();
