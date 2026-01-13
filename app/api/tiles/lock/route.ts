import { createServerSupabase, createServiceRoleSupabase } from '@/lib/supabase/server';
import { TILE_LOCK_DURATION_SECONDS, CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/constants';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { x, y } = await request.json();

    // Validate coordinates
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      x < 0 ||
      y < 0 ||
      x >= CANVAS_WIDTH ||
      y >= CANVAS_HEIGHT
    ) {
      return NextResponse.json(
        { error: 'Invalid coordinates' },
        { status: 400 }
      );
    }

    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = user.id;
    const serviceSupabase = createServiceRoleSupabase();

    // Atomic lock acquisition
    // First, ensure tile exists
    const { data: existingTile } = await serviceSupabase
      .from('canvas_tiles')
      .select('*')
      .eq('x', x)
      .eq('y', y)
      .single();

    if (!existingTile) {
      // Create tile if it doesn't exist
      const { data: newTile, error: createError } = await serviceSupabase
        .from('canvas_tiles')
        .insert({
          x,
          y,
          lock_until: new Date(Date.now() + TILE_LOCK_DURATION_SECONDS * 1000).toISOString(),
          lock_by: userId,
        })
        .select()
        .single();

      if (createError || !newTile) {
        return NextResponse.json(
          { error: 'Failed to create tile lock' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        lock_until: newTile.lock_until,
        lock_by: newTile.lock_by,
      });
    }

    // Try to acquire lock atomically
    const lockUntil = new Date(Date.now() + TILE_LOCK_DURATION_SECONDS * 1000).toISOString();
      const { data: tileData, error: lockError } = await serviceSupabase
        .from('canvas_tiles')
        .update({
          lock_until: lockUntil,
          lock_by: userId,
        })
        .eq('x', x)
        .eq('y', y)
        .or(`lock_until.is.null,lock_until.lt.${new Date().toISOString()}`)
        .select()
        .single();

      if (lockError || !tileData) {
        return NextResponse.json(
          { error: 'Failed to acquire lock. Tile may be locked by another user.' },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        lock_until: tileData.lock_until,
        lock_by: tileData.lock_by,
      });
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to acquire lock. Tile may be locked by another user.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      lock_until: data.lock_until,
      lock_by: data.lock_by,
    });
  } catch (error) {
    console.error('Lock acquisition error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
