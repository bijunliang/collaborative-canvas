'use client';

import { CanvasPatch } from '@/lib/types';
import {
  CANVAS_WIDTH_PX,
  CANVAS_HEIGHT_PX,
  FRAME_SCREEN_SIZE,
} from '@/lib/constants';
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from 'react';
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
  dailyQuestion: string;
  onlineCount: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const DEFAULT_ZOOM = 0.3;
const ZOOM_SENSITIVITY = 0.003;
const CANVAS_VERTICAL_SHIFT_PX = 20;
const ZOOM_BTN_ANIM_MS = 280;
/** Wall-style shadow on the canvas panel (inner layer only — avoids GPU glitches on the transformed wrapper). */
const CANVAS_WALL_SHADOW =
  '0 48px 100px rgba(45, 40, 36, 0.14), 0 24px 48px rgba(45, 40, 36, 0.1), 0 8px 20px rgba(45, 40, 36, 0.07)';

export default function MergedCanvas({
  patches,
  onGenerate,
  isGenerating,
  dailyQuestion,
  onlineCount,
}: MergedCanvasProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [framePos, setFramePos] = useState({ x: 2970, y: 2970 });
  const [hasDragged, setHasDragged] = useState(false);
  /** Subtle mural parallax (Collective Void motion). */
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  /** Viewport position of canvas container (for `position: fixed` frame while generating). */
  const [viewportOrigin, setViewportOrigin] = useState({ left: 0, top: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const zoomAnimRafRef = useRef<number | null>(null);
  const frameLocked = useRef(false);
  const lockedFrameSizeRef = useRef<number | null>(null);
  const hasInitialFit = useRef(false);
  const touchStartRef = useRef<{
    distance: number;
    zoom: number;
    pan: { x: number; y: number };
    center: { x: number; y: number };
  } | null>(null);
  // World-size so the on-screen box stays ~FRAME_SCREEN_SIZE px (world = screen / zoom).
  // Floor at 8px world so jobs stay valid at extreme zoom.
  const dynamicFrameWorldSize = Math.max(
    8,
    Math.min(2048, Math.round(FRAME_SCREEN_SIZE / zoom))
  );
  const frameWorldSize =
    isGenerating && lockedFrameSizeRef.current != null
      ? lockedFrameSizeRef.current
      : dynamicFrameWorldSize;
  // Always fixed screen size so the square does not jump larger when generation starts
  // (locked world × zoom was wrong when dynamicFrameWorldSize was clamped above raw screen mapping).
  const frameScreenSize = FRAME_SCREEN_SIZE;
  const canPanAtCurrentZoom = (() => {
    if (!containerRef.current) return false;
    const W = containerRef.current.clientWidth;
    const H = containerRef.current.clientHeight;
    return CANVAS_WIDTH_PX * zoom > W || CANVAS_HEIGHT_PX * zoom > H;
  })();

  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    if (!containerRef.current) return p;
    const W = containerRef.current.clientWidth;
    const H = containerRef.current.clientHeight;
    const canvasW = CANVAS_WIDTH_PX * z;
    const canvasH = CANVAS_HEIGHT_PX * z;
    const rawX = canvasW <= W ? (W - canvasW) / 2 : Math.max(W - canvasW, Math.min(0, p.x));
    const rawY = canvasH <= H
      ? (H - canvasH) / 2 - CANVAS_VERTICAL_SHIFT_PX
      : Math.max(H - canvasH, Math.min(0, p.y));
    // Round to reduce subpixel compositor glitches after zoom (Chrome layer holes)
    return {
      x: Math.round(rawX * 100) / 100,
      y: Math.round(rawY * 100) / 100,
    };
  }, []);

  // Keep refs in sync so resize handlers can use current zoom value.
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setViewportOrigin({ left: r.left, top: r.top });
    };
    sync();
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
    }
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      if (vv) {
        vv.removeEventListener('resize', sync);
        vv.removeEventListener('scroll', sync);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (zoomAnimRafRef.current != null) {
        cancelAnimationFrame(zoomAnimRafRef.current);
        zoomAnimRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 20;
      const y = (e.clientY / window.innerHeight - 0.5) * 20;
      setParallax({ x, y });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (!containerRef.current) return;
      const z = zoomRef.current;

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
    setPan(clampPan({ x: 0, y: 0 }, z));
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
    const t = e.target as HTMLElement;
    if (t.closest('[data-generation-frame]')) return;
    if (t.closest('[data-ui-overlay]')) return;
    setIsDragging(true);
    setHasDragged(false);
    setDragStart({ x: e.clientX, y: e.clientY });
    setPanStart({ ...pan });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    if (!canPanAtCurrentZoom) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.hypot(dx, dy) > 5) setHasDragged(true);
    setPan(clampPan({ x: panStart.x + dx, y: panStart.y + dy }, zoom));
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const wasDragging = isDragging;
    const t = e.target as HTMLElement;
    const frameUp = !!t.closest('[data-generation-frame]');
    const overlayUp = !!t.closest('[data-ui-overlay]');
    setIsDragging(false);
    if (frameUp) return;
    if (overlayUp) return;
    if (frameLocked.current) return;
    if (isGenerating) return;
    if (!wasDragging) return;
    if (hasDragged) return;
    const pos = screenToCanvas(e.clientX, e.clientY);
    const maxX = CANVAS_WIDTH_PX - frameWorldSize;
    const maxY = CANVAS_HEIGHT_PX - frameWorldSize;
    setFramePos({
      x: Math.max(0, Math.min(maxX, Math.round(pos.x))),
      y: Math.max(0, Math.min(maxY, Math.round(pos.y))),
    });
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
      if (!canPanAtCurrentZoom) return;
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
        const maxX = CANVAS_WIDTH_PX - frameWorldSize;
        const maxY = CANVAS_HEIGHT_PX - frameWorldSize;
        setFramePos({
          x: Math.max(0, Math.min(maxX, Math.round(pos.x))),
          y: Math.max(0, Math.min(maxY, Math.round(pos.y))),
        });
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
      if (zoomAnimRafRef.current != null) {
        cancelAnimationFrame(zoomAnimRafRef.current);
        zoomAnimRafRef.current = null;
      }
      const r = containerRef.current.getBoundingClientRect();
      const cx = r.width / 2;
      const cy = r.height / 2;
      const startZ = zoomRef.current;
      const endZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZ * factor));
      const wx = (cx - panRef.current.x) / startZ;
      const wy = (cy - panRef.current.y) / startZ;
      const t0 = performance.now();

      const tick = (now: number) => {
        const u = Math.min(1, (now - t0) / ZOOM_BTN_ANIM_MS);
        const eased = 1 - (1 - u) ** 3;
        const z = startZ + (endZ - startZ) * eased;
        const nextPan = clampPan({ x: cx - wx * z, y: cy - wy * z }, z);
        zoomRef.current = z;
        panRef.current = nextPan;
        setZoom(z);
        setPan(nextPan);
        if (u < 1) {
          zoomAnimRafRef.current = requestAnimationFrame(tick);
        } else {
          zoomAnimRafRef.current = null;
        }
      };
      zoomAnimRafRef.current = requestAnimationFrame(tick);
    },
    [clampPan]
  );

  const frameScreenX = isGenerating
    ? viewportOrigin.left + pan.x + framePos.x * zoom
    : pan.x + framePos.x * zoom;
  const frameScreenY = isGenerating
    ? viewportOrigin.top + pan.y + framePos.y * zoom
    : pan.y + framePos.y * zoom;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{
        background: 'var(--void-bg)',
        touchAction: 'none',
        cursor:
          isDragging && canPanAtCurrentZoom ? 'grabbing' : 'crosshair',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Editorial fold lines — behind the mural, visible in viewport margins */}
      <div
        className="canvas-backdrop-folds"
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          display: 'flex',
          pointerEvents: 'none',
        }}
      >
        <div className="canvas-fold-line" />
        <div className="canvas-fold-line" />
        <div className="canvas-fold-line" />
        <div className="canvas-fold-line" />
      </div>

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
            backgroundColor: '#F2F1EE',
            backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            boxShadow: CANVAS_WALL_SHADOW,
            borderRadius: 3,
          }}
        />

        {patches
          .slice()
          .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
          .map((patch, i) => {
            // Reference: depth = (i % 3) + 1, translate = baseOffset * depth (parallax / fake depth).
            const depth = (i % 3) + 1;
            const tx = parallax.x * depth;
            const ty = parallax.y * depth;
            return (
              <div
                key={patch.id}
                className="absolute void-mural-fragment"
                data-canvas-tile
                style={{
                  left: patch.x,
                  top: patch.y,
                  width: patch.width,
                  height: patch.height,
                  zIndex: i + 1,
                  transform: `translate(${tx}px, ${ty}px)`,
                }}
              >
                <img
                  src={patch.image_url}
                  alt=""
                  className="w-full h-full object-cover"
                  style={{
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            );
          })}
      </div>

      {/* Generation frame: outside the scaled div → fixed screen size */}
      <GenerationFrame
        overlayPosition={isGenerating ? 'fixed' : 'absolute'}
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
        promptPlaceholder={dailyQuestion}
        screenToCanvas={screenToCanvas}
        canvasWidth={CANVAS_WIDTH_PX}
        canvasHeight={CANVAS_HEIGHT_PX}
      />

      {/* Online — top right */}
      <div
        data-ui-overlay
        className="void-hud"
        style={{
          position: 'fixed',
          top: 40,
          right: 40,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--void-carbon)',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '0.05em',
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
        <span>
          Online · {Math.max(1, onlineCount)}
        </span>
      </div>

      {/* Zoom bar — lower right (img1-style: bordered squares + %) */}
      <div
        data-ui-overlay
        className="zoom-bar-ctrl"
        style={{
          position: 'fixed',
          bottom: 40,
          right: 40,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => zoomTo(1 / 1.3)}
          className="zoom-bar-btn"
          title="Zoom out"
        >
          −
        </button>
        <span className="zoom-bar-pct">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomTo(1.3)}
          className="zoom-bar-btn"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
