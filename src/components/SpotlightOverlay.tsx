import React from 'react';
import { Focus, X } from 'lucide-react';

interface SpotlightOverlayProps {
  isActive: boolean;
  onClose: () => void;
  x: number;
  y: number;
  radius?: number;
  canManage?: boolean;
}

export default function SpotlightOverlay({
  isActive,
  onClose,
  x,
  y,
  radius = 130,
  canManage = true,
}: SpotlightOverlayProps) {
  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-20 pointer-events-none overflow-hidden">
      <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="spotlight-mask">
            {/* Fill entire mask with white */}
            <rect width="100%" height="100%" fill="white" />
            {/* Cut out focus circle with black */}
            <circle cx={x} cy={y} r={radius} fill="black" />
          </mask>
        </defs>
        {/* Darkened backdrop masked by spotlight */}
        <rect
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.68)"
          mask="url(#spotlight-mask)"
        />
        {/* Glow border ring around spotlight circle */}
        <circle
          cx={x}
          cy={y}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.85)"
          strokeWidth="2.5"
          strokeDasharray="4 2"
          className="animate-spin"
          style={{ transformOrigin: `${x}px ${y}px`, animationDuration: '20s' }}
        />
      </svg>

      {canManage && (
        <div
          className="pointer-events-auto absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-2 shadow-xl border border-slate-700 animate-in fade-in slide-in-from-top-2"
        >
          <Focus className="w-3.5 h-3.5 text-indigo-400" />
          <span>Spotlight Mode Active</span>
          <button
            onClick={onClose}
            className="p-0.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Exit Spotlight"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
