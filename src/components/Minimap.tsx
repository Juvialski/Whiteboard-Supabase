import React, { useState, useRef, useCallback } from 'react';
import { BoardElement } from '../types';
import { MapPin, ChevronDown, ChevronUp, Layers } from 'lucide-react';

interface MinimapProps {
  elements: BoardElement[];
  panX: number;
  panY: number;
  zoom: number;
  containerWidth: number;
  containerHeight: number;
  onPanTo: (newPanX: number, newPanY: number) => void;
}

export default function Minimap({
  elements,
  panX,
  panY,
  zoom,
  containerWidth,
  containerHeight,
  onPanTo,
}: MinimapProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const mapRef = useRef<HTMLDivElement>(null);

  // Map dimensions
  const MAP_WIDTH = 180;
  const MAP_HEIGHT = 120;

  // Calculate canvas bounding box based on elements
  let minX = -1000;
  let maxX = 2000;
  let minY = -1000;
  let maxY = 2000;

  elements.forEach((el) => {
    if (el.type === 'drawing') {
      el.points?.forEach((p) => {
        if (p.x < minX) minX = p.x - 200;
        if (p.x > maxX) maxX = p.x + 200;
        if (p.y < minY) minY = p.y - 200;
        if (p.y > maxY) maxY = p.y + 200;
      });
    } else {
      const b = el as any;
      const x = b.x || 0;
      const y = b.y || 0;
      const w = b.width || 150;
      const h = b.height || 150;
      if (x < minX) minX = x - 200;
      if (x + w > maxX) maxX = x + w + 200;
      if (y < minY) minY = y - 200;
      if (y + h > maxY) maxY = y + h + 200;
    }
  });

  const worldWidth = Math.max(1200, maxX - minX);
  const worldHeight = Math.max(800, maxY - minY);

  const scaleX = MAP_WIDTH / worldWidth;
  const scaleY = MAP_HEIGHT / worldHeight;

  // Convert canvas world coordinates to minimap coordinates
  const worldToMap = useCallback(
    (wx: number, wy: number) => {
      const mx = (wx - minX) * scaleX;
      const my = (wy - minY) * scaleY;
      return { mx, my };
    },
    [minX, minY, scaleX, scaleY]
  );

  // Convert minimap click coordinates back to target panX, panY
  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mapRef.current) return;
    const rect = mapRef.current.getBoundingClientRect();
    const clickMx = e.clientX - rect.left;
    const clickMy = e.clientY - rect.top;

    // Convert minimap click to world coordinates
    const targetWorldX = clickMx / scaleX + minX;
    const targetWorldY = clickMy / scaleY + minY;

    // Center target world point in current container viewport
    const newPanX = containerWidth / 2 - targetWorldX * zoom;
    const newPanY = containerHeight / 2 - targetWorldY * zoom;

    onPanTo(newPanX, newPanY);
  };

  // Viewport rectangle in minimap
  // container viewport top-left in world coords:
  const viewWorldLeft = -panX / zoom;
  const viewWorldTop = -panY / zoom;
  const viewWorldWidth = containerWidth / zoom;
  const viewWorldHeight = containerHeight / zoom;

  const vpMapLeft = (viewWorldLeft - minX) * scaleX;
  const vpMapTop = (viewWorldTop - minY) * scaleY;
  const vpMapW = Math.max(16, viewWorldWidth * scaleX);
  const vpMapH = Math.max(12, viewWorldHeight * scaleY);

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 hover:text-blue-600 border border-slate-200/90 shadow-md hover:shadow-lg rounded-2xl p-2.5 flex items-center space-x-1.5 text-xs font-bold cursor-pointer transition-all hover:scale-105 active:scale-95 group"
        title="Open Canvas Minimap"
      >
        <Layers className="w-4 h-4 text-blue-600" />
        <span className="hidden sm:inline">Map</span>
      </button>
    );
  }

  return (
    <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-lg p-2 flex flex-col space-y-1.5 select-none animate-fade-in w-[196px]">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-1 text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
          <MapPin className="w-3 h-3 text-blue-600" />
          <span>Canvas Overview</span>
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-0.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Minimize Map"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        ref={mapRef}
        onClick={handleMinimapClick}
        style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
        className="relative bg-slate-100/90 rounded-xl border border-slate-200/80 overflow-hidden cursor-crosshair group shadow-inner"
      >
        {/* Render elements miniature outlines */}
        <svg className="w-full h-full pointer-events-none">
          {elements.map((el) => {
            if (el.type === 'drawing') {
              if (!el.points || el.points.length === 0) return null;
              const pathStr = el.points
                .map((p, idx) => {
                  const { mx, my } = worldToMap(p.x, p.y);
                  return `${idx === 0 ? 'M' : 'L'}${mx.toFixed(1)},${my.toFixed(1)}`;
                })
                .join(' ');
              return (
                <path
                  key={el.id}
                  d={pathStr}
                  stroke={el.color || '#3b82f6'}
                  strokeWidth="1.5"
                  fill="none"
                  opacity="0.8"
                />
              );
            }

            const b = el as any;
            const { mx, my } = worldToMap(b.x || 0, b.y || 0);
            const mw = Math.max(3, (b.width || 150) * scaleX);
            const mh = Math.max(3, (b.height || 150) * scaleY);

            let fillColor = '#cbd5e1';
            if (el.type === 'sticky') fillColor = b.color || '#fef08a';
            else if (el.type === 'shape') fillColor = b.color || '#93c5fd';
            else if (el.type === 'text') fillColor = '#334155';

            return (
              <rect
                key={el.id}
                x={mx}
                y={my}
                width={mw}
                height={mh}
                fill={fillColor}
                stroke="#64748b"
                strokeWidth="0.5"
                rx="1"
                opacity="0.85"
              />
            );
          })}
        </svg>

        {/* Viewport Indicator Rectangle */}
        <div
          className="absolute border-2 border-blue-600 bg-blue-500/15 rounded-sm pointer-events-none transition-all duration-75 shadow-sm"
          style={{
            left: `${Math.max(0, Math.min(MAP_WIDTH - 12, vpMapLeft))}px`,
            top: `${Math.max(0, Math.min(MAP_HEIGHT - 12, vpMapTop))}px`,
            width: `${Math.min(MAP_WIDTH, vpMapW)}px`,
            height: `${Math.min(MAP_HEIGHT, vpMapH)}px`,
          }}
        />
      </div>
    </div>
  );
}
