import { describe, it, expect, vi } from 'vitest';
import { pdfToImages, exportPdfWithDrawings } from './pdf';

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn(() => ({ width: 800, height: 600 })),
        render: vi.fn(() => ({ promise: Promise.resolve() }))
      })
    })
  })),
  GlobalWorkerOptions: { workerSrc: '' }
}));

// Mock pdf.worker.min.mjs?url to resolve successfully
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'mock-worker-url'
}));

// Mock jspdf
vi.mock('jspdf', () => {
  const jsPDF = function() {
    return {
      addPage: vi.fn(),
      addImage: vi.fn(),
      save: vi.fn()
    };
  };
  return { jsPDF };
});

describe('pdf.ts', () => {
  it('pdfToImages processes PDF file', async () => {
    // Create a mock File object
    const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    
    // We need to mock HTMLCanvasElement for the test to work in jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      ellipse: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      strokeRect: vi.fn(),
    }) as any;

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mock');

    const result = await pdfToImages(file);
    
    expect(result.length).toBe(2);
    expect(result[0].src).toBe('data:image/jpeg;base64,mock');
    expect(result[0].width).toBe(800);
    expect(result[0].height).toBe(600);
  });
  
  it('exportPdfWithDrawings generates PDF', async () => {
    const mockElements = [
      { id: 'pdf-page-1', type: 'image', x: 0, y: 0, width: 800, height: 600, src: 'data:image/jpeg;base64,mock' },
      { id: 'drawing-1', type: 'drawing', points: [{x: 10, y: 10}, {x: 20, y: 20}], color: '#000', width: 4 },
      { id: 'sticky-1', type: 'sticky', x: 50, y: 50, width: 100, height: 100, text: 'Hello', color: '#ff0' }
    ];

    // Mock Image since jsdom might not handle loading Data URLs correctly in tests without real layout
    const originalImage = global.Image;
    global.Image = class {
      onload: any;
      src: string;
      constructor() {
        this.src = '';
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
    } as any;

    await exportPdfWithDrawings(mockElements, 'Test Board');
    
    // As long as it doesn't throw, it's mostly working.
    // The jspdf constructor and save method are mocked.
    global.Image = originalImage;
  });
});
