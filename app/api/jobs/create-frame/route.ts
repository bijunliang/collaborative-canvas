import { createServiceRoleSupabase } from '@/lib/supabase/server';
import {
  MAX_PROMPT_LENGTH,
  CANVAS_WIDTH_PX,
  CANVAS_HEIGHT_PX,
  FRAME_WIDTH,
  FRAME_HEIGHT,
} from '@/lib/constants';
import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl, triggerJobProcess } from '@/lib/job-process-trigger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { frame_x, frame_y, frame_width, frame_height, prompt } = body;
    const fw = typeof frame_width === 'number' ? Math.round(frame_width) : FRAME_WIDTH;
    const fh = typeof frame_height === 'number' ? Math.round(frame_height) : FRAME_HEIGHT;

    if (
      typeof frame_x !== 'number' ||
      typeof frame_y !== 'number' ||
      frame_x < 0 ||
      frame_y < 0 ||
      fw <= 0 ||
      fh <= 0 ||
      frame_x + fw > CANVAS_WIDTH_PX ||
      frame_y + fh > CANVAS_HEIGHT_PX
    ) {
      return NextResponse.json(
        { error: 'Invalid frame position' },
        { status: 400 }
      );
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `Prompt exceeds ${MAX_PROMPT_LENGTH} characters` },
        { status: 400 }
      );
    }

    if (!process.env.COMETAPI_KEY) {
      return NextResponse.json(
        { error: 'Generation not configured. Add COMETAPI_KEY to your environment.' },
        { status: 503 }
      );
    }

    const supabase = createServiceRoleSupabase();
    const fx = Math.round(frame_x);
    const fy = Math.round(frame_y);

    // Insert job — use x,y directly (frame_x/y/width/height columns may not exist)
    const { data: job, error: insertError } = await supabase
      .from('generation_jobs')
      .insert({
        x: fx,
        y: fy,
        prompt: `${prompt.trim()}\n[[FRAME:${fw}x${fh}]]`,
        status: 'queued',
        user_id: null,
      })
      .select()
      .single();

    if (insertError || !job) {
      console.error('Job create error:', insertError);
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create job' },
        { status: 500 }
      );
    }

    // Kick the job processor (waitUntil so Vercel doesn’t drop the outbound fetch).
    const baseUrl = getAppBaseUrl(request);
    if (process.env.COMETAPI_KEY) {
      triggerJobProcess(baseUrl);
    }

    return NextResponse.json({
      success: true,
      job: {
        id: (job as Record<string, unknown>).id,
        frame_x: fx,
        frame_y: fy,
        prompt: prompt.trim(),
        status: 'queued',
      },
    });
  } catch (e) {
    console.error('Create frame job error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 }
    );
  }
}
