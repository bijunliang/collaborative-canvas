'use client';

import { MAX_PROMPT_LENGTH } from '@/lib/constants';
import { useEffect, useRef, useState } from 'react';
import { soundManager } from '@/lib/sounds';

interface TileModalProps {
  x: number;
  y: number;
  isOpen: boolean;
  isExiting?: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => Promise<void>;
  isGenerating: boolean;
}

export default function TileModal({
  x,
  y,
  isOpen,
  isExiting = false,
  onClose,
  onGenerate,
  isGenerating,
}: TileModalProps) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollPromptToBottom = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  const handleAnimationEnd = () => {
    if (isExiting) onClose();
  };

  // #region agent log
  if (typeof window !== 'undefined') {
    fetch('http://127.0.0.1:7244/ingest/330fd681-e7d7-4152-bee8-daf02ef4afc3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'canvas-broken-1',
        hypothesisId: 'H3',
        location: 'TileModal.tsx:render',
        message: 'TileModal render',
        data: { isOpen, isExiting, rendering: !(!isOpen && !isExiting) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  if (!isOpen && !isExiting) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      setError(`Prompt must be ${MAX_PROMPT_LENGTH} characters or less`);
      return;
    }

    try {
      soundManager.playGenerationStart();
      await onGenerate(prompt.trim());
      setPrompt('');
      setError(null);
      // Don't close immediately - let user see the generation start
      // The promptbox will close when user clicks outside or selects another tile
    } catch (err) {
      soundManager.playError();
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate image';
      setError(errorMessage);
      console.error('Generation error in TileModal:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      scrollPromptToBottom();
    }
  }, [isOpen, prompt]);

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" style={{ touchAction: 'none' }}>
      {/* Prompthand slides up from bottom with bounce, promptbox inside the paper square */}
      <div
        className="fixed bottom-0 left-0 right-0 flex justify-center items-end pointer-events-none overflow-visible"
        style={{ paddingTop: '15vh' }}
      >
        <div
          className={`relative pointer-events-auto ${isExiting ? 'prompthand-slide-down' : 'prompthand-slide-up'}`}
          style={{
            width: '369px',
            maxWidth: 'min(369px, 85vw)',
            marginLeft: 'auto',
            marginRight: '100px',
            marginBottom: '-100px',
          }}
          onAnimationEnd={handleAnimationEnd}
        >
          <img
            src="/assets/prompthand.svg"
            alt=""
            className="block w-full h-auto"
            style={{ maxHeight: '70vh' }}
            aria-hidden
          />

          {/* Promptbox overlay - positioned inside paper, shifted away from hand grip */}
          <div
            className="absolute overflow-hidden"
            style={{
              left: 'calc(8% + 10px)',
              top: '26%',
              width: '62%',
              height: '40%',
              transform: 'rotate(-29.2deg)',
              transformOrigin: 'top left',
            }}
          >
            <div className="w-full h-full flex flex-col overflow-hidden">
              <form onSubmit={handleSubmit} className="relative flex-1 flex flex-col min-h-0">
                <div className="relative flex-1 flex flex-col min-h-0">
                  <textarea
                    ref={textareaRef}
                    id="prompt"
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      // No sound while typing; hover sound reserved for pointer interactions only
                      requestAnimationFrame(() => {
                        const el = e.currentTarget;
                        el.scrollTop = el.scrollHeight;
                      });
                    }}
                    placeholder={`Generate for (${x}, ${y})...`}
                    className="w-full h-full bg-transparent border-0 focus:outline-none focus:ring-0 resize-none overflow-y-auto overflow-x-hidden text-gray-900 placeholder-gray-500 transition-colors promptbox-input promptbox-textarea font-caveat"
                    maxLength={MAX_PROMPT_LENGTH}
                    disabled={isGenerating}
                    style={{
                      boxSizing: 'border-box',
                      padding: '0px 6px 50px 18px',
                      fontFamily: "'Caveat', cursive",
                      fontSize: '21px',
                      overscrollBehavior: 'contain',
                    }}
                  />

                  <div
                    className="absolute flex items-center gap-2"
                    style={{ bottom: '8px', right: '10px' }}
                  >
                    {prompt.length > 0 && (
                      <span
                        className="text-[10px] pointer-events-none font-medium font-caveat"
                        style={{ color: '#666', opacity: 0.8 }}
                      >
                        {prompt.length}/{MAX_PROMPT_LENGTH}
                      </span>
                    )}
                    <button
                      type="submit"
                      disabled={isGenerating || !prompt.trim()}
                      className={`rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
                        !isGenerating && prompt.trim()
                          ? 'bg-gray-900 hover:bg-gray-800 active:scale-95 shadow-md'
                          : 'bg-gray-200/80 border border-gray-300 hover:bg-gray-300/80'
                      }`}
                      style={{ width: '28px', height: '28px' }}
                      title={isGenerating ? 'Generating...' : 'Generate'}
                    >
                      {isGenerating ? (
                        <div className="w-3 h-3 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 12 12"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className={prompt.trim() ? 'text-white' : 'text-gray-400'}
                        >
                          <path
                            d="M6 2V10M6 2L2 6M6 2L10 6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="mt-1 px-2 py-1.5 bg-red-50/90 border border-red-200 text-red-700 rounded text-xs">
                    {error}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
