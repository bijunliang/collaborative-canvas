'use client';

import { MAX_PROMPT_LENGTH } from '@/lib/constants';
import { useRef, useCallback, useState, useEffect } from 'react';

interface GenerationFrameProps {
  /** `fixed` = viewport pixels (use while generating so zoom doesn’t affect box size). */
  overlayPosition?: 'absolute' | 'fixed';
  screenX: number;
  screenY: number;
  screenSize: number;
  canvasX: number;
  canvasY: number;
  frameWidth: number;
  frameHeight: number;
  onPositionChange: (x: number, y: number) => void;
  onGenerate: (prompt: string) => Promise<void>;
  isGenerating: boolean;
  promptPlaceholder: string;
  screenToCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
}

export default function GenerationFrame({
  overlayPosition = 'absolute',
  screenX,
  screenY,
  screenSize,
  canvasX,
  canvasY,
  frameWidth,
  frameHeight,
  onPositionChange,
  onGenerate,
  isGenerating,
  promptPlaceholder,
  screenToCanvas,
  canvasWidth,
  canvasHeight,
}: GenerationFrameProps) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; pointerId: number } | null>(null);
  const docDragCleanupRef = useRef<(() => void) | null>(null);
  const [frameDragging, setFrameDragging] = useState(false);

  const dragPropsRef = useRef({
    screenToCanvas,
    canvasX,
    canvasY,
    frameWidth,
    frameHeight,
    canvasWidth,
    canvasHeight,
    onPositionChange,
  });
  dragPropsRef.current = {
    screenToCanvas,
    canvasX,
    canvasY,
    frameWidth,
    frameHeight,
    canvasWidth,
    canvasHeight,
    onPositionChange,
  };

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setFrameDragging(false);
  }, []);

  useEffect(() => {
    return () => {
      docDragCleanupRef.current?.();
      docDragCleanupRef.current = null;
      dragRef.current = null;
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isGenerating) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    e.stopPropagation();
    e.preventDefault();

    const el = e.currentTarget;
    const pid = e.pointerId;
    docDragCleanupRef.current?.();
    el.setPointerCapture(pid);

    const { screenToCanvas: stc, canvasX: cx, canvasY: cy } = dragPropsRef.current;
    const pos = stc(e.clientX, e.clientY);
    dragRef.current = {
      offsetX: pos.x - cx,
      offsetY: pos.y - cy,
      pointerId: pid,
    };
    setFrameDragging(true);

    const onDocMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid || !dragRef.current) return;
      const {
        screenToCanvas: st,
        frameWidth: fw,
        frameHeight: fh,
        canvasWidth: cw,
        canvasHeight: ch,
        onPositionChange: onPos,
      } = dragPropsRef.current;
      const p = st(ev.clientX, ev.clientY);
      const newX = Math.max(0, Math.min(cw - fw, p.x - dragRef.current.offsetX));
      const newY = Math.max(0, Math.min(ch - fh, p.y - dragRef.current.offsetY));
      onPos(newX, newY);
    };

    const finishDocDrag = () => {
      document.removeEventListener('pointermove', onDocMove, true);
      document.removeEventListener('pointerup', onDocUp, true);
      document.removeEventListener('pointercancel', onDocUp, true);
      docDragCleanupRef.current = null;
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* already released */
      }
      endDrag();
    };

    const onDocUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      finishDocDrag();
    };

    docDragCleanupRef.current = finishDocDrag;

    document.addEventListener('pointermove', onDocMove, true);
    document.addEventListener('pointerup', onDocUp, true);
    document.addEventListener('pointercancel', onDocUp, true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
    docDragCleanupRef.current?.();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    endDrag();
  };

  const handleLostPointerCapture = () => {
    endDrag();
  };

  const handleSend = async () => {
    setError(null);
    const trimmed = prompt.trim();
    if (!trimmed) { setError('Enter a prompt'); return; }
    if (trimmed.length > MAX_PROMPT_LENGTH) { setError(`Max ${MAX_PROMPT_LENGTH} chars`); return; }
    const previousPrompt = prompt;
    try {
      setPrompt('');
      await onGenerate(trimmed);
    } catch (err) {
      setPrompt(previousPrompt);
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const showFullLabel = screenSize >= 120;

  const px = `${screenSize}px`;

  return (
    <div
      data-generation-frame
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      className="select-none flex flex-col"
      style={{
        position: overlayPosition,
        left: screenX,
        top: screenY,
        width: px,
        height: px,
        minWidth: px,
        maxWidth: px,
        minHeight: px,
        maxHeight: px,
        flexShrink: 0,
        border: '2px solid var(--void-cobalt)',
        backgroundColor: 'rgba(242, 241, 237, 0.72)',
        cursor: isGenerating ? 'default' : frameDragging ? 'grabbing' : 'grab',
        boxSizing: 'border-box',
        zIndex: isGenerating ? 60 : 30,
        pointerEvents: 'auto',
      }}
    >
      {isGenerating ? (
        <>
          <div
            className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
            aria-hidden
            style={{
              background:
                'linear-gradient(100deg, rgba(43,91,221,0) 0%, rgba(43,91,221,0) 40%, rgba(43,91,221,0.08) 46%, rgba(43,91,221,0.14) 50%, rgba(43,91,221,0.08) 54%, rgba(43,91,221,0) 60%, rgba(43,91,221,0) 100%)',
              backgroundSize: '180% 100%',
              animation: 'generation-shimmer 3s ease-in-out infinite',
            }}
          />
          <div
            className="absolute top-0 left-0 right-0 z-20 pointer-events-none pt-3 pl-3 pr-3 overflow-hidden whitespace-nowrap text-ellipsis"
            style={{
              color: 'var(--void-cobalt)',
              fontSize: Math.min(12, screenSize * 0.1),
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {showFullLabel ? 'Generating\u2026' : '\u2026'}
          </div>
          <style>{`
            @keyframes generation-shimmer {
              0% { background-position: 100% 0; }
              100% { background-position: -100% 0; }
            }
          `}</style>
        </>
      ) : (
        <>
          <div
            data-no-drag
            className="absolute inset-0 flex flex-col pt-3 pl-3 pr-3 pb-12"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ cursor: 'text' }}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder={promptPlaceholder}
              className="flex-1 w-full min-h-0 resize-none border-0 bg-transparent focus:outline-none focus:ring-0 box-border void-frame-textarea"
              style={{
                fontSize: 12,
                width: '100%',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'text',
              }}
              maxLength={MAX_PROMPT_LENGTH}
            />
            {error && (
              <p className="text-xs opacity-80 shrink-0 void-frame-error">{error}</p>
            )}
          </div>
          <button
            data-no-drag
            onClick={(e) => { e.stopPropagation(); handleSend(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-3 right-3 z-[25] w-[27px] h-[27px] rounded-full flex items-center justify-center text-white hover:opacity-90 transition-opacity shadow-sm void-frame-send cursor-pointer"
            title="Generate"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
