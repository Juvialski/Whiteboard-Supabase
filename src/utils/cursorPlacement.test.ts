import { describe, expect, it } from 'vitest';
import type { BoardElement } from '../types';
import { cursorBadgeSize, cursorElementBounds, cursorObstacleIndex, cursorRectsOverlap, cursorScreenPoint,
  cursorScreenRect, placeCursorBadge, pointsCursorBounds } from './cursorPlacement';
describe('smart cursor geometry', () => {
  it('uses the content pan/zoom transform exactly, including fractional coordinates', () => {
    expect(cursorScreenPoint({ x: 12.25, y: -10.5 }, { zoom: 2, panX: -7, panY: 40 }))
      .toEqual({ x: 17.5, y: 19 });
    expect(cursorScreenPoint({ x: 100, y: 200 }, { zoom: 0.25, panX: 10, panY: -20 }))
      .toEqual({ x: 35, y: 30 });
  });
  it('places names in nearby empty space instead of overlapping a question', () => {
    const question = { x: 200, y: 150, width: 180, height: 50 };
    const occupied = cursorObstacleIndex([question], { width: 800, height: 600 });
    const badge = placeCursorBadge({ x: 190, y: 170 }, cursorBadgeSize('Alice'), { width: 800, height: 600 }, occupied);
    expect(badge).not.toBeNull();
    expect(cursorRectsOverlap(badge!, question)).toBe(false);
    expect(badge!.x).toBeLessThan(190);
  });
  it('hides names when a full page occupies all nearby space', () => {
    const viewport = { width: 390, height: 740 };
    expect(placeCursorBadge({ x: 195, y: 300 }, cursorBadgeSize('Long collaborator name'), viewport,
      cursorObstacleIndex([{ x: 0, y: 0, ...viewport }], viewport))).toBeNull();
  });
  it('keeps desktop/mobile badge rectangles inside the viewport and avoids other badges', () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 500 }]) {
      const occupied = cursorObstacleIndex([], viewport);
      const badge = placeCursorBadge({ x: viewport.width - 3, y: 20 }, cursorBadgeSize('Teacher'), viewport, occupied);
      expect(badge).not.toBeNull();
      expect(badge!.x).toBeGreaterThanOrEqual(8);
      expect(badge!.x + badge!.width).toBeLessThanOrEqual(viewport.width - 8);
      const next = placeCursorBadge({ x: viewport.width - 5, y: 20 }, cursorBadgeSize('Student'), viewport, occupied, [badge!]);
      expect(next).not.toBeNull(); expect(cursorRectsOverlap(next!, badge!)).toBe(false);
    }
  });
  it('retains a safe orientation and relocates it when content moves into the badge', () => {
    const point = { x: 100, y: 100 }, viewport = { width: 400, height: 400 };
    const preferred = { x: -70, y: -9 };
    const first = placeCursorBadge(point, cursorBadgeSize('Alice'), viewport, cursorObstacleIndex([], viewport), [], preferred);
    expect(first!.x).toBe(30);
    const second = placeCursorBadge(point, cursorBadgeSize('Alice'), viewport, cursorObstacleIndex([first!], viewport), [], preferred);
    expect(second).not.toBeNull(); expect(cursorRectsOverlap(first!, second!)).toBe(false);
  });
  it('covers text, equations, images/PDF pages, shapes, and thick drawings', () => {
    for (const type of ['text', 'math', 'image', 'shape', 'sticky', 'table', 'stamp']) {
      const element = { id: type, type, x: 20, y: 40, width: 150, height: 100 } as BoardElement;
      expect(cursorElementBounds(element, new Map())).toEqual({ x: 20, y: 40, width: 150, height: 100 });
    }
    expect(pointsCursorBounds([{ x: 30, y: 50 }, { x: 90, y: 110 }], 10))
      .toEqual({ x: 25, y: 45, width: 70, height: 70 });
  });
  it('applies zoom/pan to occupied content and handles connector spans', () => {
    const from = { id: 'from', type: 'shape', x: 0, y: 0, width: 100, height: 100 } as BoardElement;
    const to = { id: 'to', type: 'shape', x: 300, y: 0, width: 100, height: 100 } as BoardElement;
    const connection = { id: 'line', type: 'connector', fromId: 'from', toId: 'to', fromSocket: 'right', toSocket: 'left' } as BoardElement;
    const bounds = cursorElementBounds(connection, new Map([[from.id, from], [to.id, to]]));
    expect(bounds!.x).toBeLessThanOrEqual(100); expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(300);
    expect(cursorScreenRect({ x: 20, y: 40, width: 150, height: 100 }, { zoom: 2, panX: -10, panY: 10 }))
      .toEqual({ x: 30, y: 90, width: 300, height: 200 });
  });
  it('limits wide or long badge names and ignores offscreen obstacles', () => {
    expect(cursorBadgeSize('文'.repeat(100)).width).toBe(110);
    const index = cursorObstacleIndex([{ x: -100000, y: -100000, width: 20, height: 20 }], { width: 390, height: 800 });
    expect(index.overlaps({ x: 20, y: 20, width: 60, height: 18 })).toBe(false);
  });
});
