import type { NextRequest } from 'next/server';
import { waitUntil } from '@vercel/functions';

export function getAppBaseUrl(request: NextRequest): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

/**
 * Invoke /api/jobs/process after queuing a job. On Vercel, a fire-and-forget
 * `fetch` is often aborted when the route returns; `waitUntil` keeps the
 * runtime alive until the processor request completes.
 */
export function triggerJobProcess(baseUrl: string): void {
  const base = baseUrl.replace(/\/$/, '');
  const promise = fetch(`${base}/api/jobs/process`, { method: 'GET' }).then(
    async (res) => {
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error('[triggerJobProcess] non-OK', res.status, t.slice(0, 240));
      }
    },
    (err: unknown) => console.error('[triggerJobProcess] fetch failed', err)
  );

  try {
    waitUntil(promise);
  } catch {
    void promise;
  }
}
