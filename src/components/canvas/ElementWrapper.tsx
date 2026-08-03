import React, { useState, useEffect } from "react";
import { BoardElement, UserProfile } from "../../types";
import StickyComponent from "../StickyComponent";
import ShapeComponent from "../ShapeComponent";
import TextComponent from "../TextComponent";
import MathComponent from "../MathComponent";
import ImageComponent from "../ImageComponent";
import AudioComponent from "../AudioComponent";
import StampComponent from "../StampComponent";
import { TableComponent } from "../TableComponent";
import { getSvgPathFromPoints } from "../../utils/canvasUtils";

// Memoized individual drawing component for high performance during zoom/pan re-renders
export const DrawingItem = React.memo(({ 
  el, 
  isSelected, 
  isInteractive, 
  activeTool, 
  handleSelectElement 
}: { 
  el: any, 
  isSelected: boolean, 
  isInteractive: boolean, 
  activeTool: string, 
  handleSelectElement: (id: string, e: React.MouseEvent) => void 
}) => {
  const pathData = React.useMemo(() => getSvgPathFromPoints(el.points), [el.points]);
  
  return (
    <g
      className={
        isInteractive
          ? "pointer-events-auto cursor-pointer"
          : "pointer-events-none"
      }
      onPointerDown={(e) => handleSelectElement(el.id, e)}
    >
      {/* Invisible thicker hit area for easier clicking */}
      <path
        d={pathData}
        fill="none"
        stroke="transparent"
        strokeWidth={(el.width || 2) + 16}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={pathData}
        fill="none"
        stroke={el.color}
        strokeWidth={el.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={
          el.isHighlighter
            ? "mix-blend-multiply"
            : "drop-shadow-sm"
        }
        style={
          isSelected
            ? { filter: "drop-shadow(0 0 4px #3b82f6)" }
            : {}
        }
      />
    </g>
  );
});

export const RemoteStreamItem = React.memo(({ stream }: { stream: any }) => {
  const pathData = React.useMemo(() => getSvgPathFromPoints(stream.points), [stream.points]);
  return (
    <path
      d={pathData}
      fill="none"
      stroke={stream.color}
      strokeWidth={stream.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        stream.isHighlighter
          ? "mix-blend-multiply"
          : "drop-shadow-sm"
      }
    />
  );
});

export const RemoteDrawingStreamsLayer = React.memo(({ streamsRef, dirtyRef }: { streamsRef: any, dirtyRef: any }) => {
  const [streams, setStreams] = useState<any>({});
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) {
        setStreams({ ...streamsRef.current });
        dirtyRef.current = false;
      }
    }, 1000 / 30);
    return () => clearInterval(interval);
  }, [streamsRef, dirtyRef]);

  return (
    <>
      {Object.entries(streams).map(([userId, stream]: any) => {
        if (!stream || stream.points.length === 0) return null;
        return <RemoteStreamItem key={`stream-${userId}`} stream={stream} />;
      })}
    </>
  );
});

export const ElementWrapper = React.memo(({
  el,
  isSelected,
  isInteractive,
  currentUser,
  zoom,
  isDragging,
  isResizing,
  selectedIdsLength,
  activeTool,
  canWrite,
  boardId,
  onSelectElement,
  onUpdateElement,
  onDeleteElement
}: {
  el: BoardElement;
  isSelected: boolean;
  isInteractive: boolean;
  currentUser: UserProfile;
  zoom: number;
  isDragging: boolean;
  isResizing: boolean;
  selectedIdsLength: number;
  activeTool: string;
  canWrite: boolean;
  boardId?: string;
  onSelectElement: (id: string, e: React.MouseEvent) => void;
  onUpdateElement: (id: string, updates: Partial<BoardElement>) => void;
  onDeleteElement: (id: string) => void;
}) => {
  const onSelect = React.useCallback((e: React.MouseEvent) => {
    onSelectElement(el.id, e);
  }, [el.id, onSelectElement]);

  const onUpdate = React.useCallback((updates: any) => {
    onUpdateElement(el.id, updates);
  }, [el.id, onUpdateElement]);

  const onDelete = React.useCallback(() => {
    onDeleteElement(el.id);
  }, [el.id, onDeleteElement]);

  const isDraggingOrResizing = isDragging || isResizing || selectedIdsLength > 1;

  if (el.type === "sticky") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <StickyComponent
          element={el}
          isSelected={isSelected}
          currentUser={currentUser}
          zoom={zoom}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          isDraggingOrResizing={isDraggingOrResizing}
          activeTool={activeTool}
          canWrite={canWrite}
        />
      </div>
    );
  }

  if (el.type === "shape") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <ShapeComponent
          element={el}
          isSelected={isSelected}
          currentUser={currentUser}
          zoom={zoom}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          isDraggingOrResizing={isDraggingOrResizing}
          activeTool={activeTool}
          canWrite={canWrite}
        />
      </div>
    );
  }

  if (el.type === "text") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <TextComponent
          element={el}
          isSelected={isSelected}
          currentUser={currentUser}
          zoom={zoom}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          isDraggingOrResizing={isDraggingOrResizing}
          activeTool={activeTool}
          canWrite={canWrite}
        />
      </div>
    );
  }

  if (el.type === "math") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <MathComponent
          element={el}
          isSelected={isSelected}
          currentUser={currentUser}
          zoom={zoom}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          isDraggingOrResizing={isDraggingOrResizing}
          activeTool={activeTool}
          canWrite={canWrite}
        />
      </div>
    );
  }

  if (el.type === "image") {
    const isPdfPage = typeof el?.id === "string" && el.id.startsWith("pdf-page-");
    return (
      <div className={isInteractive && !isPdfPage ? "pointer-events-auto" : "pointer-events-none"}>
        <ImageComponent
          element={el}
          isSelected={isSelected}
          currentUser={currentUser}
          zoom={zoom}
          boardId={boardId}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          isDraggingOrResizing={isDraggingOrResizing}
          activeTool={activeTool}
          canWrite={canWrite}
        />
      </div>
    );
  }

  if (el.type === "audio") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <AudioComponent
          element={el as any}
          isSelected={isSelected}
          isInteractive={isInteractive}
          boardId={boardId}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          currentUser={currentUser}
        />
      </div>
    );
  }

  if (el.type === "stamp") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <StampComponent
          element={el as any}
          isSelected={isSelected}
          isInteractive={isInteractive}
          boardId={boardId}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onDelete={onDelete}
          currentUser={currentUser}
          canWrite={canWrite}
        />
      </div>
    );
  }

  if (el.type === "table") {
    return (
      <div className={isInteractive ? "pointer-events-auto" : "pointer-events-none"}>
        <TableComponent
          element={el as any}
          isSelected={isSelected}
          isReadOnly={!canWrite}
          onSelect={(id, e) => onSelectElement(id, e as any)}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      </div>
    );
  }

  return null;
});
