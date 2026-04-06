'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { createClientSupabase } from '@/lib/supabase/client';
import type { CanvasPatch } from '@/lib/types';
import MergedCanvas from '@/components/MergedCanvas';
import VoidChrome from '@/components/VoidChrome';
import { soundManager } from '@/lib/sounds';
import { getQuestionOfDay } from '@/lib/question-of-day';

const AUTH_LOADING_TIMEOUT_MS = 12_000;

/** When tile updates before job row shows "succeeded", abort polling so UI can clear */
function normalizeJobStatus(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

/** Match patch whose top-left is the frame corner, or any patch that contains that point. */
function findPatchForFrame(
  patches: CanvasPatch[],
  frameX: number,
  frameY: number
): CanvasPatch | undefined {
  const exact = patches.find((p) => p.x === frameX && p.y === frameY);
  if (exact) return exact;
  return patches.find(
    (p) =>
      frameX >= p.x &&
      frameY >= p.y &&
      frameX < p.x + p.width &&
      frameY < p.y + p.height
  );
}

export default function Home() {
  const [patches, setPatches] = useState<CanvasPatch[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  /** Unique presence key per tab (one presence row per open client). */
  const presenceKeyRef = useRef<string | null>(null);
  const [onlineCount, setOnlineCount] = useState(1);
  const [dailyTitle, setDailyTitle] = useState('Untitled');
  const [dailyQuestion, setDailyQuestion] = useState(() => getQuestionOfDay(new Date()));
  const dailyQuestionIntervalRef = useRef<number | null>(null);

  const supabase = useMemo(() => createClientSupabase(), []);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    const updateQuestion = () => setDailyQuestion(getQuestionOfDay(new Date()));
    updateQuestion();
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const firstDelay = nextMidnight.getTime() - now.getTime();
    const timeoutId = window.setTimeout(() => {
      updateQuestion();
      dailyQuestionIntervalRef.current = window.setInterval(updateQuestion, 24 * 60 * 60 * 1000);
    }, firstDelay);
    return () => {
      window.clearTimeout(timeoutId);
      if (dailyQuestionIntervalRef.current != null) {
        window.clearInterval(dailyQuestionIntervalRef.current);
        dailyQuestionIntervalRef.current = null;
      }
    };
  }, []);

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

  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;
    presenceChannelRef.current = null;

    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user?.id) return;
      if (!presenceKeyRef.current) {
        presenceKeyRef.current = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      }
      const key = presenceKeyRef.current;
      if (!key) return;

      const channel = supabase.channel('canvas-presence-global', {
        config: { presence: { key } },
      });
      presenceChannelRef.current = channel;

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const n = Object.keys(state).length;
        setOnlineCount(n > 0 ? n : 1);
      });

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ at: Date.now() });
        }
      });

      if (cancelled) {
        void supabase.removeChannel(channel);
        presenceChannelRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      const ch = presenceChannelRef.current;
      if (ch) {
        void supabase.removeChannel(ch);
        presenceChannelRef.current = null;
      }
    };
  }, [isLoading, supabase]);

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

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (patches.length === 0) {
      setDailyTitle('Untitled');
      try {
        localStorage.setItem('daily-canvas-title-cache', JSON.stringify({ date: today, title: 'Untitled' }));
      } catch {
      }
      return;
    }

    try {
      const cachedRaw = localStorage.getItem('daily-canvas-title-cache');
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as { date?: string; title?: string };
        if (cached.date === today && cached.title) {
          setDailyTitle(cached.title);
          return;
        }
      }
    } catch {
    }

    (async () => {
      try {
        const res = await fetch('/api/canvas/daily-title', { cache: 'no-store' });
        if (!res.ok) throw new Error('title request failed');
        const body = (await res.json()) as { title?: string };
        const title = (body.title || 'Untitled').trim() || 'Untitled';
        setDailyTitle(title);
        try {
          localStorage.setItem('daily-canvas-title-cache', JSON.stringify({ date: today, title }));
        } catch {
        }
      } catch {
        setDailyTitle('Untitled');
      }
    })();
  }, [patches]);

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
      if (res.status === 404) {
        throw new Error('Job not found');
      }
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
    const patch = findPatchForFrame(patches, w.fx, w.fy);
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
    const existing = findPatchForFrame(patches, frameX, frameY);
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
      <main className="flex items-center justify-center min-h-screen" style={{ background: 'var(--void-bg)', color: 'var(--void-carbon)' }}>
        <p style={{ opacity: 0.75 }}>Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col" style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      <VoidChrome patchCount={patches.length} canvasReading={dailyTitle} />
      <div className="flex-1 relative z-[5]" style={{ minHeight: 0 }}>
        <MergedCanvas
          patches={patches}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          dailyQuestion={dailyQuestion}
          onlineCount={onlineCount}
        />
      </div>
    </main>
  );
}
