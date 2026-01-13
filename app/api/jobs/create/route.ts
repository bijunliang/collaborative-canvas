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
    const { x, y, prompt } = await request.json();

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

    // Check 1: User has no active jobs (queued or running)
    const { data: activeJobs, error: activeJobsError } = await serviceSupabase
      .from('generation_jobs')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['queued', 'running']);

    if (activeJobsError) {
      console.error('Error checking active jobs:', activeJobsError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (activeJobs && activeJobs.length > 0) {
      return NextResponse.json(
        { error: 'You already have a generation in progress' },
        { status: 409 }
      );
    }

    // Check 2: User cooldown
    const { data: cooldown, error: cooldownError } = await serviceSupabase
      .from('user_cooldowns')
      .select('cooldown_until')
      .eq('user_id', userId)
      .single();

    if (cooldownError && cooldownError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is fine
      console.error('Error checking cooldown:', cooldownError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (cooldown && new Date(cooldown.cooldown_until) > new Date()) {
      const remainingSeconds = Math.ceil(
        (new Date(cooldown.cooldown_until).getTime() - Date.now()) / 1000
      );
      return NextResponse.json(
        { error: `You are on cooldown. Please wait ${remainingSeconds} seconds.` },
        { status: 429 }
      );
    }

    // Check 3: User owns the tile lock
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
          lock_by: userId,
        });

      if (createError) {
        console.error('Error creating tile:', createError);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    } else {
      // Check if user owns the lock
      if (!tile.lock_by || tile.lock_by !== userId) {
        return NextResponse.json(
          { error: 'You must lock the tile first' },
          { status: 403 }
        );
      }

      // Check if lock is still valid
      if (tile.lock_until && new Date(tile.lock_until) < new Date()) {
        return NextResponse.json(
          { error: 'Tile lock has expired. Please lock the tile again.' },
          { status: 403 }
        );
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
        user_id: userId,
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job:', jobError);
      return NextResponse.json(
        { error: 'Failed to create generation job' },
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
