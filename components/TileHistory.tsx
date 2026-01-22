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
    <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white backdrop-blur-xl rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-gray-300 shadow-2xl retro-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">📜 Tile History</h2>
          <button
            onClick={() => {
              const { soundManager } = require('@/lib/sounds');
              soundManager.playClick();
              onClose();
            }}
            className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 text-2xl retro-hover retro-press border border-gray-300"
          >
            ×
          </button>
        </div>

        {history.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No history available for this tile.</p>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <div
                key={item.id}
                className="border border-gray-200 rounded-xl p-4 hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 bg-white retro-hover"
              >
                <div className="flex gap-4">
                  <img
                    src={item.image_url}
                    alt={item.prompt}
                    className="w-24 h-24 object-cover rounded-lg shadow-lg border border-gray-200"
                  />
                  <div className="flex-1">
                    <p className="font-medium mb-1 text-gray-900">{item.prompt}</p>
                    <p className="text-sm text-gray-500">
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
