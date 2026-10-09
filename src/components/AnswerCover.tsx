import React from "react";
import { ShapeElement } from "../types";
export default function AnswerCover({
  element,
  canManage,
  onToggle,
  onSelect,
  isSelected = false,
}: {
  element: ShapeElement;
  canManage: boolean;
  onToggle: () => void;
  onSelect: (e: React.MouseEvent, isResize?: boolean) => void;
  isSelected?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        pointerEvents: element.revealed && !canManage ? "none" : "auto",
        background: element.revealed ? "transparent" : "#334155",
        border: canManage ? "2px dashed #94a3b8" : "none",
        borderRadius: 8,
      }}
    >
      <button
        disabled={!canManage}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (canManage) onToggle();
        }}
        aria-label={element.revealed ? "Hide answer" : "Reveal answer"}
        title={canManage ? (element.revealed ? "Click to hide answer" : "Click to reveal answer") : undefined}
        style={{
          width: "100%",
          height: "100%",
          color: element.revealed ? "#334155" : "white",
          cursor: canManage ? "pointer" : "default",
          background: "transparent",
        }}
      >
        {element.revealed ? "" : "Answer covered"}
      </button>
      {canManage && (
        <button
          aria-label="Move answer cover"
          onMouseDown={(e) => onSelect(e)}
          className="absolute -top-6 left-0 bg-slate-700 text-white text-xs px-2 rounded"
        >
          Move
        </button>
      )}
      {canManage && isSelected && (
        <button
          aria-label="Resize answer cover"
          onMouseDown={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("init-resize", {
                detail: { elementId: element.id, originalEvent: e },
              }),
            );
          }}
          className="absolute bottom-0 right-0 w-4 h-4 bg-blue-600 cursor-se-resize"
        />
      )}
    </div>
  );
}
