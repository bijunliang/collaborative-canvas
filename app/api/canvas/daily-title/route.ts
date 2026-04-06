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
    'A very serious masterpiece of chaos',
    'When pixels politely argue',
    'Collective dream, slightly caffeinated',
    'Untamed imagination, framed',
    'A group project that somehow works',
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

async function describeCanvasFromImage(
  canvasCompositeBase64: string
): Promise<string | null> {
  const apiKey = process.env.COMETAPI_KEY;
  if (!apiKey) return null;

  const instruction = [
    'Describe the entire collaborative canvas as a witty/humorous caption.',
    'Do NOT include any readable text from the image in your response.',
    'Return ONE short caption (max 24 words).',
    'No quotes. No explanation. Plain text only.',
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
  return text.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 160);
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
        { headers: { 'Cache-Control': 'public, max-age=300' } }
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
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
      );
    }

    const description = await describeCanvasFromImage(compositeBase64);
    const title = description || fallbackTitle(promptHints, dayKey);

    return NextResponse.json(
      { title, generatedAt: dayKey },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );
  } catch {
    return NextResponse.json({ title: 'Untitled', generatedAt: todayIsoUTC() });
  }
}

