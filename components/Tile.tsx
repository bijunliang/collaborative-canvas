'use client';

import { CanvasTile } from '@/lib/types';
import { TILE_SIZE_PX } from '@/lib/constants';
import { useEffect, useState, useRef } from 'react';
import { soundManager } from '@/lib/sounds';

interface TileProps {
  tile: CanvasTile;
  onClick: () => void;
  isSelected?: boolean;
  isPressed?: boolean;
  zoom?: number;
}

export default function Tile({ tile, onClick, isSelected = false, isPressed = false, zoom = 1 }: TileProps) {
  // Debug: Log when tile has an image URL
  useEffect(() => {
    if (tile.current_image_url) {
      console.log(`🖼️ Tile (${tile.x}, ${tile.y}) rendering with image URL:`, tile.current_image_url);
    }
  }, [tile.x, tile.y, tile.current_image_url]);

  const isLocked = tile.lock_until && new Date(tile.lock_until) > new Date();

  // Debug logging for specific tiles
  useEffect(() => {
    if ((tile.x === 14 && tile.y === 1) || (tile.x === 13 && tile.y === 5)) {
      console.log(`🔍 Tile (${tile.x}, ${tile.y}) render:`, {
        hasImageUrl: !!tile.current_image_url,
        imageUrl: tile.current_image_url,
        isLocked,
      });
    }
  }, [tile.x, tile.y, tile.current_image_url, isLocked]);

  // Generating = locked (initial generate or regenerate on top); show spinner in both cases
  const isGenerating = isLocked;
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset imageLoaded when URL changes
  useEffect(() => {
    setImageLoaded(false);
  }, [tile.current_image_url]);

  // Handle cached images: onLoad can fire before React attaches the handler; check complete
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0 && tile.current_image_url) {
      setImageLoaded(true);
    }
  }, [tile.current_image_url, tile.x, tile.y]);

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
          ? `0 0 0 ${Math.min(1.2, 2 / zoom)}px rgba(146, 129, 115, 0.9)` 
          : 'none',
        borderRadius: isSelected ? `${3 / zoom}px` : '0px',
        // Skip pencil filter while generating so frame stays straight; rings carry the organic line
        filter: isSelected && !isGenerating ? 'url(#pencil-sketch)' : 'none',
        zIndex: isSelected ? 10 : 1,
      }}
    >
      <div
        className={`relative cursor-pointer transition-all duration-300 w-full h-full retro-hover ${
          isGenerating
            ? 'tile-generating border border-[#928173]'
            : isSelected
            ? 'border border-[#928173]'
            : isPressed
            ? 'border border-[#928173]/60'
            : 'hover:shadow-lg hover:shadow-gray-200'
        }`}
        style={{
          backgroundColor: tile.current_image_url ? 'transparent' : '#FAF7F4',
          ...(isSelected && { borderWidth: `${Math.min(0.8, 1 / zoom)}px` }),
          ...((!isGenerating && !isSelected && !isPressed) && {
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#E6E1DF',
            borderTopWidth: tile.y === 0 ? 1 : 0,
            borderLeftWidth: tile.x === 0 ? 1 : 0,
            borderRightWidth: 1,
            borderBottomWidth: 1,
          }),
        }}
      >
        {tile.current_image_url ? (
          <img
            ref={imgRef}
            key={tile.current_image_url} // CRITICAL: Force re-render when URL changes
            src={tile.current_image_url}
            loading="eager"
            alt={`Tile (${tile.x}, ${tile.y})`}
            className={`w-full h-full object-cover ${imageLoaded ? 'tile-image-fade-in' : ''}`}
            style={{
              filter: isSelected ? 'brightness(1.15) saturate(1.2) contrast(1.05)' : 'brightness(1)',
              transition: 'opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1), filter 0.3s ease',
              opacity: imageLoaded ? 1 : 0,
            }}
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
              background: isGenerating ? '#F7F4EF' : '#FAF7F4',
            }}
          />
        )}

        {/* Generating overlay - only show when generating (locked but no image) */}
        {isGenerating && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none overflow-hidden"
            style={{ borderRadius: isSelected ? '3px' : '0px' }}
          >
            {/* Two overlapping wavy rings — straight square frame from tile border; organic motion inside */}
            <svg
              viewBox="0 0 100 100"
              className="w-[92%] h-[92%] max-w-full max-h-full"
              aria-hidden
            >
              <g className="gen-orbit-outer">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="#c4bcb2"
                  strokeWidth="2.75"
                  strokeLinecap="round"
                  filter="url(#generating-wavy)"
                />
              </g>
              <g className="gen-orbit-inner">
                <circle
                  cx="50"
                  cy="50.5"
                  r="33"
                  fill="none"
                  stroke="#928173"
                  strokeWidth="2.9"
                  strokeLinecap="round"
                  filter="url(#generating-wavy)"
                />
              </g>
            </svg>
          </div>
        )}

      </div>
    </div>
  );
}
