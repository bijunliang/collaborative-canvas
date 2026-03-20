'use client';

import { useEffect, useState } from 'react';
import { createClientSupabase } from '@/lib/supabase/client';
import type { CanvasTile, TileHistory } from '@/lib/types';
import Canvas from '@/components/Canvas';
import TileModal from '@/components/TileModal';
import TileHistoryComponent from '@/components/TileHistory';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/constants';
import { soundManager } from '@/lib/sounds';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [tiles, setTiles] = useState<Map<string, CanvasTile>>(new Map());
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalExiting, setModalExiting] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [tileHistory, setTileHistory] = useState<TileHistory[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState(0);

  const supabase = createClientSupabase();

  // Debug: Log when tiles change
  useEffect(() => {
    const tilesWithImages = Array.from(tiles.values()).filter(t => t.current_image_url);
    console.log('🔄 Tiles state updated:', {
      totalTiles: tiles.size,
      tilesWithImages: tilesWithImages.length,
      tileKeys: Array.from(tiles.keys()),
      hasTile13_5: tiles.has('13,5'),
      hasTile12_11: tiles.has('12,11'),
    });
    
    // Check specific tiles we know should exist
    const tile13_5 = tiles.get('13,5');
    const tile12_11 = tiles.get('12,11');
    if (tile13_5) {
      console.log('✅ Tile (13, 5) in state:', tile13_5.current_image_url || 'no image');
    } else {
      console.warn('⚠️ Tile (13, 5) NOT in state');
    }
    if (tile12_11) {
      console.log('✅ Tile (12, 11) in state:', tile12_11.current_image_url || 'no image');
    } else {
      console.warn('⚠️ Tile (12, 11) NOT in state');
    }
  }, [tiles]);

  // Prevent browser zoom (Cmd/Ctrl+scroll, Cmd/Ctrl+Plus/Minus) so only canvas zoom applies; locks at 5000%
  useEffect(() => {
    const preventWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const preventKeyZoom = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    document.addEventListener('keydown', preventKeyZoom);
    return () => {
      document.removeEventListener('wheel', preventWheelZoom);
      document.removeEventListener('keydown', preventKeyZoom);
    };
  }, []);

  useEffect(() => {
    // Ensure user is authenticated before allowing actions
    const ensureAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Sign in anonymously
        const { error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.error('Failed to sign in anonymously:', error);
          // Still allow the app to load, but user won't be able to generate
        }
      }
      setIsLoading(false);
    };
    
    ensureAuth();
  }, []);

  useEffect(() => {
    console.log('🚀 useEffect triggered - loading tiles...');
    // Load tiles immediately
    loadTiles().catch((err) => {
      console.error('❌ loadTiles() failed:', err);
    });
    // Single retry at 2s for cold-start; avoid aggressive retries that overwrite Realtime data
    const retryT = setTimeout(() => loadTiles().catch(() => {}), 2000);

    // Periodic refresh every 2 seconds to catch updates (Realtime may not connect on some networks)
    const periodicRefresh = setInterval(() => {
      loadTiles().catch(() => {});
    }, 2000);
    
    // Subscribe to tile changes (with error handling)
    let channel: any = null;
    try {
      channel = supabase
        .channel('canvas-tiles-updates')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'canvas_tiles',
          },
          (payload) => {
            console.log('Realtime update received:', payload);
            if (payload.new) {
              const tile = payload.new as CanvasTile;
              console.log(`Realtime: Updating tile (${tile.x}, ${tile.y}) with image:`, tile.current_image_url);
              setTiles((prev) => {
                const newMap = new Map(prev);
                // Create a new object to ensure React detects the change
                newMap.set(`${tile.x},${tile.y}`, {
                  x: tile.x,
                  y: tile.y,
                  current_image_url: tile.current_image_url,
                  current_prompt: tile.current_prompt,
                  updated_by: tile.updated_by,
                  updated_at: tile.updated_at,
                  lock_until: tile.lock_until,
                  lock_by: tile.lock_by,
                  version: tile.version,
                });
                console.log(`Tile (${tile.x}, ${tile.y}) updated in state, total tiles: ${newMap.size}`);
                // Return a completely new Map to force React re-render
                return new Map(newMap);
              });
            } else if (payload.old) {
              const tile = payload.old as CanvasTile;
              setTiles((prev) => {
                const newMap = new Map(prev);
                newMap.delete(`${tile.x},${tile.y}`);
                return new Map(newMap);
              });
            }
          }
        )
        .subscribe((status) => {
          console.log('Realtime subscription status:', status);
          if (status === 'SUBSCRIBED') {
            console.log('✅ Successfully subscribed to realtime updates');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Realtime subscription error - tiles will still load on refresh');
          }
        });
    } catch (err) {
      console.error('Failed to subscribe to changes:', err);
      // Continue without realtime - grid will still work
    }

    return () => {
      clearTimeout(retryT);
      clearInterval(periodicRefresh);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  // Online presence via Supabase Realtime
  useEffect(() => {
    const presenceChannel = supabase.channel('canvas-online');
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const count = Object.values(state).flat().length;
        setOnlineCount(count);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      supabase.removeChannel(presenceChannel);
    };
  }, [supabase]);

  const loadTiles = async (forceReplace = false) => {
    try {
      // Use full URL to avoid basePath/caching issues on deployed
      const url = `${window.location.origin}/api/tiles/list?t=${Date.now()}`;
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('❌ Failed to fetch /api/tiles/list:', res.status, text);
        return;
      }

      const body = (await res.json()) as { tiles: CanvasTile[] };
      const apiTilesMap = new Map<string, CanvasTile>();

      for (const tile of body.tiles ?? []) {
        apiTilesMap.set(`${tile.x},${tile.y}`, tile);
      }

      if (forceReplace) {
        // Manual refresh: replace entirely with API data
        setTiles(new Map(apiTilesMap));
      } else {
        // MERGE with existing state. Keep whichever tile is newer (by updated_at)
        setTiles((prev) => {
          const newTilesMap = new Map<string, CanvasTile>();
          const allKeys = new Set([...prev.keys(), ...apiTilesMap.keys()]);

          for (const key of allKeys) {
            const existing = prev.get(key);
            const fromApi = apiTilesMap.get(key);

            let chosen: CanvasTile;
            if (!existing) {
              chosen = fromApi!;
            } else if (!fromApi) {
              chosen = existing;
            } else {
              const existingTime = new Date(existing.updated_at).getTime();
              const apiTime = new Date(fromApi.updated_at).getTime();
              chosen = apiTime >= existingTime ? fromApi : existing;
            }

            newTilesMap.set(key, {
              x: chosen.x,
              y: chosen.y,
              current_image_url: chosen.current_image_url,
              current_prompt: chosen.current_prompt,
              updated_by: chosen.updated_by,
              updated_at: chosen.updated_at,
              lock_until: chosen.lock_until,
              lock_by: chosen.lock_by,
              version: chosen.version,
            });
          }

          return newTilesMap;
        });
      }

      const tilesWithImages = Array.from(apiTilesMap.values()).filter((t) => t.current_image_url);
      console.log(`✅ Loaded ${apiTilesMap.size} tiles from API, ${tilesWithImages.length} with images`);
    } catch (err) {
      console.error('❌ Failed to load tiles:', err);
      console.error('Error stack:', err instanceof Error ? err.stack : 'No stack');
    }
  };

  const handleTileClick = async (x: number, y: number) => {
    // If clicking on a different tile, update selection
    // If clicking on the same tile, keep it selected
    soundManager.playSelect();
    setSelectedTile({ x, y });
    setIsModalOpen(true);
  };

  const handleEmptyCanvasClick = () => {
    // Click on empty canvas - start dismiss animation, modal will call onClose when done
    if (!selectedTile) return;
    soundManager.playClick();
    setModalExiting(true);
  };

  const handleGenerate = async (prompt: string) => {
    if (!selectedTile) return;

    setIsGenerating(true);

    try {
      // Step 1: Lock the tile
      let lockResponse;
      try {
        lockResponse = await fetch('/api/tiles/lock', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            x: selectedTile.x,
            y: selectedTile.y,
          }),
        });
      } catch (fetchError) {
        console.error('Network error locking tile:', fetchError);
        throw new Error('Network error: Unable to connect to server. Please check your connection and try again.');
      }

      if (!lockResponse.ok) {
        let errorMessage = 'Failed to lock tile';
        try {
          const error = await lockResponse.json();
          errorMessage = error.error || errorMessage;
        } catch {
          errorMessage = `Server error: ${lockResponse.status} ${lockResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Step 2: Create generation job
      let jobResponse;
      try {
        jobResponse = await fetch('/api/jobs/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            x: selectedTile.x,
            y: selectedTile.y,
            prompt,
          }),
        });
      } catch (fetchError) {
        console.error('Network error creating job:', fetchError);
        throw new Error('Network error: Unable to connect to server. Please check your connection and try again.');
      }

      if (!jobResponse.ok) {
        let errorMessage = 'Failed to create generation job';
        try {
          const error = await jobResponse.json();
          errorMessage = error.error || errorMessage;
        } catch {
          errorMessage = `Server error: ${jobResponse.status} ${jobResponse.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Success - the worker will process it and update via realtime
      // No alert needed - the loading state on the tile will show progress
      console.log('Generation started! The image will appear when ready.');
    } catch (error) {
      console.error('Generation error:', error);
      throw error; // Re-throw so TileModal can display the error
    } finally {
      setIsGenerating(false);
    }
  };

  const handleViewHistory = async (x: number, y: number) => {
    const { data, error } = await supabase
      .from('tile_history')
      .select('*')
      .eq('x', x)
      .eq('y', y)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error loading history:', error);
      return;
    }

    setTileHistory(data || []);
    setIsHistoryOpen(true);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      alert(error.message);
    } else {
      alert('Check your email for the login link!');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // Always show the canvas, even if loading
  if (isLoading) {
    return (
      <main className="flex flex-col" style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
        <div className="flex-1 relative overflow-hidden" style={{ height: '100vh', minHeight: 0 }}>
          <Canvas tiles={tiles} onTileClick={handleTileClick} onEmptyCanvasClick={handleEmptyCanvasClick} selectedTile={selectedTile} />
        </div>
      </main>
    );
  }

  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7244/ingest/330fd681-e7d7-4152-bee8-daf02ef4afc3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'canvas-broken-1',
        hypothesisId: 'H3',
        location: 'page.tsx:render',
        message: 'page render',
        data: {
          selectedTile: selectedTile ? `${selectedTile.x},${selectedTile.y}` : null,
          modalExiting,
          isModalOpen,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  return (
    <main className="flex flex-col" style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden" style={{ height: '100vh', minHeight: 0 }}>
        <Canvas tiles={tiles} onTileClick={handleTileClick} onEmptyCanvasClick={handleEmptyCanvasClick} selectedTile={selectedTile} />
      </div>

      {/* Modals */}
      {selectedTile && (
        <>
          <TileModal
            x={selectedTile.x}
            y={selectedTile.y}
            isOpen={isModalOpen}
            isExiting={modalExiting}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedTile(null);
              setModalExiting(false);
            }}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
          />
          <TileHistoryComponent
            history={tileHistory}
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
          />
        </>
      )}

      {/* Online presence + Refresh */}
      <div
        className="absolute top-5 left-5 flex items-center gap-3 retro-slide-in"
        style={{
          color: 'white',
          textShadow: '0 1px 2px rgba(0,0,0,0.6), 0 0 4px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <span className="text-sm font-medium">{onlineCount} online</span>
        </div>
        <button
          type="button"
          onClick={() => loadTiles(true)}
          className="text-sm font-medium px-2 py-1 rounded hover:bg-white/20 transition-colors"
          title="Refresh canvas"
        >
          Refresh
        </button>
      </div>
    </main>
  );
}
