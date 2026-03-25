'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { createClientSupabase } from '@/lib/supabase/client';
import type { CanvasPatch } from '@/lib/types';
import MergedCanvas from '@/components/MergedCanvas';
import { soundManager } from '@/lib/sounds';

const AUTH_LOADING_TIMEOUT_MS = 12_000;

/** When tile updates before job row shows "succeeded", abort polling so UI can clear */
function normalizeJobStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

export default function Home() {
  const [patches, setPatches] = useState<CanvasPatch[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const supabase = useMemo(() => createClientSupabase(), []);

  const jobPollAbortRef = useRef(false);
  const tileWatchRef = useRef<{
    fx: number;
    fy: number;
    prevImageUrl: string | null;
  } | null>(null);

  useEffect(() => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setIsLoading(false);
    };

    const timeoutId = window.setTimeout(() => {
      console.warn('Auth init exceeded timeout — showing canvas anyway');
      finish();
    }, AUTH_LOADING_TIMEOUT_MS);

    const ensureAuth = async () => {
      try {
        const { data: { user }, error: getErr } = await supabase.auth.getUser();
        if (getErr) console.warn('getUser:', getErr.message);
        if (!user) {
          const { error: signErr } = await supabase.auth.signInAnonymously();
          if (signErr) console.warn('signInAnonymously:', signErr.message);
        }
      } catch (e) {
        console.error('Auth init error:', e);
      } finally {
        window.clearTimeout(timeoutId);
        finish();
      }
    };
    ensureAuth();

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [supabase]);

  const loadPatches = async () => {
    try {
      const res = await fetch('/api/patches/list', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load patches');
      const { patches: data } = await res.json();
      setPatches(data ?? []);
    } catch (err) {
      console.error('Load patches error:', err);
      setPatches([]);
    }
  };

  useEffect(() => {
    loadPatches();
    const interval = setInterval(loadPatches, 3000);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('canvas-tiles-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'canvas_tiles' }, () => {
          loadPatches();
        })
        .subscribe();
    } catch (_) {
    }

    return () => {
      clearInterval(interval);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const waitForJobCompletion = async (
    jobId: string
  ): Promise<'done' | 'aborted'> => {
    const terminal = new Set(['succeeded', 'failed']);
    const started = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - started < timeoutMs) {
      if (jobPollAbortRef.current) {
        jobPollAbortRef.current = false;
        return 'aborted';
      }
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as {
          status?: string;
          error?: string | null;
        };
        const st = normalizeJobStatus(data.status);
        if (st && terminal.has(st)) {
          if (st === 'failed') {
            throw new Error(data.error || 'Generation failed');
          }
          return 'done';
        }
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    throw new Error('Generation timed out');
  };

  useEffect(() => {
    const w = tileWatchRef.current;
    if (!isGenerating || !w) return;
    const patch = patches.find((p) => p.x === w.fx && p.y === w.fy);
    if (!patch?.image_url) return;
    if (patch.image_url === w.prevImageUrl) return;
    tileWatchRef.current = null;
    jobPollAbortRef.current = true;
    setIsGenerating(false);
    soundManager.playGenerationComplete();
  }, [patches, isGenerating]);

  const handleGenerate = async (
    frameX: number,
    frameY: number,
    frameWidth: number,
    frameHeight: number,
    prompt: string
  ) => {
    jobPollAbortRef.current = false;
    const existing = patches.find((p) => p.x === frameX && p.y === frameY);
    tileWatchRef.current = {
      fx: frameX,
      fy: frameY,
      prevImageUrl: existing?.image_url ?? null,
    };

    setIsGenerating(true);
    soundManager.playGenerationStart();
    try {
      const res = await fetch('/api/jobs/create-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          frame_x: frameX,
          frame_y: frameY,
          frame_width: frameWidth,
          frame_height: frameHeight,
          prompt,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create job');
      }
      const body = (await res.json()) as { job?: { id?: unknown } };
      const rawId = body.job?.id;
      const jobId = typeof rawId === 'string' ? rawId : rawId != null ? String(rawId) : '';
      if (jobId) {
        const outcome = await waitForJobCompletion(jobId);
        if (outcome === 'done') {
          tileWatchRef.current = null;
          soundManager.playGenerationComplete();
        }
      }
      await loadPatches();
    } catch (err) {
      soundManager.playError();
      throw err;
    } finally {
      tileWatchRef.current = null;
      jobPollAbortRef.current = false;
      setIsGenerating(false);
    }
  };

  if (isLoading) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-gray-100">
        <p className="text-gray-600">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col" style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <MergedCanvas
          patches={patches}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
        />
      </div>
    </main>
  );
}
