import { createServerSupabase, createServiceRoleSupabase } from '@/lib/supabase/server';
import { TILE_LOCK_DURATION_SECONDS, CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/constants';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Check environment variables
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables');
      return NextResponse.json(
        { error: 'Server configuration error. Please check environment variables.' },
        { status: 500 }
      );
    }

    let requestBody;
    try {
      requestBody = await request.json();
    } catch (error) {
      console.error('Failed to parse request body:', error);
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const { x, y } = requestBody;

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

    // No authentication required - use service role client
    let serviceSupabase;
    try {
      serviceSupabase = createServiceRoleSupabase();
    } catch (error) {
      console.error('Failed to create Supabase client:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Check if it's a DNS/network error
      if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        return NextResponse.json(
          { error: `Cannot connect to Supabase: DNS lookup failed. Please verify your Supabase project URL in .env.local is correct. Current URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}` },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: `Server configuration error: ${errorMessage}` },
        { status: 500 }
      );
    }
    
    // Use null for anonymous users (requires migration to make columns nullable)
    const anonymousUserId = null;

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
          lock_by: anonymousUserId,
        })
        .select()
        .single();

      if (createError || !newTile) {
        console.error('Failed to create tile lock:', createError);
        console.error('Error details:', JSON.stringify(createError, null, 2));
        // Check if it's a foreign key constraint error
        if (createError?.code === '23503' || createError?.message?.includes('foreign key')) {
          return NextResponse.json(
            { error: 'Database migration required. Please run migration 002_make_auth_optional.sql in Supabase. Error: ' + (createError?.message || 'Foreign key constraint violation') },
            { status: 500 }
          );
        }
        // Check if it's a NOT NULL constraint error
        if (createError?.code === '23502' || createError?.message?.includes('null value') || createError?.message?.includes('NOT NULL')) {
          return NextResponse.json(
            { error: 'Database migration incomplete. The user_id or lock_by column still requires a value. Please verify migration 002_make_auth_optional.sql was applied correctly.' },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: createError?.message || 'Failed to create tile lock. Check server logs for details.' },
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
    // Since auth is not required, we can acquire locks if they're expired or don't exist
    const lockUntil = new Date(Date.now() + TILE_LOCK_DURATION_SECONDS * 1000).toISOString();
    const now = new Date().toISOString();
    
    // Check current lock status first
    const { data: currentTile } = await serviceSupabase
      .from('canvas_tiles')
      .select('lock_until')
      .eq('x', x)
      .eq('y', y)
      .single();
    
    // If tile exists, check if lock is expired
    if (currentTile) {
      const isLocked = currentTile.lock_until && new Date(currentTile.lock_until) > new Date();
      
      if (isLocked) {
        // Lock is still valid - but since auth is not required, we'll be more lenient
        // Allow taking locks that expire soon (within 10 seconds) or have been held for a while
        const lockTime = new Date(currentTile.lock_until).getTime();
        const currentTime = Date.now();
        const timeUntilExpiry = lockTime - currentTime;
        
        // Calculate how long the lock has been held (assuming 90 second lock duration)
        const lockDuration = TILE_LOCK_DURATION_SECONDS * 1000;
        const lockStartTime = lockTime - lockDuration;
        const timeHeld = currentTime - lockStartTime;
        
        // Allow taking lock if:
        // 1. It expires within 10 seconds, OR
        // 2. It's been held for more than 10 seconds (prevents indefinite blocking)
        if (timeUntilExpiry > 10000 && timeHeld < 10000) {
          return NextResponse.json(
            { error: 'Failed to acquire lock. Tile may be locked by another user. Please wait a moment and try again.' },
            { status: 409 }
          );
        }
        // Lock expires soon or has been held for a while - proceed to update it
      }
      
      // Lock is expired or null - update it
      const { data: tileData, error: lockError } = await serviceSupabase
        .from('canvas_tiles')
        .update({
          lock_until: lockUntil,
          lock_by: anonymousUserId,
        })
        .eq('x', x)
        .eq('y', y)
        .select()
        .single();

      if (lockError || !tileData) {
        console.error('Lock update error:', lockError);
        return NextResponse.json(
          { error: 'Failed to acquire lock. Please try again.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        lock_until: tileData.lock_until,
        lock_by: tileData.lock_by,
      });
    } else {
      // Tile doesn't exist - this shouldn't happen since we checked earlier, but handle it
      return NextResponse.json(
        { error: 'Tile not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Lock acquisition error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
