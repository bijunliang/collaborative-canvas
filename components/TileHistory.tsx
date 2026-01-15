'use client';

import { TileHistory as TileHistoryType } from '@/lib/types';

interface TileHistoryProps {
  history: TileHistoryType[];
  isOpen: boolean;
  onClose: () => void;
}

export default function TileHistory({ history, isOpen, onClose }: TileHistoryProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-black/80 backdrop-blur-xl rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-cyan-500/30 shadow-2xl retro-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-cyan-300" style={{ textShadow: '0 0 8px rgba(0, 255, 255, 0.5)' }}>📜 Tile History</h2>
          <button
            onClick={() => {
              const { soundManager } = require('@/lib/sounds');
              soundManager.playClick();
              onClose();
            }}
            className="text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-500/20 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 text-2xl retro-hover retro-press border border-cyan-500/20"
            style={{ textShadow: '0 0 4px rgba(0, 255, 255, 0.4)' }}
          >
            ×
          </button>
        </div>

        {history.length === 0 ? (
          <p className="text-cyan-400/60 text-center py-8">No history available for this tile.</p>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="border border-cyan-500/20 rounded-xl p-4 hover:bg-cyan-500/10 hover:border-cyan-400/40 transition-all duration-300 bg-white/5 retro-hover"
              >
                <div className="flex gap-4">
                  <img
                    src={item.image_url}
                    alt={item.prompt}
                    className="w-24 h-24 object-cover rounded-lg shadow-lg border border-cyan-500/30"
                  />
                  <div className="flex-1">
                    <p className="font-medium mb-1 text-cyan-200" style={{ textShadow: '0 0 4px rgba(0, 255, 255, 0.3)' }}>{item.prompt}</p>
                    <p className="text-sm text-cyan-400/60">
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
