import { createServerSupabase, createServiceRoleSupabase } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();

    if (!jobId || typeof jobId !== 'string') {
      return NextResponse.json(
        { error: 'Job ID is required' },
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

    // Check if job exists and belongs to user
    const { data: job, error: fetchError } = await serviceSupabase
      .from('generation_jobs')
      .select('id, status, x, y')
      .eq('id', jobId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    // Only allow cancellation of queued or running jobs
    if (job.status !== 'queued' && job.status !== 'running') {
      return NextResponse.json(
        { error: 'Job cannot be cancelled in its current state' },
        { status: 400 }
      );
    }

    // Update job status to failed (cancelled)
    const { error: updateError } = await serviceSupabase
      .from('generation_jobs')
      .update({
        status: 'failed',
        error: 'Cancelled by user',
      })
      .eq('id', jobId);

    if (updateError) {
      console.error('Error cancelling job:', updateError);
      return NextResponse.json(
        { error: 'Failed to cancel job' },
        { status: 500 }
      );
    }

    // Clear the tile lock
    const { error: lockError } = await serviceSupabase
      .from('canvas_tiles')
      .update({
        lock_until: null,
        lock_by: null,
      })
      .eq('x', job.x)
      .eq('y', job.y);

    if (lockError) {
      console.error('Error clearing lock:', lockError);
      // Don't fail the request if lock clearing fails
    }

    return NextResponse.json({
      success: true,
      message: 'Job cancelled successfully',
    });
  } catch (error) {
    console.error('Job cancellation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
