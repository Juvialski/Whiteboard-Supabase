import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardElement, ShapeElement, TextElement } from '../types';
import { getBoardExportBounds, renderBoardRegionToCanvas } from './boardExport';

function createContext() {
  return {
    fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(), fill: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(), arc: vi.fn(), ellipse: vi.fn(), setLineDash: vi.fn(),
    fillText: vi.fn(), measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
  } as unknown as CanvasRenderingContext2D;
}

describe('board export rendering', () => {
  let context: CanvasRenderingContext2D;

  beforeEach(() => {
    context = createContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => context) as any;
  });

  it('computes bounds for drawings and positioned elements', () => {
    const elements: BoardElement[] = [
      { id: 'drawing', type: 'drawing', points: [{ x: -10, y: 5 }, { x: 20, y: 30 }], color: '#000', width: 4, isHighlighter: false, zIndex: 1 },
      { id: 'text', type: 'text', x: 100, y: 100, width: 200, height: 60, text: 'Hello', color: '#000', fontSize: 16, zIndex: 2 },
    ];

    expect(getBoardExportBounds(elements, 0)).toEqual({ x: -14, y: 1, width: 314, height: 159 });
  });

  it('renders explicit, inequality, implicit, and alternate graph grids without eval', async () => {
    const graph: ShapeElement = {
      id: 'graph', type: 'shape', shapeType: 'advanced-cartesian', x: 0, y: 0, width: 320, height: 240,
      text: '', color: '#ffffff', borderColor: '#334155', zIndex: 1, cartesianRange: 5,
      cartesianGridMode: 'polar',
      equations: [
        { id: 'explicit', expr: 'y=2x+1', color: '#2563eb' },
        { id: 'inequality', expr: String.raw`y \leq x^2`, color: '#dc2626' },
        { id: 'implicit', expr: 'x^2+y^2=4', color: '#16a34a' },
      ],
    };

    await renderBoardRegionToCanvas([graph], 'board-1', { x: 0, y: 0, width: 320, height: 240 });
    expect(context.ellipse).toHaveBeenCalled();
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();

    graph.cartesianGridMode = 'isometric';
    await expect(renderBoardRegionToCanvas([graph], 'board-1', { x: 0, y: 0, width: 320, height: 240 })).resolves.toBeDefined();
  });

  it('preserves text underline and strike-through decorations', async () => {
    const text: TextElement = {
      id: 'text', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'Decorated', color: '#111827',
      fontSize: 18, textDecoration: 'underline', zIndex: 1,
    };
    await renderBoardRegionToCanvas([text], 'board-1', { x: 0, y: 0, width: 200, height: 80 });
    expect(context.fillText).toHaveBeenCalledWith('Decorated', 4, 4);
    expect(context.stroke).toHaveBeenCalled();
  });
});
