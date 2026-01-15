'use client';

import { CanvasTile } from '@/lib/types';
import { TILE_SIZE_PX } from '@/lib/constants';
import { useEffect, useState } from 'react';
import { soundManager } from '@/lib/sounds';

interface TileProps {
  tile: CanvasTile;
  onClick: () => void;
  isSelected?: boolean;
  isPressed?: boolean;
}

export default function Tile({ tile, onClick, isSelected = false, isPressed = false }: TileProps) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  // Debug: Log when tile has an image URL
  useEffect(() => {
    if (tile.current_image_url) {
      console.log(`🖼️ Tile (${tile.x}, ${tile.y}) rendering with image URL:`, tile.current_image_url);
    }
  }, [tile.x, tile.y, tile.current_image_url]);

  useEffect(() => {
    if (!tile.lock_until) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(tile.lock_until!).getTime() - Date.now()) / 1000)
      );
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [tile.lock_until]);

  const isLocked = tile.lock_until && new Date(tile.lock_until) > new Date();
  const isLockedByMe = tile.lock_by !== null; // You'd check against current user ID

  // Debug logging for specific tiles
  useEffect(() => {
    if ((tile.x === 14 && tile.y === 1) || (tile.x === 13 && tile.y === 5)) {
      console.log(`🔍 Tile (${tile.x}, ${tile.y}) render:`, {
        hasImageUrl: !!tile.current_image_url,
        imageUrl: tile.current_image_url,
        isLocked,
        lockUntil: tile.lock_until,
      });
    }
  }, [tile.x, tile.y, tile.current_image_url, isLocked, tile.lock_until]);

  // Determine if tile is generating (locked but no image yet)
  const isGenerating = isLocked && !tile.current_image_url;
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset imageLoaded when URL changes
  useEffect(() => {
    setImageLoaded(false);
  }, [tile.current_image_url]);

  // Play sound when image loads (generation complete)
  useEffect(() => {
    if (imageLoaded && tile.current_image_url && !isLocked) {
      soundManager.playGenerationComplete();
    }
  }, [imageLoaded, tile.current_image_url, isLocked]);

  // Play sound when generation starts
  useEffect(() => {
    if (isGenerating) {
      soundManager.playGenerationStart();
    }
  }, [isGenerating]);

  return (
    <div
      className="relative"
      style={{
        width: TILE_SIZE_PX,
        height: TILE_SIZE_PX,
        minWidth: TILE_SIZE_PX,
        minHeight: TILE_SIZE_PX,
        pointerEvents: 'none', // Let Canvas handle all clicks
        boxShadow: isSelected 
          ? '0 0 0 2px rgba(99, 102, 241, 0.8), 0 0 16px rgba(79, 70, 229, 0.6), 0 0 8px rgba(6, 182, 212, 0.5)' 
          : 'none',
        borderRadius: isSelected ? '3px' : '0px',
        zIndex: isSelected ? 10 : 1,
      }}
    >
      <div
        className={`relative cursor-pointer transition-all duration-300 w-full h-full retro-hover ${
          isGenerating
            ? 'tile-generating border border-indigo-500/70'
            : isSelected
            ? 'border border-indigo-400/80 shadow-lg shadow-indigo-500/30'
            : isPressed
            ? 'border border-indigo-400/50 shadow-md shadow-indigo-400/20'
            : 'border border-white/5 hover:border-indigo-400/40 hover:shadow-lg hover:shadow-indigo-400/15'
        }`}
        style={{
          backgroundColor: tile.current_image_url ? 'transparent' : 'rgba(20, 20, 30, 0.6)',
        }}
      >
        {tile.current_image_url ? (
          <img
            key={tile.current_image_url} // CRITICAL: Force re-render when URL changes
            src={tile.current_image_url}
            alt={`Tile (${tile.x}, ${tile.y})`}
            className={`w-full h-full object-cover ${imageLoaded ? 'tile-image-fade-in' : ''}`}
            style={{
              filter: isSelected ? 'brightness(1.15) saturate(1.2) contrast(1.05)' : 'brightness(1)',
              transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1), filter 0.3s ease',
              opacity: imageLoaded ? 1 : 0,
            }}
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              console.error(`❌ Failed to load image for tile (${tile.x}, ${tile.y}):`, {
                url: tile.current_image_url,
                error: target.error,
                naturalWidth: target.naturalWidth,
                naturalHeight: target.naturalHeight,
              });
              // Try to fetch the URL to see what the actual error is
              fetch(tile.current_image_url, { method: 'HEAD' })
                .then(response => {
                  console.error(`Image fetch response: ${response.status} ${response.statusText}`, {
                    headers: Object.fromEntries(response.headers.entries()),
                  });
                })
                .catch(fetchError => {
                  console.error('Image fetch error:', fetchError);
                });
            }}
            onLoad={(e) => {
              const target = e.target as HTMLImageElement;
              setImageLoaded(true);
              console.log(`✅ Successfully loaded image for tile (${tile.x}, ${tile.y}):`, {
                url: tile.current_image_url,
                width: target.naturalWidth,
                height: target.naturalHeight,
                complete: target.complete,
              });
            }}
          />
        ) : (
          <div 
            className="w-full h-full" 
            style={{
              background: isGenerating 
                ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(79, 70, 229, 0.15) 50%, rgba(6, 182, 212, 0.2) 100%)'
                : 'linear-gradient(135deg, rgba(30, 30, 40, 0.8) 0%, rgba(20, 20, 30, 0.6) 100%)',
            }}
          />
        )}

        {/* Generating overlay - only show when generating (locked but no image) */}
        {isGenerating && (
          <>
            {/* Retro overlay with blue-purple to cyan gradient */}
            <div 
              className="absolute inset-0 z-10"
              style={{
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(79, 70, 229, 0.15) 50%, rgba(6, 182, 212, 0.2) 100%)',
                borderRadius: isSelected ? '3px' : '0px',
              }}
            />
            
            {/* Retro loading spinner with gradient colors */}
            <div className="absolute inset-0 flex items-center justify-center z-20" style={{ borderRadius: isSelected ? '3px' : '0px' }}>
              <div className="relative w-9 h-9">
                <div className="absolute inset-0 border-2 border-indigo-400/20 rounded-full"></div>
                <div className="absolute inset-0 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin" style={{ animationDuration: '1s' }}></div>
                <div className="absolute inset-0 border-2 border-cyan-400/60 rounded-full border-r-transparent animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.7s' }}></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Lock overlay - show when locked but image exists (just locked, not generating) */}
        {isLocked && !isGenerating && (
          <div
            className={`absolute inset-0 flex items-center justify-center text-xs font-bold backdrop-blur-sm z-10 ${
              isLockedByMe 
                ? 'bg-indigo-500/60 text-white' 
                : 'bg-amber-500/60 text-white'
            }`}
            style={{
              borderRadius: isSelected ? '3px' : '0px',
            }}
          >
            {timeRemaining !== null && timeRemaining > 0 ? (
              <div className="text-center">
                <div className="text-lg mb-0.5">🔒</div>
                <div className="text-[10px] font-semibold">{timeRemaining}s</div>
              </div>
            ) : (
              <div className="text-lg">🔒</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
