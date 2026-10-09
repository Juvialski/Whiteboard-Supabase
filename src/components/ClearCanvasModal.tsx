import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface ClearCanvasModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  elementCount: number;
  activePageOnly?: boolean;
  isPdfBoard?: boolean;
}

export default function ClearCanvasModal({
  isOpen,
  onClose,
  onConfirm,
  elementCount,
  activePageOnly=false,
  isPdfBoard=false,
}: ClearCanvasModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-extrabold text-slate-900">{activePageOnly ? 'Clear active page annotations?' : isPdfBoard ? 'Clear annotations only?' : 'Clear canvas?'}</h3>
          <p className="text-sm text-slate-500">
            This removes <strong className="text-slate-700 font-bold">{elementCount}</strong> element(s){activePageOnly ? ' on the active page' : ''}. PDF pages and private assets stay intact. Ctrl+Z cannot undo this collaborative action. A complete recovery archive downloads before clearing. Keep that file and use Restore board archive on the dashboard to recover into a separate private board.
          </p>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear Canvas</span>
          </button>
        </div>
      </div>
    </div>
  );
}
