'use client';

import { CanvasTile } from '@/lib/types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE_PX } from '@/lib/constants';
import { useState, useRef, useEffect } from 'react';
import Tile from './Tile';

interface CanvasProps {
  tiles: Map<string, CanvasTile>;
  onTileClick: (x: number, y: number) => void;
}

export default function Canvas({ tiles, onTileClick }: CanvasProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left click
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.max(0.5, Math.min(3, prev * delta)));
  };

  const getTileKey = (x: number, y: number) => `${x},${y}`;

  return (
    <div
      className="relative w-full h-full overflow-hidden bg-gray-200"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      ref={canvasRef}
    >
      <div
        className="absolute"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${CANVAS_WIDTH}, ${TILE_SIZE_PX}px)`,
            width: CANVAS_WIDTH * TILE_SIZE_PX,
            height: CANVAS_HEIGHT * TILE_SIZE_PX,
          }}
        >
          {Array.from({ length: CANVAS_HEIGHT }, (_, y) =>
            Array.from({ length: CANVAS_WIDTH }, (_, x) => {
              const tileKey = getTileKey(x, y);
              const tile = tiles.get(tileKey) || {
                x,
                y,
                current_image_url: null,
                current_prompt: null,
                updated_by: null,
                updated_at: new Date().toISOString(),
                lock_until: null,
                lock_by: null,
                version: 1,
              };

              return (
                <Tile
                  key={tileKey}
                  tile={tile}
                  onClick={() => onTileClick(x, y)}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          onClick={() => setZoom((prev) => Math.min(3, prev + 0.1))}
          className="px-3 py-2 bg-white border border-gray-300 rounded shadow hover:bg-gray-50"
        >
          +
        </button>
        <button
          onClick={() => setZoom((prev) => Math.max(0.5, prev - 0.1))}
          className="px-3 py-2 bg-white border border-gray-300 rounded shadow hover:bg-gray-50"
        >
          −
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="px-3 py-2 bg-white border border-gray-300 rounded shadow hover:bg-gray-50 text-xs"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
