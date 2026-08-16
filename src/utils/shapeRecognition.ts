import { Point, ShapeType } from '../types';

export interface RecognizedShape {
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: Point[];
}

export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += distance(points[i - 1], points[i]);
  }
  return len;
}

export function getBoundingBox(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number; cx: number; cy: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { minX, minY, maxX, maxY, width, height, cx: minX + width / 2, cy: minY + height / 2 };
}

export function recognizeShape(points: Point[]): RecognizedShape | null {
  if (!points || points.length < 5) return null;

  const totalLen = pathLength(points);
  if (totalLen < 20) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const startEndDist = distance(first, last);
  const bbox = getBoundingBox(points);
  const isClosed = startEndDist < Math.max(35, totalLen * 0.25);

  // Straight line
  if (!isClosed && (startEndDist / totalLen) > 0.88) {
    return {
      type: 'line',
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      width: Math.max(20, Math.abs(last.x - first.x)),
      height: Math.max(20, Math.abs(last.y - first.y)),
      points: [first, last],
    };
  }

  // Closed shapes: circle or rectangle
  if (isClosed) {
    const { cx, cy } = bbox;
    const avgRadius = (bbox.width + bbox.height) / 4;
    let radiusDiffSum = 0;
    const samples = Math.min(24, points.length);
    const step = Math.max(1, Math.floor(points.length / samples));

    for (let i = 0; i < points.length; i += step) {
      const d = distance(points[i], { x: cx, y: cy });
      radiusDiffSum += Math.abs(d - avgRadius);
    }
    const avgRadiusDiff = radiusDiffSum / (points.length / step);
    const aspectRatio = bbox.width / bbox.height;

    if (aspectRatio >= 0.65 && aspectRatio <= 1.55 && (avgRadiusDiff / avgRadius) < 0.32) {
      const size = Math.max(bbox.width, bbox.height);
      return {
        type: 'circle',
        x: cx - size / 2,
        y: cy - size / 2,
        width: size,
        height: size,
      };
    }

    return {
      type: 'rect',
      x: bbox.minX,
      y: bbox.minY,
      width: bbox.width,
      height: bbox.height,
    };
  }

  return null;
}
