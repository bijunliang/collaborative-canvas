import { createServiceRoleSupabase } from '@/lib/supabase/server';
import { processNextJob } from '@/lib/process-job';
import { NextResponse } from 'next/server';

// Allow up to 60s for image generation (Vercel Pro; Hobby is 10s)
export const maxDuration = 60;

export async function GET() {
  try {
    if (!process.env.COMETAPI_KEY) {
      return NextResponse.json(
        { error: 'COMETAPI_KEY not configured. Add it in Vercel Environment Variables.' },
        { status: 500 }
      );
    }

    const supabase = createServiceRoleSupabase();
    const processed = await processNextJob(supabase);
    return NextResponse.json({ processed });
  } catch (error) {
    console.error('Jobs process error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
}
