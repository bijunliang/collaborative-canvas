import { createServerSupabase, createServiceRoleSupabase } from '@/lib/supabase/server';
import {
  MAX_PROMPT_LENGTH,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  USER_COOLDOWN_SECONDS,
} from '@/lib/constants';
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

    const { x, y, prompt } = requestBody;

    // Validate input
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

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters` },
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
    
    // Use null for anonymous users (after migration makes user_id nullable)
    const anonymousUserId = null;

    // Skip user-specific checks (cooldowns, active jobs) since auth is not required
    // Check: Tile lock status
    const { data: tile, error: tileError } = await serviceSupabase
      .from('canvas_tiles')
      .select('lock_by, lock_until')
      .eq('x', x)
      .eq('y', y)
      .single();

    if (tileError) {
      // Tile might not exist yet, create it
      const { error: createError } = await serviceSupabase
        .from('canvas_tiles')
        .insert({
          x,
          y,
          lock_until: new Date(Date.now() + 90 * 1000).toISOString(),
          lock_by: anonymousUserId,
        });

      if (createError) {
        console.error('Error creating tile:', createError);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    } else {
      // Check if lock is still valid (no user ownership check since auth is not required)
      if (tile.lock_until && new Date(tile.lock_until) > new Date()) {
        // Lock is still valid, proceed
      } else {
        // Lock expired or doesn't exist, that's fine - we'll proceed
      }
    }

    // Create the job
    const { data: job, error: jobError } = await serviceSupabase
      .from('generation_jobs')
      .insert({
        x,
        y,
        prompt: prompt.trim(),
        status: 'queued',
        user_id: anonymousUserId,
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job:', jobError);
      // Check if it's a NOT NULL constraint error
      if (jobError.code === '23502' || jobError.message?.includes('not-null constraint') || jobError.message?.includes('null value')) {
        return NextResponse.json(
          { error: 'Database migration incomplete. The user_id column in generation_jobs still requires a value. Please run migration 004_fix_user_id_nullable.sql in Supabase SQL Editor.' },
          { status: 500 }
        );
      }
      // Check if it's a foreign key constraint error
      if (jobError.code === '23503' || jobError.message?.includes('foreign key')) {
        return NextResponse.json(
          { error: 'Database migration required. Please run migration 002_make_auth_optional.sql in Supabase.' },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: jobError.message || 'Failed to create generation job' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        x: job.x,
        y: job.y,
        prompt: job.prompt,
        status: job.status,
        created_at: job.created_at,
      },
    });
  } catch (error) {
    console.error('Job creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
