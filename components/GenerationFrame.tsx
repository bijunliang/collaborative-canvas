'use client';

import { MAX_PROMPT_LENGTH } from '@/lib/constants';
import { useRef, useCallback, useState } from 'react';

interface GenerationFrameProps {
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
  screenToCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
}

export default function GenerationFrame({
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
  screenToCanvas,
  canvasWidth,
  canvasHeight,
}: GenerationFrameProps) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number; pointerId: number } | null>(null);
  const [frameDragging, setFrameDragging] = useState(false);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setFrameDragging(false);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isGenerating) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = screenToCanvas(e.clientX, e.clientY);
    dragRef.current = {
      offsetX: pos.x - canvasX,
      offsetY: pos.y - canvasY,
      pointerId: e.pointerId,
    };
    setFrameDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
    if ((e.buttons & 1) === 0) {
      endDrag();
      return;
    }
    const p = screenToCanvas(e.clientX, e.clientY);
    const newX = Math.max(0, Math.min(canvasWidth - frameWidth, p.x - dragRef.current.offsetX));
    const newY = Math.max(0, Math.min(canvasHeight - frameHeight, p.y - dragRef.current.offsetY));
    onPositionChange(newX, newY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || e.pointerId !== dragRef.current.pointerId) return;
    endDrag();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const handleLostPointerCapture = () => {
    endDrag();
  };

  const handleSend = async () => {
    setError(null);
    const trimmed = prompt.trim();
    if (!trimmed) { setError('Enter a prompt'); return; }
    if (trimmed.length > MAX_PROMPT_LENGTH) { setError(`Max ${MAX_PROMPT_LENGTH} chars`); return; }
    try {
      await onGenerate(trimmed);
      setPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div
      data-generation-frame
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      className="absolute select-none flex flex-col"
      style={{
        left: screenX,
        top: screenY,
        width: screenSize,
        height: screenSize,
        border: '2px solid #1100FF',
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        cursor: isGenerating ? 'default' : frameDragging ? 'grabbing' : 'grab',
        boxSizing: 'border-box',
        zIndex: 30,
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
                'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 42%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0) 58%, rgba(255,255,255,0) 100%)',
              backgroundSize: '180% 100%',
              opacity: 0.65,
              animation: 'generation-shimmer 3.5s ease-in-out infinite',
            }}
          />
          <div
            className="absolute top-0 left-0 z-20 pointer-events-none pt-3 pl-3 pr-3"
            style={{
              color: '#1100FF',
              fontSize: 14,
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: 400,
            }}
          >
            Generating…
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
          {/* Prompt: full width to frame edge; scrollbar sits at inner right (padding only on left/top/bottom for send) */}
          <div
            data-no-drag
            className="absolute inset-0 flex flex-col pt-3 pl-3 pr-3 pb-12"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="Prompt here"
              className="flex-1 w-full min-h-0 resize-none border-0 bg-transparent focus:outline-none focus:ring-0 placeholder:text-[#1100FF] text-[#1100FF] box-border"
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: 14,
                width: '100%',
              }}
              maxLength={MAX_PROMPT_LENGTH}
            />
            {error && <p className="text-[#1100FF] text-xs opacity-80 shrink-0">{error}</p>}
          </div>
          <button
            data-no-drag
            onClick={(e) => { e.stopPropagation(); handleSend(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute bottom-3 right-3 z-[25] w-9 h-9 rounded-full flex items-center justify-center bg-[#1100FF] text-white hover:opacity-90 transition-opacity shadow-sm"
            title="Generate"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
