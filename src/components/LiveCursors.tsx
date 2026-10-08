import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardElement, Collaborator, Point, UserProfile } from '../types';
import {
  cursorBadgeSize, cursorElementBounds, cursorObstacleIndex, cursorScreenPoint, cursorScreenRect,
  placeCursorBadge, pointsCursorBounds, type CursorRect,
} from '../utils/cursorPlacement';
interface LiveCursorsProps {
  boardId: string;
  currentUser: UserProfile;
  zoom: number;
  panX: number;
  panY: number;
  viewportWidth: number;
  viewportHeight: number;
  elements: BoardElement[];
  socketCollaboratorsRef?: React.MutableRefObject<Record<string, Collaborator>>;
  followedUserId?: string | null;
  remoteDrawingsRef?: React.MutableRefObject<Record<string, { points: Point[]; width: number }>>;
  localDrawingRef?: React.MutableRefObject<Point[]>;
  localDrawingActiveRef?: React.MutableRefObject<boolean>;
  localStrokeWidth?: number;
}
// Screen-space overlay: position follows content pan/zoom; markers retain fixed size.
export default function LiveCursors({
  boardId, currentUser, zoom, panX, panY, viewportWidth, viewportHeight, elements,
  socketCollaboratorsRef, followedUserId, remoteDrawingsRef,
  localDrawingRef, localDrawingActiveRef, localStrokeWidth = 1,
}: LiveCursorsProps) {
  const [snapshot, setSnapshot] = useState<{ boardId: string; collaborators: Collaborator[]; drawingBounds: CursorRect[] }>({
    boardId, collaborators: [], drawingBounds: [],
  });
  const preferred = useRef(new Map<string, Point>());
  useEffect(() => {
    preferred.current.clear();
    setSnapshot({ boardId, collaborators: [], drawingBounds: [] });
    if (!socketCollaboratorsRef) return;
    let previous = '';
    const update = () => {
      const collaborators = Object.values(socketCollaboratorsRef.current || {})
        .filter(c => c && c.id !== currentUser.id && Number.isFinite(c.x) && Number.isFinite(c.y))
        .map(c => ({ ...c })).sort((a, b) => a.id.localeCompare(b.id));
      const drawingBounds = [
        ...Object.values(remoteDrawingsRef?.current || {}).map(stream => pointsCursorBounds(stream.points, stream.width)),
        localDrawingActiveRef?.current ? pointsCursorBounds(localDrawingRef?.current || [], localStrokeWidth) : null,
      ].filter((rect): rect is CursorRect => !!rect);
      const signature = JSON.stringify([collaborators.map(c => [c.id, c.x, c.y, c.name, c.color]), drawingBounds]);
      if (signature !== previous) {
        previous = signature; setSnapshot({ boardId, collaborators, drawingBounds });
      }
    };
    update();
    const interval = setInterval(update, 1000 / 30);
    return () => clearInterval(interval);
  }, [boardId, currentUser.id, socketCollaboratorsRef, remoteDrawingsRef, localDrawingRef, localDrawingActiveRef, localStrokeWidth]);
  const view = { zoom: Math.max(0.05, zoom), panX, panY };
  const viewport = { width: viewportWidth, height: viewportHeight };
  const occupied = useMemo(() => {
    const byId = new Map(elements.map(element => [element.id, element]));
    return cursorObstacleIndex(elements.map(element => cursorElementBounds(element, byId))
      .filter((rect): rect is CursorRect => !!rect)
      .map(rect => cursorScreenRect(rect, { zoom: Math.max(0.05, zoom), panX, panY })), {
        width: viewportWidth, height: viewportHeight,
      });
  }, [elements, zoom, panX, panY, viewportWidth, viewportHeight]);
  const collaborators = snapshot.boardId === boardId ? snapshot.collaborators : [];
  const points = collaborators.map(collaborator => ({ collaborator, point: cursorScreenPoint(collaborator, view) }))
    .filter(({ point }) => point.x >= 0 && point.y >= 0 && point.x <= viewportWidth && point.y <= viewportHeight);
  const reserved: CursorRect[] = points.map(({ point }) => ({ x: point.x - 7, y: point.y - 7, width: 14, height: 14 }));
  const liveDrawings = snapshot.drawingBounds.map(rect => cursorScreenRect(rect, view));
  const avoidance = { overlaps: (rect: CursorRect) => occupied.overlaps(rect) ||
    liveDrawings.some(other => rect.x < other.x + other.width + 6 && rect.x + rect.width > other.x - 6 &&
      rect.y < other.y + other.height + 6 && rect.y + rect.height > other.y - 6) };
  const placements = points.map(({ collaborator, point }) => {
    const badge = placeCursorBadge(point, cursorBadgeSize(collaborator.name), viewport, avoidance,
      reserved, preferred.current.get(collaborator.id));
    if (badge) {
      reserved.push(badge); preferred.current.set(collaborator.id, { x: badge.x - point.x, y: badge.y - point.y });
    } else preferred.current.delete(collaborator.id);
    return { collaborator, point, badge };
  });
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-40" style={{ pointerEvents: 'none' }} id="live-cursors-layer" aria-hidden="true">
      {placements.map(({ collaborator, point, badge }) => (
        <React.Fragment key={collaborator.id}>
          <svg data-cursor-id={collaborator.id} width="10" height="10" viewBox="0 0 10 10"
            className="absolute pointer-events-none" style={{ left: point.x - 5, top: point.y - 5, pointerEvents: 'none', opacity: 0.65 }}
            fill="none" stroke={collaborator.color} strokeWidth={followedUserId === collaborator.id ? 1.6 : 1.1}>
            <circle cx="5" cy="5" r="3.5" />
            <path d="M5 0V2M5 8V10M0 5H2M8 5H10" />
          </svg>
          {badge && <span data-cursor-badge={collaborator.id}
            className="absolute pointer-events-none select-none truncate rounded text-[10px] leading-[18px] px-1"
            style={{ left: badge.x, top: badge.y, width: badge.width, height: badge.height,
              color: collaborator.color, backgroundColor: 'rgba(255,255,255,0.72)', pointerEvents: 'none' }}>
            {collaborator.name}
          </span>}
        </React.Fragment>
      ))}
    </div>
  );
}
