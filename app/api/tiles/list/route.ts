import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createServiceRoleSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    await headers(); // Force dynamic execution
    const supabase = createServiceRoleSupabase();
    const { data, error } = await supabase
      .from('canvas_tiles')
      .select('*')
      .limit(10000);

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { tiles: data ?? [] },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

