import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardElement } from '../types';

const pdfMocks = vi.hoisted(() => ({
  numPages: 2,
  cleanup: vi.fn(),
  documentDestroy: vi.fn(async () => undefined),
  loadingDestroy: vi.fn(async () => undefined),
  render: vi.fn(() => ({ promise: Promise.resolve() })),
}));

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    destroy: pdfMocks.loadingDestroy,
    promise: Promise.resolve({
      get numPages() { return pdfMocks.numPages; },
      destroy: pdfMocks.documentDestroy,
      getPage: vi.fn().mockImplementation(async () => ({
        cleanup: pdfMocks.cleanup,
        getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 800 * scale, height: 600 * scale })),
        render: pdfMocks.render,
      })),
    }),
  })),
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker-url' }));

vi.mock('jspdf', () => {
  const jsPDF = function() {
    return { addPage: vi.fn(), addImage: vi.fn(), save: vi.fn() };
  };
  return { jsPDF };
});

import {
  calculateNextPdfPagePositions,
  calculatePdfPageReflowPositions,
  exportPdfWithDrawings,
  MAX_PDF_FILE_BYTES,
  MAX_PDF_PAGES,
  pdfToImages,
} from './pdf';

describe('pdf utilities', () => {
  beforeEach(() => {
    pdfMocks.numPages = 2;
    pdfMocks.cleanup.mockClear();
    pdfMocks.documentDestroy.mockClear();
    pdfMocks.loadingDestroy.mockClear();
    pdfMocks.render.mockClear();

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 10 })),
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(), ellipse: vi.fn(), closePath: vi.fn(), fill: vi.fn(), strokeRect: vi.fn(),
      scale: vi.fn(), translate: vi.fn(), setLineDash: vi.fn(), arc: vi.fn(), quadraticCurveTo: vi.fn(), bezierCurveTo: vi.fn(),
    }) as any;
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mock');
  });

  it('renders pages with a high-definition scale and releases PDF resources', async () => {
    const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    const result = await pdfToImages(file);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      src: 'data:image/jpeg;base64,mock',
      width: 2000,
      height: 1500,
    });
    expect(pdfMocks.cleanup).toHaveBeenCalledTimes(2);
    expect(pdfMocks.documentDestroy).toHaveBeenCalledTimes(1);
  });

  it('calculates aligned coordinates when appending new PDF pages to existing pages', () => {
    const existingPages: any[] = [
      { id: 'pdf-page-0-1', type: 'image', x: 0, y: 0, width: 800, height: 1000 },
      { id: 'pdf-page-1-2', type: 'image', x: 0, y: 1040, width: 800, height: 1000 },
    ];
    const newPages = [
      { width: 800, height: 1000 },
      { width: 800, height: 1000 },
    ];

    const positions = calculateNextPdfPagePositions(existingPages, newPages, 40);
    expect(positions).toEqual([
      { x: 0, y: 2080 },
      { x: 0, y: 3120 },
    ]);
  });

  it('compacts remaining vertical pages after a page is removed', () => {
    const pages: any[] = [
      { id: 'pdf-page-0-1', type: 'image', x: 0, y: 0, width: 800, height: 1000 },
      { id: 'pdf-page-2-3', type: 'image', x: 0, y: 2080, width: 800, height: 1000 },
    ];

    expect(calculatePdfPageReflowPositions(pages, 40)).toEqual([
      { pageId: 'pdf-page-0-1', x: 0, y: 0, deltaX: 0, deltaY: 0 },
      { pageId: 'pdf-page-2-3', x: 0, y: 1040, deltaX: 0, deltaY: -1040 },
    ]);
  });

  it('compacts remaining horizontal pages after a page is removed', () => {
    const pages: any[] = [
      { id: 'pdf-page-0-1', type: 'image', x: 100, y: 200, width: 800, height: 1000 },
      { id: 'pdf-page-2-3', type: 'image', x: 1940, y: 200, width: 800, height: 1000 },
    ];

    expect(calculatePdfPageReflowPositions(pages, 40)).toEqual([
      { pageId: 'pdf-page-0-1', x: 100, y: 200, deltaX: 0, deltaY: 0 },
      { pageId: 'pdf-page-2-3', x: 940, y: 200, deltaX: -1000, deltaY: 0 },
    ]);
  });

  it('rejects oversized and excessive-page PDFs before allocating every page', async () => {
    const oversized = new File(['x'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: MAX_PDF_FILE_BYTES + 1 });
    await expect(pdfToImages(oversized)).rejects.toThrow(/upload limit/i);

    pdfMocks.numPages = MAX_PDF_PAGES + 1;
    const tooManyPages = new File(['x'], 'pages.pdf', { type: 'application/pdf' });
    await expect(pdfToImages(tooManyPages)).rejects.toThrow(/maximum supported board size/i);
    expect(pdfMocks.documentDestroy).toHaveBeenCalledTimes(1);
  });

  it('exports an annotated PDF board', async () => {
    const mockElements: BoardElement[] = [
      { id: 'pdf-page-1', type: 'image', x: 0, y: 0, width: 800, height: 600, src: 'data:image/jpeg;base64,mock', zIndex: 0 },
      { id: 'drawing-1', type: 'drawing', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#000', width: 4, isHighlighter: false, zIndex: 1 },
      { id: 'sticky-1', type: 'sticky', x: 50, y: 50, width: 100, height: 100, text: 'Hello', color: '#ff0', zIndex: 2 },
    ];

    const originalImage = global.Image;
    global.Image = class {
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    } as any;

    try {
      await expect(exportPdfWithDrawings(mockElements, 'Test Board')).resolves.toBeUndefined();
    } finally {
      global.Image = originalImage;
    }
  });
});
