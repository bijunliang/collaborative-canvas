import { NextResponse } from 'next/server';
import { createServiceRoleSupabase } from '@/lib/supabase/server';
import sharp from 'sharp';
import {
  CANVAS_WIDTH,
  CANVAS_WIDTH_PX,
  CANVAS_HEIGHT,
  TILE_SIZE_PX,
  FRAME_WIDTH,
  FRAME_HEIGHT,
} from '@/lib/constants';

const COMETAPI_BASE_URL = 'https://api.cometapi.com';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

function todayIsoUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function fallbackTitle(promptHints: string[], dayKey: string): string {
  const seeds = [
    'Study in Collective Marks',
    'Fragments of a Shared Surface',
    'Assembly Without a Single Author',
    'Mural in Many Voices',
    'Accumulation Number Seven',
  ];
  const hashBase = `${dayKey}|${promptHints.join('|')}`;
  let hash = 0;
  for (let i = 0; i < hashBase.length; i += 1) hash = (hash * 31 + hashBase.charCodeAt(i)) >>> 0;
  return seeds[hash % seeds.length];
}

function parseTileSizeFromPrompt(rawPrompt: string | null): { w: number; h: number } | null {
  if (!rawPrompt) return null;
  const match = rawPrompt.match(/\[\[SIZE:(\d+)x(\d+)\]\]/);
  if (!match) return null;
  return { w: Number.parseInt(match[1], 10), h: Number.parseInt(match[2], 10) };
}

async function buildDownscaledCanvasCompositeBase64(
  tiles: Array<{ x: number; y: number; current_image_url: string; current_prompt: string | null }>,
  targetSize: number
): Promise<string | null> {
  const scale = targetSize / CANVAS_WIDTH_PX;
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const baseRaw = Buffer.alloc(targetSize * targetSize * 4, 0);
  // Simple neutral background with alpha=255. (Sharp needs a consistent alpha channel.)
  for (let i = 0; i < targetSize * targetSize; i++) {
    const idx = i * 4;
    baseRaw[idx] = 245;
    baseRaw[idx + 1] = 242;
    baseRaw[idx + 2] = 238;
    baseRaw[idx + 3] = 255;
  }

  const composites: sharp.OverlayOptions[] = [];

  for (const tile of tiles) {
    const tx = tile.x;
    const ty = tile.y;

    const isGrid = tx < CANVAS_WIDTH && ty < CANVAS_HEIGHT;
    const px = isGrid ? tx * TILE_SIZE_PX : tx;
    const py = isGrid ? ty * TILE_SIZE_PX : ty;

    const size = isGrid ? { w: TILE_SIZE_PX, h: TILE_SIZE_PX } : parseTileSizeFromPrompt(tile.current_prompt);
    const pw = size?.w ?? FRAME_WIDTH;
    const ph = size?.h ?? FRAME_HEIGHT;

    const left = Math.round(px * scale);
    const top = Math.round(py * scale);
    const width = Math.max(1, Math.round(pw * scale));
    const height = Math.max(1, Math.round(ph * scale));

    if (left >= targetSize || top >= targetSize) continue;

    try {
      const response = await fetch(tile.current_image_url);
      if (!response.ok) continue;
      const imageBuffer = Buffer.from(await (await response.blob()).arrayBuffer());

      const resized = await sharp(imageBuffer)
        .resize(width, height, { fit: 'cover', position: 'center' })
        .toBuffer();

      composites.push({
        input: resized,
        left,
        top,
      });
    } catch {
      // Skip tiles that fail to download/parse.
    }
  }

  if (composites.length === 0) return null;

  const canvasBuffer = await sharp(baseRaw, {
    raw: { width: targetSize, height: targetSize, channels: 4 },
  })
    .composite(composites)
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  return canvasBuffer.toString('base64');
}

async function artTitleFromCanvasImage(
  canvasCompositeBase64: string
): Promise<string | null> {
  const apiKey = process.env.COMETAPI_KEY;
  if (!apiKey) return null;

  const instruction = [
    'You are titling a single collaborative digital painting shown in this image (the full mural).',
    'Reply with ONE short exhibition-style title as on a gallery placard: 3 to 7 words.',
    'Evocative and specific to what you see; not generic.',
    'No subtitle, no quotes, no trailing punctuation, no explanation.',
    'Do not transcribe or copy any legible text that appears inside the artwork.',
    'Plain title only, title case or sentence case is fine.',
  ].join(' ');

  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: canvasCompositeBase64,
            },
          },
          { text: instruction },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT'],
    },
  };

  const endpoint = `${COMETAPI_BASE_URL}/v1beta/models/${IMAGE_MODEL}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text?.trim();
  if (!text) return null;
  const cleaned = text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ');
  return cleaned.slice(0, 120);
}

export async function GET() {
  try {
    const supabase = createServiceRoleSupabase();
    const dayKey = todayIsoUTC();

    const { data, error } = await supabase
      .from('canvas_tiles')
      .select('x, y, current_image_url, current_prompt')
      .not('current_image_url', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(2000);

    if (error || !data || data.length === 0) {
      return NextResponse.json(
        { title: 'Untitled', generatedAt: dayKey },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Fallback hints are still useful if composite generation fails.
    const promptHints = Array.from(
      new Set(
        data
          .map((row) => (row.current_prompt ?? '').trim())
          .filter((v) => v.length > 0)
      )
    ).slice(0, 12);

    const compositeBase64 = await buildDownscaledCanvasCompositeBase64(
      data as Array<{
        x: number;
        y: number;
        current_image_url: string;
        current_prompt: string | null;
      }>,
      1024
    );

    if (!compositeBase64) {
      const title = fallbackTitle(promptHints, dayKey);
      return NextResponse.json(
        { title, generatedAt: dayKey },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const llmTitle = await artTitleFromCanvasImage(compositeBase64);
    const title = llmTitle || fallbackTitle(promptHints, dayKey);

    return NextResponse.json(
      { title, generatedAt: dayKey },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json(
      { title: 'Untitled', generatedAt: todayIsoUTC() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

