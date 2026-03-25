'use client';

import { MAX_PROMPT_LENGTH } from '@/lib/constants';
import { useState } from 'react';
import { soundManager } from '@/lib/sounds';

interface FramePromptModalProps {
  frameX: number;
  frameY: number;
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => Promise<void>;
  isGenerating: boolean;
}

export default function FramePromptModal({
  frameX,
  frameY,
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
}: FramePromptModalProps) {
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
      onClose();
    } catch (err) {
      soundManager.playError();
      setError(err instanceof Error ? err.message : 'Failed to generate');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-2">Generate at frame</h3>
        <p className="text-sm text-gray-500 mb-4">
          Position: ({frameX}, {frameY}) — content will blend with surrounding artwork
        </p>
        <form onSubmit={handleSubmit}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what to generate..."
            className="w-full border rounded px-3 py-2 mb-3 min-h-[80px] resize-y"
            maxLength={MAX_PROMPT_LENGTH}
            disabled={isGenerating}
            autoFocus
          />
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {isGenerating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
