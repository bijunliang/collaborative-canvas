'use client';

import { CanvasPatch } from '@/lib/types';
import {
  CANVAS_WIDTH_PX,
  CANVAS_HEIGHT_PX,
  FRAME_SCREEN_SIZE,
} from '@/lib/constants';
import { useState, useRef, useEffect, useCallback } from 'react';
import GenerationFrame from './GenerationFrame';

interface MergedCanvasProps {
  patches: CanvasPatch[];
  onGenerate: (
    frameX: number,
    frameY: number,
    frameWidth: number,
    frameHeight: number,
    prompt: string
  ) => Promise<void>;
  isGenerating: boolean;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 0.1;
const ZOOM_SENSITIVITY = 0.003;
/** Wall-style shadow on the canvas panel (inner layer only — avoids GPU glitches on the transformed wrapper). */
const CANVAS_WALL_SHADOW =
  '0 48px 100px rgba(45, 40, 36, 0.14), 0 24px 48px rgba(45, 40, 36, 0.1), 0 8px 20px rgba(45, 40, 36, 0.07)';

export default function MergedCanvas({
  patches,
  onGenerate,
  isGenerating,
}: MergedCanvasProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [framePos, setFramePos] = useState({ x: 2970, y: 2970 });
  const [hasDragged, setHasDragged] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const clampPanLogBudgetRef = useRef(0);
  const resizeLogBudgetRef = useRef(0);
  const bgZoomLogBudgetRef = useRef(0);
  const frameLocked = useRef(false);
  const lockedFrameSizeRef = useRef<number | null>(null);
  const hasInitialFit = useRef(false);
  const touchStartRef = useRef<{
    distance: number;
    zoom: number;
    pan: { x: number; y: number };
    center: { x: number; y: number };
  } | null>(null);
  // World-size of the selected square (how many canvas "world" pixels correspond
  // to the fixed on-screen frame size).
  const dynamicFrameWorldSize = Math.max(
    64,
    Math.min(2048, Math.round(FRAME_SCREEN_SIZE / zoom))
  );
  const frameWorldSize =
    isGenerating && lockedFrameSizeRef.current != null
      ? lockedFrameSizeRef.current
      : dynamicFrameWorldSize;
  // Before generating: keep the blue overlay a constant size on screen.
  // During generation: lock world size, but let the overlay scale with zoom so it stays aligned
  // with the same locked world-region you started generating from.
  const frameScreenSize =
    isGenerating && lockedFrameSizeRef.current != null
      ? Math.round(lockedFrameSizeRef.current * zoom)
      : FRAME_SCREEN_SIZE;

  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    if (!containerRef.current) return p;
    const W = containerRef.current.clientWidth;
    const H = containerRef.current.clientHeight;
    const canvasW = CANVAS_WIDTH_PX * z;
    const canvasH = CANVAS_HEIGHT_PX * z;
    // #region agent log
    if (clampPanLogBudgetRef.current < 6) {
      clampPanLogBudgetRef.current += 1;
      fetch('http://127.0.0.1:7244/ingest/309fda68-2807-4152-9004-ca9a99f67d3b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '56d864' },
        body: JSON.stringify({
          sessionId: '56d864',
          location: 'MergedCanvas.tsx:clampPan',
          message: 'clampPan invoked',
          data: {
            containerW: W,
            containerH: H,
            canvasW,
            canvasH,
            incomingPanX: p.x,
            incomingPanY: p.y,
            canCenterX: canvasW <= W,
          },
          timestamp: Date.now(),
          hypothesisId: 'H2',
        }),
      }).catch(() => {});
    }
    // #endregion
    const rawX = canvasW <= W ? (W - canvasW) / 2 : Math.max(W - canvasW, Math.min(0, p.x));
    const rawY = canvasH <= H ? (H - canvasH) / 2 : Math.max(H - canvasH, Math.min(0, p.y));
    // Round to reduce subpixel compositor glitches after zoom (Chrome layer holes)
    return {
      x: Math.round(rawX * 100) / 100,
      y: Math.round(rawY * 100) / 100,
    };
  }, []);

  // Keep refs in sync so resize handler can log current values without constantly re-subscribing.
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const bgScalePercent = Math.max(40, Math.round((zoom / DEFAULT_ZOOM) * 100));
  useEffect(() => {
    if (bgZoomLogBudgetRef.current >= 8) return;
    bgZoomLogBudgetRef.current += 1;
    fetch('http://127.0.0.1:7244/ingest/309fda68-2807-4152-9004-ca9a99f67d3b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '56d864' },
      body: JSON.stringify({
        sessionId: '56d864',
        location: 'MergedCanvas.tsx:bgScale',
        message: 'bgScale computed from zoom',
        data: {
          zoom,
          defaultZoom: DEFAULT_ZOOM,
          minZoom: MIN_ZOOM,
          bgScalePercent,
          isAtMinZoom: zoom === MIN_ZOOM,
        },
        timestamp: Date.now(),
        hypothesisId: 'H5',
      }),
    }).catch(() => {});
  }, [zoom, bgScalePercent]);

  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return;
      const W = containerRef.current.clientWidth;
      const z = zoomRef.current;
      const canvasW = CANVAS_WIDTH_PX * z;
      const { x: panX, y: panY } = panRef.current;

      // #region agent log
      if (resizeLogBudgetRef.current < 8) {
        resizeLogBudgetRef.current += 1;
        fetch('http://127.0.0.1:7244/ingest/309fda68-2807-4152-9004-ca9a99f67d3b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '56d864' },
          body: JSON.stringify({
            sessionId: '56d864',
            location: 'MergedCanvas.tsx:resize',
            message: 'window resized',
            data: {
              containerW: W,
              zoom: z,
              canvasW,
              canCenterX: canvasW <= W,
              panX,
              panY,
            },
            timestamp: Date.now(),
            hypothesisId: 'H3',
          }),
        }).catch(() => {});
      }
      // #endregion

      // Recompute pan so the canvas remains centered as the browser size changes.
      // This is the behavior you expect when resizing the window.
      setPan((p) => clampPan(p, z));
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Prefer observing the actual container size (more reliable than window.resize,
  // e.g. when layout changes without a window resize event).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const z = zoomRef.current;
      setPan((p) => clampPan(p, z));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clampPan]);

  useEffect(() => {
    if (hasInitialFit.current || !containerRef.current) return;
    hasInitialFit.current = true;
    const z = DEFAULT_ZOOM;
    setZoom(z);
    const initialYOffset = -containerRef.current.clientHeight * 0.1;
    setPan(clampPan({ x: 0, y: initialYOffset }, z));
  }, [clampPan]);

  // After any zoom change, re-clamp pan so it stays valid (avoids edge gaps / “missing” canvas)
  useEffect(() => {
    if (!hasInitialFit.current) return;
    setPan((p) => clampPan(p, zoom));
  }, [zoom, clampPan]);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (screenX - rect.left - pan.x) / zoom,
        y: (screenY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-generation-frame]')) return;
    if ((e.target as HTMLElement).closest('[data-ui-overlay]')) return;
    setIsDragging(true);
    setHasDragged(false);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart({ ...pan });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 5) setHasDragged(true);
    setPan(clampPan({ x: panStart.x + dx, y: panStart.y + dy }, zoom));
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const wasDragging = isDragging;
    setIsDragging(false);
    if ((e.target as HTMLElement).closest('[data-generation-frame]')) return;
    if ((e.target as HTMLElement).closest('[data-ui-overlay]')) return;
    if (frameLocked.current) return;
    if (isGenerating) return;
    if (!wasDragging) return;
    if (hasDragged) return;
    const pos = screenToCanvas(e.clientX, e.clientY);
    if (
      pos.x >= 0 &&
      pos.x <= CANVAS_WIDTH_PX - frameWorldSize &&
      pos.y >= 0 &&
      pos.y <= CANVAS_HEIGHT_PX - frameWorldSize
    ) {
      setFramePos({ x: Math.round(pos.x), y: Math.round(pos.y) });
    }
  };

  const handleFramePositionChange = useCallback((x: number, y: number) => {
    if (!frameLocked.current && !isGenerating) setFramePos({ x, y });
  }, [isGenerating]);

  const handleGenerate = useCallback(
    async (prompt: string) => {
      frameLocked.current = true;
      const lockedSize = dynamicFrameWorldSize;
      lockedFrameSizeRef.current = lockedSize;
      try {
        await onGenerate(framePos.x, framePos.y, lockedSize, lockedSize, prompt);
      } finally {
        frameLocked.current = false;
        lockedFrameSizeRef.current = null;
      }
    },
    [framePos.x, framePos.y, dynamicFrameWorldSize, onGenerate]
  );

  const getTouchDistance = (t: React.TouchList | TouchList) => {
    if (t.length < 2) return 0;
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-generation-frame]')) return;
    if ((e.target as HTMLElement).closest('[data-ui-overlay]')) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      touchStartRef.current = {
        distance: getTouchDistance(e.touches),
        zoom,
        pan: { ...pan },
        center: { x: cx, y: cy },
      };
    } else if (e.touches.length === 1) {
      setIsDragging(true);
      setHasDragged(false);
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
      setPanStart({ ...pan });
      touchStartRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartRef.current) {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ts = touchStartRef.current;
      const curDist = getTouchDistance(e.touches);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const scale = curDist / ts.distance;
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ts.zoom * scale));
      const worldX = (ts.center.x - ts.pan.x) / ts.zoom;
      const worldY = (ts.center.y - ts.pan.y) / ts.zoom;
      setZoom(newZ);
      setPan(clampPan({ x: cx - worldX * newZ, y: cy - worldY * newZ }, newZ));
    } else if (e.touches.length === 1 && isDragging) {
      e.preventDefault();
      const dx = e.touches[0].clientX - dragStart.x;
      const dy = e.touches[0].clientY - dragStart.y;
      if (Math.hypot(dx, dy) > 5) setHasDragged(true);
      setPan(clampPan({ x: panStart.x + dx, y: panStart.y + dy }, zoom));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      touchStartRef.current = null;
      setIsDragging(false);
      if (frameLocked.current || isGenerating) return;
      if (!hasDragged && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        if (document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-generation-frame]')) return;
        if (document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-ui-overlay]')) return;
        const pos = screenToCanvas(touch.clientX, touch.clientY);
        if (
          pos.x >= 0 &&
          pos.x <= CANVAS_WIDTH_PX - frameWorldSize &&
          pos.y >= 0 &&
          pos.y <= CANVAS_HEIGHT_PX - frameWorldSize
        ) {
          setFramePos({ x: Math.round(pos.x), y: Math.round(pos.y) });
        }
      }
    } else if (e.touches.length === 1) {
      touchStartRef.current = null;
    }
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // Normalize delta for cross-browser consistency (Chrome/Firefox vary by deltaMode)
        let deltaY = e.deltaY;
        if (e.deltaMode === 1) deltaY *= 33; // DOM_DELTA_LINE → ~pixels
        else if (e.deltaMode === 2) deltaY *= 250; // DOM_DELTA_PAGE
        const delta = -deltaY * ZOOM_SENSITIVITY;
        const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + delta)));
        const worldX = (mx - pan.x) / zoom;
        const worldY = (my - pan.y) / zoom;
        setPan(clampPan({ x: mx - worldX * newZ, y: my - worldY * newZ }, newZ));
        setZoom(newZ);
      } else {
        let deltaX = e.deltaX;
        let deltaY = e.deltaY;
        if (e.deltaMode === 1) {
          deltaX *= 33;
          deltaY *= 33;
        } else if (e.deltaMode === 2) {
          deltaX *= 250;
          deltaY *= 250;
        }
        setPan((p) => clampPan({ x: p.x - deltaX, y: p.y - deltaY }, zoom));
      }
    },
    [zoom, pan, clampPan]
  );

  const handleWheelRef = useRef(handleWheel);
  handleWheelRef.current = handleWheel;

  // Chrome uses passive wheel listeners by default, so React's onWheel can't preventDefault.
  // We must attach a native listener with { passive: false } for zoom/pan to work in Chrome.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' && t.closest('[data-generation-frame]')) return;
      handleWheelRef.current(e);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const zoomTo = useCallback(
    (factor: number) => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const cx = r.width / 2;
      const cy = r.height / 2;
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const wx = (cx - pan.x) / zoom;
      const wy = (cy - pan.y) / zoom;
      setZoom(newZ);
      setPan(clampPan({ x: cx - wx * newZ, y: cy - wy * newZ }, newZ));
    },
    [zoom, pan, clampPan]
  );

  const frameScreenX = pan.x + framePos.x * zoom;
  const frameScreenY = pan.y + framePos.y * zoom;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{
        background: '#F4F0ED',
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Room background lines behind the entire canvas; scaled via transform so aspect ratio isn't distorted */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/assets/bg_lines.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          transform: `scale(${bgScalePercent / 100})`,
          transformOrigin: 'center',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Scaled canvas world: shadow sits on inner surface, not the translate3d node (Chrome compositor) */}
      <div
        className="absolute left-0 top-0"
        style={{
          width: CANVAS_WIDTH_PX,
          height: CANVAS_HEIGHT_PX,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
          zIndex: 1,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: '#FAF7F4',
            backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            boxShadow: CANVAS_WALL_SHADOW,
            borderRadius: 3,
          }}
        />

        {patches
          .slice()
          .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
          .map((patch, i) => (
            <div
              key={patch.id}
              className="absolute"
              style={{
                left: patch.x,
                top: patch.y,
                width: patch.width,
                height: patch.height,
                zIndex: i + 1,
              }}
            >
              <img
                src={patch.image_url}
                alt=""
                className="w-full h-full object-cover"
                style={{ display: 'block', pointerEvents: 'none' }}
              />
            </div>
          ))}
      </div>

      {/* Generation frame: outside the scaled div → fixed screen size */}
      <GenerationFrame
        screenX={frameScreenX}
        screenY={frameScreenY}
        screenSize={frameScreenSize}
        canvasX={framePos.x}
        canvasY={framePos.y}
        frameWidth={frameWorldSize}
        frameHeight={frameWorldSize}
        onPositionChange={handleFramePositionChange}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        screenToCanvas={screenToCanvas}
        canvasWidth={CANVAS_WIDTH_PX}
        canvasHeight={CANVAS_HEIGHT_PX}
      />

      {/* Online presence indicator — fixed to viewport */}
      <div
        data-ui-overlay
        style={{
          position: 'fixed',
          top: 20,
          left: 20,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: '#1100FF',
          fontWeight: 600,
          fontSize: 14,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#22c55e',
            boxShadow: '0 0 6px rgba(34,197,94,0.6)',
          }}
        />
        <span>Online</span>
      </div>

      {/* Zoom controls — fixed to viewport */}
      <div
        data-ui-overlay
        style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: '#1100FF',
          pointerEvents: 'auto',
        }}
      >
        <button
          onClick={() => zoomTo(1 / 1.3)}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: 'none',
            padding: 0,
            boxShadow: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 600,
          }}
          title="Zoom out"
        >
          −
        </button>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            minWidth: 32,
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => zoomTo(1.3)}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: 'none',
            padding: 0,
            boxShadow: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 18,
            fontWeight: 600,
          }}
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
