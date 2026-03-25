import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createServiceRoleSupabase } from '@/lib/supabase/server';
import {
  TILE_SIZE_PX,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FRAME_WIDTH,
  FRAME_HEIGHT,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await headers();
    const supabase = createServiceRoleSupabase();

    const { data, error } = await supabase
      .from('canvas_tiles')
      .select('*')
      .not('current_image_url', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const patches = (data ?? []).map((tile: Record<string, unknown>) => {
      const tx = tile.x as number;
      const ty = tile.y as number;
      const isGridTile = tx < CANVAS_WIDTH && ty < CANVAS_HEIGHT;
      const rawPrompt = (tile.current_prompt as string | null) ?? null;
      const sizeMatch = rawPrompt?.match(/\[\[SIZE:(\d+)x(\d+)\]\]\s*$/);
      const parsedWidth = sizeMatch ? Number.parseInt(sizeMatch[1], 10) : null;
      const parsedHeight = sizeMatch ? Number.parseInt(sizeMatch[2], 10) : null;
      const cleanedPrompt = rawPrompt
        ? rawPrompt.replace(/\s*\[\[SIZE:\d+x\d+\]\]\s*$/, '').trim()
        : null;

      return {
        id: `${tx}_${ty}`,
        x: isGridTile ? tx * TILE_SIZE_PX : tx,
        y: isGridTile ? ty * TILE_SIZE_PX : ty,
        width: isGridTile ? TILE_SIZE_PX : parsedWidth ?? FRAME_WIDTH,
        height: isGridTile ? TILE_SIZE_PX : parsedHeight ?? FRAME_HEIGHT,
        image_url: tile.current_image_url,
        prompt: cleanedPrompt,
        updated_by: tile.updated_by,
        updated_at: tile.updated_at,
        lock_until: tile.lock_until,
        lock_by: tile.lock_by,
      };
    });

    return NextResponse.json(
      { patches },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
