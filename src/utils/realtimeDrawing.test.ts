import { describe, expect, it } from 'vitest';
import { MAX_REALTIME_DRAWING_POINTS, sampleRealtimeDrawingPoints } from './realtimeDrawing';

describe('sampleRealtimeDrawingPoints', () => {
  it('copies short strokes without changing their coordinates', () => {
    const input = [{ x: 0, y: 1 }, { x: 2, y: 3 }];
    const result = sampleRealtimeDrawingPoints(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('caps long strokes while retaining both endpoints', () => {
    const input = Array.from({ length: 5000 }, (_, index) => ({ x: index, y: index * 2 }));
    const result = sampleRealtimeDrawingPoints(input);
    expect(result).toHaveLength(MAX_REALTIME_DRAWING_POINTS);
    expect(result[0]).toEqual(input[0]);
    expect(result[result.length - 1]).toEqual(input[input.length - 1]);
  });

  it('samples across the entire path rather than only taking its beginning', () => {
    const input = Array.from({ length: 101 }, (_, index) => ({ x: index, y: 0 }));
    const result = sampleRealtimeDrawingPoints(input, 6);
    expect(result.map((point) => point.x)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});
