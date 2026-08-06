import type { Point } from '../types';

export const MAX_REALTIME_DRAWING_POINTS = 900;

/**
 * Keep a live stroke small enough for the authenticated WebSocket relay without
 * changing the final persisted drawing. The first and last points are always
 * retained and the intermediate samples are distributed across the full path.
 */
export function sampleRealtimeDrawingPoints(
  points: readonly Point[],
  maxPoints: number = MAX_REALTIME_DRAWING_POINTS
): Point[] {
  if (!Number.isFinite(maxPoints) || maxPoints < 2) {
    throw new Error('maxPoints must be at least 2.');
  }
  const limit = Math.floor(maxPoints);
  if (points.length <= limit) return points.map((point) => ({ x: point.x, y: point.y }));

  const lastIndex = points.length - 1;
  const sampled: Point[] = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    const point = points[sourceIndex];
    sampled.push({ x: point.x, y: point.y });
  }
  return sampled;
}
