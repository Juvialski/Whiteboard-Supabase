import type { BoardElement, Point } from '../types';
import { getElementSocketCoords } from './canvasUtils';
export interface CursorRect { x: number; y: number; width: number; height: number }
export interface CursorViewport { width: number; height: number }
export interface CursorView { zoom: number; panX: number; panY: number }
export const cursorScreenPoint = (point: Point, view: CursorView): Point => ({
  x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY,
});
const padded = (rect: CursorRect, padding: number): CursorRect => ({
  x: rect.x - padding, y: rect.y - padding, width: rect.width + padding * 2, height: rect.height + padding * 2,
});
export const cursorRectsOverlap = (a: CursorRect, b: CursorRect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export function pointsCursorBounds(points: Point[], width = 1): CursorRect | null {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return Number.isFinite(minX) ? padded({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, Math.max(1, width) / 2) : null;
}
export function cursorElementBounds(element: BoardElement, byId: Map<string, BoardElement>): CursorRect | null {
  if (element.type === 'drawing') return pointsCursorBounds(element.points, element.width);
  if (element.type === 'connector') {
    const from = byId.get(element.fromId), to = element.toId ? byId.get(element.toId) : null;
    if (!from) return null;
    const start = getElementSocketCoords(from, element.fromSocket);
    const end = to ? getElementSocketCoords(to, element.toSocket || 'top') : element.endPoint;
    if (!end) return null;
    // The rendered Bézier is contained in the convex hull of its control points.
    const strength = Math.min(100, Math.max(30, Math.hypot(end.x - start.x, end.y - start.y) * 0.3));
    const control = (point: Point, socket: string) => ({
      x: point.x + (socket === 'right' ? strength : socket === 'left' ? -strength : 0),
      y: point.y + (socket === 'bottom' ? strength : socket === 'top' ? -strength : 0),
    });
    return pointsCursorBounds([start, end, control(start, element.fromSocket),
      ...(to ? [control(end, element.toSocket || 'top')] : [])], Math.max(28, element.strokeWidth || 2.5));
  }
  const box = element as any;
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;
  // Includes full image/PDF page bounds; don't guess that blank pixels are empty.
  return { x: box.x, y: box.y, width: Math.max(1, box.width || (element.type === 'audio' ? 280 : 200)),
    height: Math.max(1, box.height || (element.type === 'audio' ? 72 : 80)) };
}
export function cursorScreenRect(rect: CursorRect, view: CursorView): CursorRect {
  return { ...cursorScreenPoint(rect, view), width: rect.width * view.zoom, height: rect.height * view.zoom };
}
// Index visible content once per content/pan/zoom change, not once per cursor tick.
export function cursorObstacleIndex(rectangles: CursorRect[], viewport: CursorViewport) {
  const cells = new Map<string, CursorRect[]>();
  const cellSize = 128;
  for (const raw of rectangles) {
    const rect = padded(raw, 6);
    const left = Math.max(0, rect.x), top = Math.max(0, rect.y);
    const right = Math.min(viewport.width, rect.x + rect.width), bottom = Math.min(viewport.height, rect.y + rect.height);
    if (left >= right || top >= bottom) continue;
    for (let x = Math.floor(left / cellSize); x <= Math.floor(right / cellSize); x++) {
      for (let y = Math.floor(top / cellSize); y <= Math.floor(bottom / cellSize); y++) {
        const key = x + ':' + y;
        const cell = cells.get(key) || []; cell.push(rect); cells.set(key, cell);
      }
    }
  }
  return {
    overlaps(rect: CursorRect): boolean {
      for (let x = Math.floor(rect.x / cellSize); x <= Math.floor((rect.x + rect.width) / cellSize); x++) {
        for (let y = Math.floor(rect.y / cellSize); y <= Math.floor((rect.y + rect.height) / cellSize); y++) {
          if (cells.get(x + ':' + y)?.some(obstacle => cursorRectsOverlap(rect, obstacle))) return true;
        }
      }
      return false;
    },
  };
}
export function cursorBadgeSize(name: string) {
  // DOM uses this exact width and clips long/wide glyphs with ellipsis.
  return { width: Math.min(110, Math.max(30, Array.from(name).length * 6 + 12)), height: 18 };
}
export function placeCursorBadge(point: Point, size: { width: number; height: number },
  viewport: CursorViewport, occupied: { overlaps: (rect: CursorRect) => boolean },
  reserved: CursorRect[] = [], preferred?: Point | null): CursorRect | null {
  const { width, height } = size;
  const valid = (rect: CursorRect) => rect.x >= 8 && rect.y >= 8 &&
    rect.x + width <= viewport.width - 8 && rect.y + height <= viewport.height - 8 &&
    !occupied.overlaps(rect) && !reserved.some(other => cursorRectsOverlap(padded(rect, 3), other));
  if (preferred) {
    const rect = { x: point.x + preferred.x, y: point.y + preferred.y, width, height };
    if (valid(rect)) return rect;
  }
  for (const gap of [10, 26, 42, 62]) {
    for (const [dx, dy] of [
      [gap, -height / 2], [-width - gap, -height / 2],
      [-width / 2, -height - gap], [-width / 2, gap],
      [gap, -height - gap], [-width - gap, -height - gap],
      [gap, gap], [-width - gap, gap],
    ]) {
      const rect = { x: point.x + dx, y: point.y + dy, width, height };
      if (valid(rect)) return rect;
    }
  }
  return null;
}
