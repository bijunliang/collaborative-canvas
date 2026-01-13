'use client';

import { useEffect, useState } from 'react';
import { createClientSupabase } from '@/lib/supabase/client';
import { CanvasTile, TileHistory } from '@/lib/types';
import Canvas from '@/components/Canvas';
import TileModal from '@/components/TileModal';
import TileHistory as TileHistoryComponent from '@/components/TileHistory';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/constants';

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

  useEffect(() => {
    // Check auth status
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Load initial tiles
    loadTiles();

    // Subscribe to tile changes
    const channel = supabase
      .channel('canvas-tiles')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'canvas_tiles',
        },
        (payload) => {
          if (payload.new) {
            const tile = payload.new as CanvasTile;
            setTiles((prev) => {
              const newMap = new Map(prev);
              newMap.set(`${tile.x},${tile.y}`, tile);
              return newMap;
            });
          } else if (payload.old) {
            const tile = payload.old as CanvasTile;
            setTiles((prev) => {
              const newMap = new Map(prev);
              newMap.delete(`${tile.x},${tile.y}`);
              return newMap;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadTiles = async () => {
    const { data, error } = await supabase
      .from('canvas_tiles')
      .select('*')
      .limit(10000); // Load all tiles

    if (error) {
      console.error('Error loading tiles:', error);
      return;
    }

    const tilesMap = new Map<string, CanvasTile>();
    data?.forEach((tile) => {
      tilesMap.set(`${tile.x},${tile.y}`, tile);
    });
    setTiles(tilesMap);
  };

  const handleTileClick = async (x: number, y: number) => {
    if (!user) {
      alert('Please sign in to generate images');
      return;
    }

    setSelectedTile({ x, y });
    setIsModalOpen(true);
  };

  const handleGenerate = async (prompt: string) => {
    if (!selectedTile || !user) return;

    setIsGenerating(true);

    try {
      // Step 1: Lock the tile
      const lockResponse = await fetch('/api/tiles/lock', {
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

      if (!lockResponse.ok) {
        const error = await lockResponse.json();
        throw new Error(error.error || 'Failed to lock tile');
      }

      // Step 2: Create generation job
      const jobResponse = await fetch('/api/jobs/create', {
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

      if (!jobResponse.ok) {
        const error = await jobResponse.json();
        throw new Error(error.error || 'Failed to create generation job');
      }

      // Success - the worker will process it and update via realtime
      alert('Generation started! The image will appear when ready.');
    } catch (error) {
      console.error('Generation error:', error);
      throw error;
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

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div>Loading...</div>
      </main>
    );
  }

  return (
    <main className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">AI Place Canvas</h1>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <span className="text-sm text-gray-600">{user.email}</span>
                <button
                  onClick={handleSignOut}
                  className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <form onSubmit={handleSignIn} className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="px-3 py-2 border border-gray-300 rounded"
                  required
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Sign In
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      {/* Canvas */}
      <div className="flex-1 relative">
        <Canvas tiles={tiles} onTileClick={handleTileClick} />
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

      {/* Info panel */}
      {selectedTile && (
        <div className="absolute top-20 left-4 bg-white p-4 rounded shadow-lg">
          <h3 className="font-bold mb-2">Tile ({selectedTile.x}, {selectedTile.y})</h3>
          <button
            onClick={() => handleViewHistory(selectedTile.x, selectedTile.y)}
            className="text-sm text-blue-500 hover:underline"
          >
            View History
          </button>
        </div>
      )}
    </main>
  );
}
