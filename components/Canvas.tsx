'use client';

import { CanvasTile } from '@/lib/types';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  CANVAS_WIDTH_PX,
  CANVAS_HEIGHT_PX,
  TILE_SIZE_PX,
} from '@/lib/constants';
import { useState, useRef, useEffect, useCallback } from 'react';
import Tile from './Tile';

const GRID_SIZE_PX = CANVAS_WIDTH * TILE_SIZE_PX;
const GRID_HEIGHT_PX = CANVAS_HEIGHT * TILE_SIZE_PX;

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
  const touchClickHandledRef = useRef(false);

  // #region agent log
  const debugLog = (payload: {
    runId: string;
    hypothesisId: string;
    location: string;
    message: string;
    data?: Record<string, unknown>;
  }) => {
    fetch('http://127.0.0.1:7244/ingest/330fd681-e7d7-4152-bee8-daf02ef4afc3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  // Zoom level that fits the entire painting in viewport
  const calculateFitZoom = useCallback(() => {
    if (!canvasRef.current) return 0.75;
    const container = canvasRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const scaleX = w / CANVAS_WIDTH_PX;
    const scaleY = h / CANVAS_HEIGHT_PX;
    return Math.min(scaleX, scaleY) * 0.95; // 95% padding
  }, []);

  // Pan to center the painting when it fits
  const getCenteredPan = useCallback(
    (z: number) => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const w = canvasRef.current.clientWidth;
      const h = canvasRef.current.clientHeight;
      const scaledW = CANVAS_WIDTH_PX * z;
      const scaledH = CANVAS_HEIGHT_PX * z;
      return {
        x: Math.max(0, (w - scaledW) / 2),
        y: Math.max(0, (h - scaledH) / 2),
      };
    },
    []
  );

  // Update scene dimensions; do NOT reset zoom/pan (prevents zoom-out when modal opens)
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const updateSceneSize = useCallback(() => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    // Ignore tiny changes (e.g. from scrollbar) to prevent canvas jitter on click
    const prev = lastSizeRef.current;
    if (Math.abs(w - prev.width) < 3 && Math.abs(h - prev.height) < 3 && prev.width > 0) return;
    lastSizeRef.current = { width: w, height: h };
    debugLog({
      runId: 'click-shift-1',
      hypothesisId: 'H2',
      location: 'components/Canvas.tsx:updateSceneSize',
      message: 'sceneSize updated',
      data: { width: w, height: h, prevWidth: prev.width, prevHeight: prev.height },
    });
    setSceneSize({ width: w, height: h });
  }, []);

  useEffect(() => {
    updateSceneSize();
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateSceneSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateSceneSize]);

  // Convert canvas pixel coords to tile (worldX, worldY are in painting space)
  const sceneToTile = useCallback(
    (worldX: number, worldY: number) => {
      if (worldX < 0 || worldX >= GRID_SIZE_PX || worldY < 0 || worldY >= GRID_HEIGHT_PX) return null;
      const tileX = Math.floor(worldX / TILE_SIZE_PX);
      const tileY = Math.floor(worldY / TILE_SIZE_PX);
      if (tileX >= 0 && tileX < CANVAS_WIDTH && tileY >= 0 && tileY < CANVAS_HEIGHT) return { x: tileX, y: tileY };
      return null;
    },
    []
  );

  // Clamp pan so we never see past the painting edges
  const clampPan = useCallback(
    (p: { x: number; y: number }, z: number) => {
      const W = sceneSize.width;
      const H = sceneSize.height;
      const scaledW = CANVAS_WIDTH_PX * z;
      const scaledH = CANVAS_HEIGHT_PX * z;
      const maxX = Math.max(0, W - scaledW);
      const maxY = Math.max(0, H - scaledH);
      return {
        x: Math.max(0, Math.min(maxX, p.x)),
        y: Math.max(0, Math.min(maxY, p.y)),
      };
    },
    [sceneSize.width, sceneSize.height]
  );

  // Zoom levels: fit, then steps up
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10;
  const DEFAULT_ZOOM = 1; // Will be overridden by fit zoom on init

  const zoomAnimatingRef = useRef(false);
  const fitZoomRef = useRef(0.75);
  const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10] as const;
  const getNextZoomLevel = useCallback((current: number, direction: 'in' | 'out') => {
    const fit = fitZoomRef.current;
    const levels = [...ZOOM_LEVELS].filter((z) => z >= Math.min(fit, 0.5));
    const idx = levels.findIndex((z) => z >= current);
    const i = idx < 0 ? levels.length - 1 : idx;
    if (direction === 'in') return levels[Math.min(i + 1, levels.length - 1)];
    const out = levels[Math.max(i - 1, 0)];
    return out >= fit ? out : fit;
  }, []);

  // On mount: fit painting to viewport
  const hasInitialFit = useRef(false);
  useEffect(() => {
    if (!canvasRef.current || hasInitialFit.current) return;
    const fit = calculateFitZoom();
    fitZoomRef.current = fit;
    hasInitialFit.current = true;
    setZoom(fit);
    setPan(getCenteredPan(fit));
  }, [calculateFitZoom, getCenteredPan]);

  const animateZoomTo = useCallback(
    (targetZoom: number, centerScreenX: number, centerScreenY: number) => {
      if (zoomAnimatingRef.current) return;
      const startZoom = zoom;
      const startPan = { ...pan };
      const worldX = (centerScreenX - pan.x) / zoom;
      const worldY = (centerScreenY - pan.y) / zoom;
      const endPanX = centerScreenX - worldX * targetZoom;
      const endPanY = centerScreenY - worldY * targetZoom;

      const duration = 250;
      const startTime = performance.now();

      const tick = (now: number) => {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = 1 - (1 - t) ** 2; // ease-out
        const z = startZoom + (targetZoom - startZoom) * eased;
        const px = startPan.x + (endPanX - startPan.x) * eased;
        const py = startPan.y + (endPanY - startPan.y) * eased;
        setZoom(z);
        setPan(clampPan({ x: px, y: py }, z));
        if (t < 1) {
          zoomAnimatingRef.current = true;
          requestAnimationFrame(tick);
        } else {
          zoomAnimatingRef.current = false;
        }
      };
      requestAnimationFrame(tick);
    },
    [zoom, pan, clampPan]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    // #region agent log
    debugLog({
      runId: 'canvas-broken-1',
      hypothesisId: 'H3',
      location: 'Canvas.tsx:handleMouseDown',
      message: 'canvas mousedown',
      data: { clientX: e.clientX, clientY: e.clientY },
    });
    // #endregion
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
        const tile = sceneToTile(worldX, worldY);
        if (tile) setPressedTile(tile);
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
      
      // If moved more than 8px, it's a drag, not a click (prevents canvas jitter on tap)
      if (distance > 8) {
        setHasDragged(true); // Mark as dragged - this prevents tile click
        const next = clampPan(
          { x: panStart.x + deltaX, y: panStart.y + deltaY },
          zoom
        );
        // #region agent log
        debugLog({
          runId: 'click-shift-1',
          hypothesisId: 'H1',
          location: 'components/Canvas.tsx:handleMouseMove',
          message: 'pan updated via mouse drag',
          data: { deltaX, deltaY, distance, nextPan: next, zoom },
        });
        // #endregion
        setPan(next);
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
    
    debugLog({
      runId: 'click-shift-1',
      hypothesisId: 'H3',
      location: 'components/Canvas.tsx:handleMouseUp',
      message: 'mouse up',
      data: { wasDragging, didDrag, pan, zoom },
    });

    // CRITICAL: Only trigger tile click if we were dragging AND never dragged
    // This prevents modal from opening when user drags to pan
    if (wasDragging && !didDrag) {
      // Skip if touchEnd already handled this (avoids double sound on touch devices)
      if (touchClickHandledRef.current) {
        touchClickHandledRef.current = false;
        return;
      }
      // Click without drag - trigger tile click or empty canvas click (scene → grid)
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldX = (x - pan.x) / zoom;
        const worldY = (y - pan.y) / zoom;
        const tile = sceneToTile(worldX, worldY);
        if (tile) {
          touchClickHandledRef.current = true; // Prevent touchEnd from firing playSelect again
          setTimeout(() => { touchClickHandledRef.current = false; }, 80); // Reset for next click
          debugLog({
            runId: 'canvas-broken-1',
            hypothesisId: 'H3',
            location: 'Canvas.tsx:handleMouseUp',
            message: 'tile click invoked',
            data: { tileX: tile.x, tileY: tile.y },
          });
          onTileClick(tile.x, tile.y);
        } else {
          if (onEmptyCanvasClick) onEmptyCanvasClick();
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
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const direction = e.deltaY > 0 ? 'out' : 'in';
      const targetZoom = getNextZoomLevel(zoom, direction);
      if (targetZoom !== zoom) animateZoomTo(targetZoom, mouseX, mouseY);
    } else {
      // Pan gesture (2-finger scroll on trackpad)
      setPan((prev) => clampPan(
        { x: prev.x - e.deltaX, y: prev.y - e.deltaY },
        zoom
      ));
    }
  };

  // Touch handlers for 2-finger gestures
  const getTouchDistance = (touches: React.TouchList | TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touches: React.TouchList | TouchList) => {
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
        const tile = sceneToTile(worldX, worldY);
        if (tile) setPressedTile(tile);
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
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const centerX = currentCenter.x - rect.left;
        const centerY = currentCenter.y - rect.top;
        const direction = currentDistance > touchStartRef.current.distance ? 'in' : 'out';
        const targetZoom = getNextZoomLevel(zoom, direction);
        if (targetZoom !== zoom) animateZoomTo(targetZoom, centerX, centerY);
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
        
        setPan((prev) => clampPan(
          { x: prev.x + deltaX, y: prev.y + deltaY },
          zoom
        ));
        
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
      
      if (distance > 10) {
        setHasDragged(true);
        const next = clampPan(
          { x: panStart.x + deltaX, y: panStart.y + deltaY },
          zoom
        );
        // #region agent log
        debugLog({
          runId: 'click-shift-1',
          hypothesisId: 'H1',
          location: 'components/Canvas.tsx:handleTouchMove',
          message: 'pan updated via touch drag',
          data: { deltaX, deltaY, distance, nextPan: next, zoom },
        });
        // #endregion
        setPan(next);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      // Skip if mouseUp already handled this (avoids double sound when both touch and mouse fire)
      if (touchClickHandledRef.current) {
        touchClickHandledRef.current = false;
        touchStartRef.current = null;
        setIsDragging(false);
        setHasDragged(false);
        setPressedTile(null);
        return;
      }
      // Single tap without drag - trigger tile click or empty canvas click (scene → grid)
      if (isDragging && !hasDragged && e.changedTouches.length === 1 && !touchStartRef.current) {
        const touch = e.changedTouches[0];
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          const worldX = (x - pan.x) / zoom;
          const worldY = (y - pan.y) / zoom;
          const tile = sceneToTile(worldX, worldY);
          if (tile) {
            touchClickHandledRef.current = true;
            onTileClick(tile.x, tile.y);
          } else {
            if (onEmptyCanvasClick) onEmptyCanvasClick();
          }
        }
      }
      debugLog({
        runId: 'click-shift-1',
        hypothesisId: 'H3',
        location: 'components/Canvas.tsx:handleTouchEnd',
        message: 'touch end',
        data: { touches: e.touches.length, isDragging, hasDragged, pan, zoom },
      });
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
    const targetZoom = getNextZoomLevel(zoom, 'in');
    if (targetZoom !== zoom) animateZoomTo(targetZoom, rect.width / 2, rect.height / 2);
  };

  const handleZoomOut = () => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const targetZoom = getNextZoomLevel(zoom, 'out');
    if (targetZoom !== zoom) animateZoomTo(targetZoom, rect.width / 2, rect.height / 2);
  };

  const handleReset = () => {
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
  };

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  const getTileKey = (x: number, y: number) => `${x},${y}`;

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ 
        width: '100%', 
        height: '100%', 
        position: 'absolute', 
        top: 0, 
        left: 0,
        background: '#F4F0ED',
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
          width: CANVAS_WIDTH_PX,
          height: CANVAS_HEIGHT_PX,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Painting surface - square canvas */}
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: '#F4F0ED',
            backgroundImage: 'url(/assets/bg_lines.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        {/* Title card - museum-style label */}
        <div
          className="absolute pointer-events-none select-none"
          style={{
            right: 10,
            bottom: 10,
            width: 40,
            height: 21,
            background: 'rgba(255,255,255,0.96)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            borderRadius: 0,
            padding: '4.5px 3.5px 3.5px 3.5px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: '#1a1a1a',
            overflow: 'hidden',
          }}
          aria-hidden
        >
          <div style={{ fontSize: 1.2, fontWeight: 600, lineHeight: 1.35 }}>
            The Merged Painting
          </div>
          <div
            style={{
              fontSize: 1.2,
              lineHeight: 1.35,
              color: '#444',
              marginTop: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35em',
            }}
          >
            <span>An experiment in collective authorship.</span>
            <span>A shared canvas.</span>
            <span>Pick a square and add your mark.</span>
          </div>
        </div>
        {/* Grid layer - fills painting area */}
        <div
          className="absolute grid overflow-hidden"
          style={{
            left: 0,
            top: 0,
            width: GRID_SIZE_PX,
            height: GRID_HEIGHT_PX,
            gridTemplateColumns: `repeat(${CANVAS_WIDTH}, ${TILE_SIZE_PX}px)`,
            gap: 0,
            borderRadius: 4,
            boxShadow: '0 48px 100px rgba(0,0,0,0.08)',
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
                  zoom={zoom}
                />
              );
            })
          )}
          {/* Beige paper texture overlay - tiled; size scales with zoom to avoid pixelation */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              zIndex: 1,
              backgroundImage: 'url(/assets/beige-paper.png)',
              backgroundRepeat: 'repeat',
              // Keep texture crisp when zooming: smaller backgroundSize at higher zoom
              // so after scale(zoom) we're not upscaling the raster (base 256px apparent size)
              backgroundSize: `${256 / zoom}px`,
              opacity: 0.35,
              mixBlendMode: 'multiply',
            }}
            aria-hidden
          />
          {/* Overhead gradient - light from top */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 2,
              background: 'linear-gradient(to bottom, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 25%, transparent 55%)',
              borderRadius: 8,
            }}
            aria-hidden
          />
        </div>
      </div>

      {/* Zoom controls - fixed to viewport upper right: − 10² + */}
      <div className="fixed z-40 top-5 right-5 flex items-center gap-2 retro-slide-in" style={{ color: '#5E5E5E' }}>
        <button
          onClick={() => {
            const { soundManager } = require('@/lib/sounds');
            soundManager.playClick();
            handleZoomOut();
          }}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300 retro-hover retro-press"
          title="Zoom out"
        >
          −
        </button>
        <span className="text-sm font-semibold min-w-[2.5rem] text-center pointer-events-none tabular-nums">
          {zoomLabel}
        </span>
        <button
          onClick={() => {
            const { soundManager } = require('@/lib/sounds');
            soundManager.playClick();
            handleZoomIn();
          }}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300 retro-hover retro-press"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
