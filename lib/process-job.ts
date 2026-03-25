import { SupabaseClient } from '@supabase/supabase-js';
import { generateImage } from './image-generation';
import {
  FRAME_WIDTH,
  FRAME_HEIGHT,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TILE_SIZE_PX,
} from './constants';
import sharp from 'sharp';

const CONTEXT_BG = { r: 240, g: 240, b: 240, alpha: 255 };
const MIN_CONTEXT_SIZE = 1024;

interface ContextResult {
  base64: string;
  expandedX: number;
  expandedY: number;
  expandedW: number;
  expandedH: number;
}

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

function parseTileSize(rawPrompt: string | null): { w: number; h: number } | null {
  if (!rawPrompt) return null;
  const match = rawPrompt.match(/\[\[SIZE:(\d+)x(\d+)\]\]/);
  if (!match) return null;
  return { w: Number.parseInt(match[1], 10), h: Number.parseInt(match[2], 10) };
}

async function buildContextImage(
  supabase: SupabaseClient,
  fx: number,
  fy: number,
  fw: number,
  fh: number
): Promise<ContextResult | undefined> {
  const padX = Math.max(0, Math.floor((MIN_CONTEXT_SIZE - fw) / 2));
  const padY = Math.max(0, Math.floor((MIN_CONTEXT_SIZE - fh) / 2));
  const exX = Math.max(0, fx - padX);
  const exY = Math.max(0, fy - padY);
  const exW = Math.max(MIN_CONTEXT_SIZE, fw + padX * 2);
  const exH = Math.max(MIN_CONTEXT_SIZE, fh + padY * 2);

  const { data: tiles } = await supabase
    .from('canvas_tiles')
    .select('x, y, current_image_url, current_prompt')
    .not('current_image_url', 'is', null);

  if (!tiles || tiles.length === 0) return undefined;

  interface Overlap {
    imageUrl: string;
    px: number;
    py: number;
    pw: number;
    ph: number;
  }

  const overlapping: Overlap[] = [];
  for (const tile of tiles) {
    const isGrid = tile.x < CANVAS_WIDTH && tile.y < CANVAS_HEIGHT;
    const px = isGrid ? tile.x * TILE_SIZE_PX : tile.x;
    const py = isGrid ? tile.y * TILE_SIZE_PX : tile.y;
    const tileSize = parseTileSize(tile.current_prompt);
    const pw = isGrid ? TILE_SIZE_PX : (tileSize?.w ?? FRAME_WIDTH);
    const ph = isGrid ? TILE_SIZE_PX : (tileSize?.h ?? FRAME_HEIGHT);

    if (px + pw > exX && px < exX + exW && py + ph > exY && py < exY + exH) {
      overlapping.push({ imageUrl: tile.current_image_url, px, py, pw, ph });
    }
  }

  if (overlapping.length === 0) return undefined;

  const composites: sharp.OverlayOptions[] = [];

  for (const tile of overlapping) {
    try {
      const response = await fetch(tile.imageUrl);
      if (!response.ok) continue;
      const imageBuffer = Buffer.from(
        await (await response.blob()).arrayBuffer()
      );

      const resized = await sharp(imageBuffer)
        .resize(tile.pw, tile.ph, { fit: 'cover' })
        .toBuffer();

      const cropLeft = Math.max(0, exX - tile.px);
      const cropTop = Math.max(0, exY - tile.py);
      const overlapRight = Math.min(tile.px + tile.pw, exX + exW);
      const overlapBottom = Math.min(tile.py + tile.ph, exY + exH);
      const cropWidth = overlapRight - Math.max(tile.px, exX);
      const cropHeight = overlapBottom - Math.max(tile.py, exY);

      if (cropWidth <= 0 || cropHeight <= 0) continue;

      const cropped = await sharp(resized)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .toBuffer();

      composites.push({
        input: cropped,
        left: Math.max(0, tile.px - exX),
        top: Math.max(0, tile.py - exY),
      });
    } catch {
      // skip failed tiles
    }
  }

  if (composites.length === 0) return undefined;

  const baseRaw = makeSolidBackground(exW, exH);
  const contextBuffer = await sharp(baseRaw, {
    raw: { width: exW, height: exH, channels: 4 },
  })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();

  return {
    base64: contextBuffer.toString('base64'),
    expandedX: exX,
    expandedY: exY,
    expandedW: exW,
    expandedH: exH,
  };
}

