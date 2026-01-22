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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [tileHistory, setTileHistory] = useState<TileHistory[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);

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
    // Load initial tiles (no auth required)
    loadTiles().catch(err => {
      console.error('❌ loadTiles() failed:', err);
    });
    
    // Also reload tiles after a short delay to catch any updates
    const reloadTimer = setTimeout(() => {
      console.log('🔄 Reloading tiles after 2 second delay...');
      loadTiles().catch(err => {
        console.error('❌ Delayed loadTiles() failed:', err);
      });
    }, 2000);

    // Periodic refresh every 5 seconds to catch any missed updates
    const periodicRefresh = setInterval(() => {
      console.log('🔄 Periodic tile refresh...');
      loadTiles().catch(err => {
        console.error('❌ Periodic loadTiles() failed:', err);
      });
    }, 5000);
    
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
      clearTimeout(reloadTimer);
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

  const loadTiles = async () => {
    try {
      // Fetch tiles via service-role API route to avoid any client RLS/env issues.
      // Add timestamp to bust cache
      const res = await fetch(`/api/tiles/list?t=${Date.now()}`, { 
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('❌ Failed to fetch /api/tiles/list:', res.status, text);
        return;
      }

      const body = (await res.json()) as { tiles: CanvasTile[] };
      const tilesMap = new Map<string, CanvasTile>();

      for (const tile of body.tiles ?? []) {
        tilesMap.set(`${tile.x},${tile.y}`, tile);
      }

      // CRITICAL: Force React re-render by creating completely new objects
      // This ensures React sees the change even if the URL is the same
      const newTilesMap = new Map<string, CanvasTile>();
      tilesMap.forEach((tile, key) => {
        // Create a completely new object with all properties
        newTilesMap.set(key, {
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
      });
      
      setTiles(newTilesMap);
      
      // Log tiles with images for debugging
      const tilesWithImages = Array.from(newTilesMap.values()).filter(t => t.current_image_url);
      console.log(`✅ Loaded ${newTilesMap.size} tiles, ${tilesWithImages.length} with images`);
      
      // Check specific tile
      const tile13_5 = newTilesMap.get('13,5');
      if (tile13_5) {
        console.log('🎯 Tile (13, 5):', tile13_5.current_image_url);
      }
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
    // Click on empty canvas - dismiss promptbox
    soundManager.playClick();
    setIsModalOpen(false);
    setSelectedTile(null);
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
            onClose={() => {
              setIsModalOpen(false);
              setSelectedTile(null);
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

      {/* Tile location indicator - minimal */}
      {selectedTile && (
        <div className="absolute top-5 left-5 px-3 py-1.5 bg-white backdrop-blur-xl rounded-lg shadow-lg border border-gray-300 retro-slide-in">
          <span className="text-sm font-medium text-gray-700">
            ({selectedTile.x}, {selectedTile.y})
          </span>
        </div>
      )}
    </main>
  );
}
