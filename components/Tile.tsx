'use client';

import { CanvasTile } from '@/lib/types';
import { TILE_SIZE_PX } from '@/lib/constants';
import { useEffect, useState } from 'react';

interface TileProps {
  tile: CanvasTile;
  onClick: () => void;
}

export default function Tile({ tile, onClick }: TileProps) {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

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

  return (
    <div
      className="relative border border-gray-300 cursor-pointer hover:border-blue-500 transition-colors"
      style={{
        width: TILE_SIZE_PX,
        height: TILE_SIZE_PX,
      }}
      onClick={onClick}
    >
      {tile.current_image_url ? (
        <img
          src={tile.current_image_url}
          alt={`Tile (${tile.x}, ${tile.y})`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-100" />
      )}

      {isLocked && (
        <div
          className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${
            isLockedByMe ? 'bg-blue-500/80 text-white' : 'bg-red-500/80 text-white'
          }`}
        >
          {timeRemaining !== null && timeRemaining > 0 ? (
            <div className="text-center">
              <div>🔒</div>
              <div>{timeRemaining}s</div>
            </div>
          ) : (
            <div>🔒</div>
          )}
        </div>
      )}
    </div>
  );
}
