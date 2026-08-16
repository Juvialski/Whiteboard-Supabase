import { describe, it, expect } from 'vitest';
import { recognizeShape, pathLength, distance, getBoundingBox } from './shapeRecognition';
import { Point } from '../types';

describe('shapeRecognition', () => {
  it('calculates distance and path length accurately', () => {
    const p1: Point = { x: 0, y: 0 };
    const p2: Point = { x: 3, y: 4 };
    expect(distance(p1, p2)).toBe(5);
    expect(pathLength([p1, p2, { x: 3, y: 8 }])).toBe(9);
  });

  it('recognizes straight lines', () => {
    const points: Point[] = [
      { x: 10, y: 10 },
      { x: 30, y: 11 },
      { x: 50, y: 10 },
      { x: 70, y: 12 },
      { x: 90, y: 10 },
      { x: 110, y: 10 },
    ];
    const shape = recognizeShape(points);
    expect(shape).not.toBeNull();
    expect(shape?.type).toBe('line');
  });

  it('recognizes approximate circles', () => {
    const points: Point[] = [];
    const cx = 100, cy = 100, r = 50;
    for (let angle = 0; angle <= 360; angle += 15) {
      const rad = (angle * Math.PI) / 180;
      points.push({
        x: cx + r * Math.cos(rad) + (Math.random() * 2 - 1),
        y: cy + r * Math.sin(rad) + (Math.random() * 2 - 1),
      });
    }
    const shape = recognizeShape(points);
    expect(shape).not.toBeNull();
    expect(shape?.type).toBe('circle');
  });

  it('recognizes approximate rectangles', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 2 },
      { x: 100, y: 60 },
      { x: 0, y: 58 },
      { x: 2, y: 2 },
    ];
    const shape = recognizeShape(points);
    expect(shape).not.toBeNull();
    expect(shape?.type).toBe('rect');
  });

  it('returns null for very short or irregular strokes', () => {
    expect(recognizeShape([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });
});
