'use client';

import { CanvasTile } from '@/lib/types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, TILE_SIZE_PX } from '@/lib/constants';
import { useState, useRef, useEffect, useCallback } from 'react';
import Tile from './Tile';

const GRID_SIZE_PX = CANVAS_WIDTH * TILE_SIZE_PX; // 640

interface CanvasProps {
  tiles: Map<string, CanvasTile>;
  onTileClick: (x: number, y: number) => void;
  onEmptyCanvasClick?: () => void;
  selectedTile: { x: number; y: number } | null;
}

export default function Canvas({ tiles, onTileClick, onEmptyCanvasClick, selectedTile }: CanvasProps) {
  const [sceneSize, setSceneSize] = useState({ width: 1920, height: 1080 }); // fallback until measured
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const [pressedTile, setPressedTile] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ 
    distance: number; 
    center: { x: number; y: number };
    touch1: { x: number; y: number };
    touch2: { x: number; y: number };
  } | null>(null);

  // Calculate max zoom to fit entire grid
  const calculateMaxZoom = useCallback(() => {
    if (!canvasRef.current) return 1;
    const container = canvasRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const gridWidth = CANVAS_WIDTH * TILE_SIZE_PX;
    const gridHeight = CANVAS_HEIGHT * TILE_SIZE_PX;
    
    const scaleX = containerWidth / gridWidth;
    const scaleY = containerHeight / gridHeight;
    return Math.min(scaleX, scaleY) * 0.95; // 95% to add some padding
  }, []);

  // Scene = viewport size so wall is edge-to-edge; default zoom 1, pan 0
  const updateSceneSize = useCallback(() => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    setSceneSize({ width: w, height: h });
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    updateSceneSize();
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateSceneSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateSceneSize]);

  const MIN_ZOOM = 1; // 100% = furthest zoom out (edge-to-edge wall)
  const MAX_ZOOM = 20;

  const gridOffsetX = (sceneSize.width - GRID_SIZE_PX) / 2;
  const gridOffsetY = (sceneSize.height - GRID_SIZE_PX) / 2;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setHasDragged(false);
      // Store initial mouse position for drag detection
      setDragStart({ x: e.clientX, y: e.clientY });
      // Store initial pan position
      setPanStart({ x: pan.x, y: pan.y });
      
      // Track which tile is being pressed (scene coords → grid coords)
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldX = (x - pan.x) / zoom;
        const worldY = (y - pan.y) / zoom;
        const gridX = worldX - gridOffsetX;
        const gridY = worldY - gridOffsetY;
        const tileX = Math.floor(gridX / TILE_SIZE_PX);
        const tileY = Math.floor(gridY / TILE_SIZE_PX);
        if (tileX >= 0 && tileX < CANVAS_WIDTH && tileY >= 0 && tileY < CANVAS_HEIGHT && gridX >= 0 && gridX < GRID_SIZE_PX && gridY >= 0 && gridY < GRID_SIZE_PX) {
          setPressedTile({ x: tileX, y: tileY });
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault(); // Prevent browser navigation during pan
      // Calculate distance moved from initial click position
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // If moved more than 3px, it's a drag, not a click
      if (distance > 3) {
        setHasDragged(true); // Mark as dragged - this prevents tile click
        // Update pan: start position + mouse movement
        setPan({
          x: panStart.x + deltaX,
          y: panStart.y + deltaY,
        });
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Store state before resetting
    const wasDragging = isDragging;
    const didDrag = hasDragged;
    
    // Reset dragging state
    setIsDragging(false);
    setHasDragged(false);
    setPressedTile(null);
    
    // CRITICAL: Only trigger tile click if we were dragging AND never dragged
    // This prevents modal from opening when user drags to pan
    if (wasDragging && !didDrag) {
      // Click without drag - trigger tile click or empty canvas click (scene → grid)
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldX = (x - pan.x) / zoom;
        const worldY = (y - pan.y) / zoom;
        const gridX = worldX - gridOffsetX;
        const gridY = worldY - gridOffsetY;
        const tileX = Math.floor(gridX / TILE_SIZE_PX);
        const tileY = Math.floor(gridY / TILE_SIZE_PX);
        if (tileX >= 0 && tileX < CANVAS_WIDTH && tileY >= 0 && tileY < CANVAS_HEIGHT && gridX >= 0 && gridX < GRID_SIZE_PX && gridY >= 0 && gridY < GRID_SIZE_PX) {
          onTileClick(tileX, tileY);
        } else {
          if (onEmptyCanvasClick) {
            onEmptyCanvasClick();
          }
        }
      }
    }
    // If didDrag is true, we explicitly do nothing - no tile click
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    
    // Check if this is a zoom gesture (Ctrl/Cmd + wheel or pinch gesture)
    // On macOS trackpad: Cmd+scroll = zoom, plain scroll = pan
    // On Windows/Linux: Ctrl+scroll = zoom, plain scroll = pan
    const isZoomGesture = e.ctrlKey || e.metaKey;
    
    if (isZoomGesture) {
      // Zoom gesture
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate world coordinates at mouse position
      const worldX = (mouseX - pan.x) / zoom;
      const worldY = (mouseY - pan.y) / zoom;
      
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * delta));
      
      // Adjust pan so the point under cursor stays fixed
      const newPanX = mouseX - worldX * newZoom;
      const newPanY = mouseY - worldY * newZoom;
      
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    } else {
      // Pan gesture (2-finger scroll on trackpad)
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Touch handlers for 2-finger gestures
  const getTouchDistance = (touches: TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touches: TouchList) => {
    if (touches.length < 2) return { x: 0, y: 0 };
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      const center = getTouchCenter(e.touches);
      touchStartRef.current = { 
        distance, 
        center,
        touch1: { x: e.touches[0].clientX, y: e.touches[0].clientY },
        touch2: { x: e.touches[1].clientX, y: e.touches[1].clientY },
      };
    } else if (e.touches.length === 1) {
      // Prevent default to avoid browser gestures, but allow scrolling initially
      // We'll prevent default on move if it becomes a pan
      setIsDragging(true);
      setHasDragged(false);
      const touch = e.touches[0];
      setDragStart({ x: touch.clientX, y: touch.clientY });
      setPanStart({ x: pan.x, y: pan.y });
      touchStartRef.current = null;
      
      // Track which tile is being pressed (scene → grid)
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        const worldX = (x - pan.x) / zoom;
        const worldY = (y - pan.y) / zoom;
        const gridX = worldX - gridOffsetX;
        const gridY = worldY - gridOffsetY;
        const tileX = Math.floor(gridX / TILE_SIZE_PX);
        const tileY = Math.floor(gridY / TILE_SIZE_PX);
        if (tileX >= 0 && tileX < CANVAS_WIDTH && tileY >= 0 && tileY < CANVAS_HEIGHT && gridX >= 0 && gridX < GRID_SIZE_PX && gridY >= 0 && gridY < GRID_SIZE_PX) {
          setPressedTile({ x: tileX, y: tileY });
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartRef.current) {
      e.preventDefault();
      
      const currentDistance = getTouchDistance(e.touches);
      const currentCenter = getTouchCenter(e.touches);
      const distanceDelta = currentDistance - touchStartRef.current.distance;
      
      // Threshold to distinguish pinch/zoom from pan
      // If distance changes significantly, it's a zoom gesture
      const ZOOM_THRESHOLD = 10; // pixels
      const isZoomGesture = Math.abs(distanceDelta) > ZOOM_THRESHOLD;
      
      if (isZoomGesture && touchStartRef.current.distance > 0) {
        // Pinch/spread zoom gesture
        if (!canvasRef.current) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const centerX = currentCenter.x - rect.left;
        const centerY = currentCenter.y - rect.top;
        
        // Calculate zoom factor based on distance change
        const zoomFactor = currentDistance / touchStartRef.current.distance;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor));
        
        // Calculate world coordinates at pinch center
        const worldX = (centerX - pan.x) / zoom;
        const worldY = (centerY - pan.y) / zoom;
        
        // Adjust pan so the point under pinch center stays fixed
        const newPanX = centerX - worldX * newZoom;
        const newPanY = centerY - worldY * newZoom;
        
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
        
        // Update touch start with new distance for smooth zooming
        touchStartRef.current = {
          distance: currentDistance,
          center: currentCenter,
          touch1: { x: e.touches[0].clientX, y: e.touches[0].clientY },
          touch2: { x: e.touches[1].clientX, y: e.touches[1].clientY },
        };
      } else {
        // Pan gesture (2-finger scroll)
        const deltaX = currentCenter.x - touchStartRef.current.center.x;
        const deltaY = currentCenter.y - touchStartRef.current.center.y;
        
        setPan((prev) => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));
        
        // Update center position
        touchStartRef.current = { 
          distance: touchStartRef.current.distance, // Keep original distance
          center: currentCenter,
          touch1: { x: e.touches[0].clientX, y: e.touches[0].clientY },
          touch2: { x: e.touches[1].clientX, y: e.touches[1].clientY },
        };
      }
    } else if (e.touches.length === 1 && isDragging) {
      e.preventDefault(); // Prevent browser navigation during pan
      const touch = e.touches[0];
      const deltaX = touch.clientX - dragStart.x;
      const deltaY = touch.clientY - dragStart.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance > 5) {
        setHasDragged(true);
        setPan({
          x: panStart.x + deltaX,
          y: panStart.y + deltaY,
        });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      // Single tap without drag - trigger tile click or empty canvas click (scene → grid)
      if (isDragging && !hasDragged && e.changedTouches.length === 1 && !touchStartRef.current) {
        const touch = e.changedTouches[0];
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          const worldX = (x - pan.x) / zoom;
          const worldY = (y - pan.y) / zoom;
          const gridX = worldX - gridOffsetX;
          const gridY = worldY - gridOffsetY;
          const tileX = Math.floor(gridX / TILE_SIZE_PX);
          const tileY = Math.floor(gridY / TILE_SIZE_PX);
          if (tileX >= 0 && tileX < CANVAS_WIDTH && tileY >= 0 && tileY < CANVAS_HEIGHT && gridX >= 0 && gridX < GRID_SIZE_PX && gridY >= 0 && gridY < GRID_SIZE_PX) {
            onTileClick(tileX, tileY);
          } else {
            if (onEmptyCanvasClick) {
              onEmptyCanvasClick();
            }
          }
        }
      }
      touchStartRef.current = null;
      setIsDragging(false);
      setHasDragged(false);
      setPressedTile(null);
    } else if (e.touches.length === 1) {
      touchStartRef.current = null;
      setPressedTile(null);
    }
  };

  const handleFitToScreen = () => {
    updateSceneSize(); // resets scene to viewport, zoom 1, pan 0 = edge-to-edge
  };

  const handleZoomIn = () => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    // Zoom towards center of canvas
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const worldX = (centerX - pan.x) / zoom;
    const worldY = (centerY - pan.y) / zoom;
    
    const newZoom = Math.min(MAX_ZOOM, zoom * 1.2);
    const newPanX = centerX - worldX * newZoom;
    const newPanY = centerY - worldY * newZoom;
    
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleZoomOut = () => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    // Zoom towards center of canvas
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const worldX = (centerX - pan.x) / zoom;
    const worldY = (centerY - pan.y) / zoom;
    
    const newZoom = Math.max(MIN_ZOOM, zoom / 1.2);
    const newPanX = centerX - worldX * newZoom;
    const newPanY = centerY - worldY * newZoom;
    
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomPercentage = Math.round(zoom * 100);

  const getTileKey = (x: number, y: number) => `${x},${y}`;

  return (
    <div
      className="relative w-full h-full overflow-auto"
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'absolute', 
        top: 0, 
        left: 0,
        background: '#f5f5f5',
        touchAction: 'none', // Prevent browser gestures (back/forward navigation)
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      ref={canvasRef}
    >
      <div
        className="absolute"
        style={{
          width: sceneSize.width,
          height: sceneSize.height,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Wall layer - edge-to-edge, zooms with scene */}
        <div
          className="absolute inset-0"
          style={{
            background: 'url(/assets/wall.png) center center / cover no-repeat',
          }}
        />
        {/* Grid layer - centered in scene, 10% smaller at 100% */}
        <div
          className="absolute grid"
          style={{
            left: gridOffsetX,
            top: gridOffsetY,
            width: GRID_SIZE_PX,
            height: GRID_SIZE_PX,
            transform: 'scale(0.9)',
            transformOrigin: 'center center',
            gridTemplateColumns: `repeat(${CANVAS_WIDTH}, ${TILE_SIZE_PX}px)`,
            gap: 0,
          }}
        >
          {Array.from({ length: CANVAS_HEIGHT }, (_, y) =>
            Array.from({ length: CANVAS_WIDTH }, (_, x) => {
              const tileKey = getTileKey(x, y);
              // CRITICAL: Always use the tile from the Map if it exists, don't create defaults
              const tile = tiles.get(tileKey);
              
              // Only create default if tile doesn't exist AND we want to show empty tiles
              // But if tile exists, use it even if image_url is null (might be loading)
              const finalTile = tile || {
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
              
              // Debug logging for specific tiles
              if ((x === 14 && y === 1) || (x === 13 && y === 5) || finalTile.current_image_url) {
                console.log(`🎨 Canvas rendering tile (${x}, ${y}):`, {
                  tileKey,
                  hasTile: tiles.has(tileKey),
                  imageUrl: finalTile.current_image_url,
                  fromMap: !!tile,
                });
              }

              const isSelected = selectedTile?.x === x && selectedTile?.y === y;
              const isPressed = pressedTile?.x === x && pressedTile?.y === y;

              return (
                <Tile
                  key={tileKey}
                  tile={finalTile}
                  onClick={() => {}} // Not used - Canvas handles clicks
                  isSelected={isSelected}
                  isPressed={isPressed}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Zoom controls - fixed to viewport bottom right */}
      <div className="fixed z-40" style={{ bottom: '24px', right: '24px' }}>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-white backdrop-blur-xl rounded-xl shadow-2xl border border-gray-300 retro-slide-in">
          {/* Fit to screen icon */}
          <button
            onClick={() => {
              const { soundManager } = require('@/lib/sounds');
              soundManager.playClick();
              handleFitToScreen();
            }}
            className="flex items-center justify-center w-8 h-8 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-all duration-300 text-gray-700 hover:text-gray-900 retro-hover retro-press"
            title="Fit to screen"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="12" height="12" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <rect x="6" y="6" width="4" height="4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <path d="M2 2L6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M14 2L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M2 14L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M14 14L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          
          <div className="w-px h-6 bg-gray-300"></div>
          
          {/* Zoom out */}
          <button
            onClick={() => {
              const { soundManager } = require('@/lib/sounds');
              soundManager.playClick();
              handleZoomOut();
            }}
            className="flex items-center justify-center w-8 h-8 hover:bg-gray-500/20 active:bg-gray-500/30 rounded-lg transition-all duration-300 text-gray-300 hover:text-gray-200 text-lg font-light retro-hover retro-press"
            title="Zoom out"
          >
            −
          </button>
          
          {/* Zoom percentage */}
          <span className="text-sm font-semibold min-w-[3.5rem] text-center px-2 text-gray-700">
            {zoomPercentage}%
          </span>
          
          {/* Zoom in */}
          <button
            onClick={() => {
              const { soundManager } = require('@/lib/sounds');
              soundManager.playClick();
              handleZoomIn();
            }}
            className="flex items-center justify-center w-8 h-8 hover:bg-gray-500/20 active:bg-gray-500/30 rounded-lg transition-all duration-300 text-gray-300 hover:text-gray-200 text-lg font-light retro-hover retro-press"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
