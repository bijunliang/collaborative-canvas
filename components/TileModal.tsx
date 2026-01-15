'use client';

import { MAX_PROMPT_LENGTH } from '@/lib/constants';
import { useState } from 'react';
import { soundManager } from '@/lib/sounds';

interface TileModalProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => Promise<void>;
  isGenerating: boolean;
}

export default function TileModal({
  x,
  y,
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
}: TileModalProps) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

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

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" style={{ touchAction: 'none' }}>
      {/* Chat promptbox - fixed to bottom with retro dark design */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-center pointer-events-auto" style={{ paddingBottom: '24px' }}>
        <div className="mx-4 retro-slide-in" style={{ width: '500px' }}>
          <form onSubmit={handleSubmit} className="relative">
            <div className="relative">
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (e.target.value.length > 0 && e.target.value.length % 10 === 0) {
                    soundManager.playHover();
                  }
                }}
                placeholder={`Generate something retro for (${x}, ${y})...`}
                className="bg-black/60 backdrop-blur-xl border border-gray-500/30 rounded-xl focus:outline-none focus:border-gray-400/70 focus:ring-2 focus:ring-gray-400/30 resize-none text-gray-200 placeholder-gray-400/50 shadow-2xl transition-all duration-300 retro-hover"
                maxLength={MAX_PROMPT_LENGTH}
                disabled={isGenerating}
                style={{
                  width: '500px',
                  height: '159px',
                  boxSizing: 'border-box',
                  paddingLeft: '16px',
                  paddingBottom: '12px',
                  paddingTop: '16px',
                  paddingRight: '56px',
                }}
              />
              
              {/* Character counter - to the left of send button, vertically centered */}
              {prompt.length > 0 && (
                <div 
                  className="absolute text-xs pointer-events-none flex items-center font-medium"
                  style={{
                    bottom: '12px',
                    right: '48px',
                    height: '32px',
                    background: 'linear-gradient(135deg, rgb(99, 102, 241), rgb(6, 182, 212))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    opacity: 0.7,
                    textShadow: '0 0 4px rgba(6, 182, 212, 0.4)',
                  }}
                >
                  {prompt.length}/{MAX_PROMPT_LENGTH}
                </div>
              )}
              
              {/* Send button - retro gradient button */}
              <button
                type="submit"
                disabled={isGenerating || !prompt.trim()}
                className={`absolute rounded-full flex items-center justify-center transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed retro-hover retro-press ${
                  !isGenerating && prompt.trim()
                    ? 'bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 active:scale-95 shadow-lg shadow-indigo-500/50'
                    : 'bg-white/10 border border-indigo-500/30 hover:bg-indigo-500/20 active:bg-indigo-500/30 disabled:hover:bg-white/10'
                }`}
                style={{
                  bottom: '12px',
                  right: '12px',
                  width: '36px',
                  height: '36px',
                }}
                title={isGenerating ? 'Generating...' : 'Generate'}
              >
                {isGenerating ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={prompt.trim() ? 'text-white' : 'text-white/40'}
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

            {/* Error message - appears above input with retro styling */}
            {error && (
              <div className="mt-3 px-4 py-2.5 bg-red-500/20 backdrop-blur-sm border border-red-400/30 text-red-200 rounded-xl text-sm shadow-lg retro-slide-in">
                {error}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
