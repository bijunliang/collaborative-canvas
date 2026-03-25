/**
 * Wipe all painted tiles from the DB so the merged canvas starts empty.
 * Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: npx tsx scripts/clear-canvas.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // Match all rows (x is always >= 0 per schema)
  const { error: tilesErr, count } = await supabase
    .from('canvas_tiles')
    .delete({ count: 'exact' })
    .gte('x', 0);

  if (tilesErr) {
    console.error('canvas_tiles delete failed:', tilesErr.message);
    process.exit(1);
  }

  console.log(`Deleted ${count ?? '?'} canvas_tiles row(s).`);

  const { error: patchesErr } = await supabase.from('canvas_patches').delete().gte('x', 0);
  if (
    patchesErr &&
    !/does not exist|schema cache/i.test(patchesErr.message)
  ) {
    console.warn('canvas_patches:', patchesErr.message);
  } else if (!patchesErr) {
    console.log('Cleared canvas_patches.');
  }

  const { error: jobsErr } = await supabase
    .from('generation_jobs')
    .delete()
    .in('status', ['queued', 'running']);

  if (jobsErr) {
    console.warn('generation_jobs cleanup:', jobsErr.message);
  } else {
    console.log('Removed queued/running generation_jobs.');
  }

  console.log('Done — refresh the app to see an empty canvas.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