export async function processNextJob(
  supabase: SupabaseClient
): Promise<boolean> {
  const { data: jobs, error } = await supabase
    .from('generation_jobs')
    .select('id, status')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error || !jobs || jobs.length === 0) return false;

  const jobId = jobs[0].id;

  try {
    const { error: updateError } = await supabase
      .from('generation_jobs')
      .update({ status: 'running' })
      .eq('id', jobId)
      .eq('status', 'queued');

    if (updateError) return false;

    const { data: job, error: jobError } = await supabase
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) return false;

    const fx = (job.frame_x ?? job.x) ?? 0;
    const fy = (job.frame_y ?? job.y) ?? 0;
    const parsed = parseJobPromptAndFrame(job.prompt);
    const cleanPrompt = parsed.prompt;
    const fw = parsed.frameWidth ?? job.frame_width ?? FRAME_WIDTH;
    const fh = parsed.frameHeight ?? job.frame_height ?? FRAME_HEIGHT;

    let imageUrl: string;

    try {
      let contextBase64: string | undefined;
      let contextResult: ContextResult | undefined;
      contextResult = await buildContextImage(supabase, fx, fy, fw, fh);
      if (contextResult) contextBase64 = contextResult.base64;

      const generatedUrl = await generateImage(cleanPrompt, contextBase64);
      let imageBuffer: Buffer;

      if (generatedUrl.startsWith('data:image/')) {
        const commaIndex = generatedUrl.indexOf(',');
        if (commaIndex === -1) throw new Error('Invalid base64 data URL');
        imageBuffer = Buffer.from(
          generatedUrl.substring(commaIndex + 1),
          'base64'
        );
      } else {
        const imageResponse = await fetch(generatedUrl);
        if (!imageResponse.ok)
          throw new Error(`Failed to download: ${imageResponse.statusText}`);
        imageBuffer = Buffer.from(
          await (await imageResponse.blob()).arrayBuffer()
        );
      }

      // Crop back to user's selection from the expanded context
      if (contextResult) {
        const metadata = await sharp(imageBuffer).metadata();
        const modelW = metadata.width ?? 1024;
        const modelH = metadata.height ?? 1024;
        const { expandedX, expandedY, expandedW, expandedH } = contextResult;
        const scaleX = modelW / expandedW;
        const scaleY = modelH / expandedH;
        const cropX = Math.min(Math.round((fx - expandedX) * scaleX), modelW - 1);
        const cropY = Math.min(Math.round((fy - expandedY) * scaleY), modelH - 1);
        const cropW = Math.max(1, Math.min(Math.round(fw * scaleX), modelW - cropX));
        const cropH = Math.max(1, Math.min(Math.round(fh * scaleY), modelH - cropY));
        imageBuffer = await sharp(imageBuffer)
          .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
          .toBuffer();
      }

      const maxSize = 5 * 1024 * 1024;
      let processedBuffer = await sharp(imageBuffer)
        .resize(fw, fh, { fit: 'cover', position: 'center' })
        .png({ quality: 100, compressionLevel: 6 })
        .toBuffer();

      const useJpeg = processedBuffer.length > maxSize;
      const fileExtension = useJpeg ? 'jpg' : 'png';
      const contentType = useJpeg ? 'image/jpeg' : 'image/png';

      if (processedBuffer.length > maxSize) {
        processedBuffer = await sharp(imageBuffer)
          .resize(fw, fh, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 92, mozjpeg: true, progressive: true })
          .toBuffer();
      }

      const fileName = `${fx}_${fy}_${Date.now()}.${fileExtension}`;
      const { error: uploadError } = await supabase.storage
        .from('tile-images')
        .upload(fileName, processedBuffer, { contentType, upsert: false });

      if (uploadError)
        throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage
        .from('tile-images')
        .getPublicUrl(fileName);
      if (!urlData?.publicUrl) throw new Error('Failed to get public URL');
      imageUrl = urlData.publicUrl;
    } catch (err) {
      await supabase
        .from('generation_jobs')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
        .eq('id', jobId);
      return true;
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
      await supabase
        .from('generation_jobs')
        .update({ status: 'failed', error: tileError.message })
        .eq('id', jobId);
      return true;
    }
    await supabase
      .from('generation_jobs')
      .update({ status: 'succeeded', result_image_url: imageUrl })
      .eq('id', jobId);
    return true;
  } catch (err) {
    console.error('processNextJob error:', err);
    return false;
  }
}
