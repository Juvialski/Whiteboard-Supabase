import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BoardElement, ImageElement } from '../types';
import { renderBoardRegionToCanvas } from './boardExport';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MAX_PDF_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
const MAX_RENDERED_PAGE_DIMENSION = 1200;
const MAX_RENDER_SCALE = 1.5;

export async function pdfToImages(file: File): Promise<{ src: string, width: number, height: number }[]> {
  const looksLikePdf = file instanceof File
    && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!looksLikePdf) throw new Error('Please choose a valid PDF file.');
  if (file.size <= 0) throw new Error('The selected PDF is empty.');
  if (file.size > MAX_PDF_FILE_BYTES) {
    throw new Error(`This PDF exceeds the ${Math.round(MAX_PDF_FILE_BYTES / 1024 / 1024)} MB upload limit.`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;

  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`This PDF has ${pdf.numPages} pages. The maximum supported board size is ${MAX_PDF_PAGES} pages.`);
    }

    const images: { src: string; width: number; height: number }[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const originalViewport = page.getViewport({ scale: 1 });
        const currentMax = Math.max(originalViewport.width, originalViewport.height, 1);
        const scale = Math.min(MAX_RENDER_SCALE, MAX_RENDERED_PAGE_DIMENSION / currentMax);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error(`Unable to prepare PDF page ${pageNumber}.`);

        await page.render({
          canvasContext: context,
          viewport,
        } as any).promise;

        images.push({
          src: canvas.toDataURL('image/jpeg', 0.72),
          width: canvas.width,
          height: canvas.height,
        });

        // Release the backing pixel buffer as soon as the compressed page has
        // been copied into the result. This matters for large multi-page PDFs.
        canvas.width = 1;
        canvas.height = 1;
      } finally {
        page.cleanup?.();
      }
    }

    return images;
  } finally {
    try {
      if (pdf) await (pdf as any).destroy?.();
      else await (loadingTask as any).destroy?.();
    } catch { /* best-effort PDF.js cleanup */ }
  }
}

export async function exportPdfWithDrawings(
  elements: BoardElement[],
  boardName: string,
  boardId: string = ''
): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const pdfPages = elements
    .filter((element): element is ImageElement =>
      element.type === 'image' && typeof element.id === 'string' && element.id.startsWith('pdf-page-')
    )
    .sort((a, b) => {
      const indexA = Number.parseInt(a.id.split('-')[2] || '', 10);
      const indexB = Number.parseInt(b.id.split('-')[2] || '', 10);
      if (Number.isFinite(indexA) && Number.isFinite(indexB) && indexA !== indexB) return indexA - indexB;
      if (Math.abs(a.y - b.y) > 10) return a.y - b.y;
      return a.x - b.x;
    });

  if (!pdfPages.length) throw new Error('No PDF pages found on this board.');

  let document: InstanceType<typeof jsPDF> | null = null;
  const pdfPageIds = new Set(pdfPages.map((page) => page.id));

  for (const pdfPage of pdfPages) {
    // Exclude other PDF backgrounds and force the current page beneath annotations.
    const pageElements = elements
      .filter((element) => !pdfPageIds.has(element.id) || element.id === pdfPage.id)
      .map((element) => element.id === pdfPage.id ? { ...element, zIndex: -1_000_000 } as BoardElement : element);

    const { canvas } = await renderBoardRegionToCanvas(
      pageElements,
      boardId,
      { x: pdfPage.x, y: pdfPage.y, width: pdfPage.width, height: pdfPage.height },
      {
        background: '#ffffff',
        padding: 0,
        maxDimension: 4096,
        maxPixels: 16_000_000,
      }
    );

    const orientation = pdfPage.width > pdfPage.height ? 'landscape' : 'portrait';
    if (!document) {
      document = new jsPDF({
        orientation,
        unit: 'px',
        format: [pdfPage.width, pdfPage.height],
        compress: true,
      });
    } else {
      document.addPage([pdfPage.width, pdfPage.height], orientation);
    }

    try {
      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      document.addImage(imageData, 'JPEG', 0, 0, pdfPage.width, pdfPage.height, undefined, 'FAST');
    } finally {
      // jsPDF has copied the encoded page; release the browser pixel buffer before
      // rendering the next page to keep long PDF exports bounded.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  if (!document) throw new Error('No PDF pages could be rendered.');
  const filename = boardName.replace(/^PDF:\s*/i, '').trim().replace(/[^a-z0-9_-]+/gi, '_') || 'board_export';
  document.save(`${filename}_annotated.pdf`);
}
