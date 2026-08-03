import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function pdfToImages(file: File): Promise<{ src: string, width: number, height: number }[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const images = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    // Standard viewport at 1.0 scale
    const originalViewport = page.getViewport({ scale: 1.0 });
    
    // Determine scale to keep max dimension reasonable for Supabase (e.g., 1200px)
    const maxDim = 1200;
    const currentMax = Math.max(originalViewport.width, originalViewport.height);
    const scale = currentMax > maxDim ? maxDim / currentMax : 1.5; // Up-res slightly if small, or cap at maxDim
    
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // @ts-ignore
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;

      
      const src = canvas.toDataURL('image/jpeg', 0.6); // heavily compressed JPEG
      images.push({
        src,
        width: viewport.width,
        height: viewport.height
      });
    }
  }
  
  return images;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + " ";
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

export async function exportPdfWithDrawings(
  elements: any[],
  boardName: string
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  
  const pdfPages = elements.filter(el => typeof el?.id === "string" && el.id.startsWith("pdf-page-"));
  if (pdfPages.length === 0) {
    throw new Error("No PDF pages found on this board.");
  }

  // Sort pages
  pdfPages.sort((a, b) => {
    const partsA = a.id.split("-");
    const partsB = b.id.split("-");
    const indexA = parseInt(partsA[2]);
    const indexB = parseInt(partsB[2]);
    if (!isNaN(indexA) && !isNaN(indexB)) {
      return indexA - indexB;
    }
    if (Math.abs(a.y - b.y) > 10) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  let doc: any = null;

  for (let i = 0; i < pdfPages.length; i++) {
    const pdfPage = pdfPages[i];
    
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = pdfPage.width;
    canvas.height = pdfPage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Draw background
    try {
      const bgImg = await loadImage(pdfPage.src);
      ctx.drawImage(bgImg, 0, 0, pdfPage.width, pdfPage.height);
    } catch (err) {
      console.error("Failed to load PDF page background:", err);
      // Fallback: draw white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pdfPage.width, pdfPage.height);
    }

    // Draw other elements on top of this page
    ctx.save();
    // Clip to page bounds
    ctx.beginPath();
    ctx.rect(0, 0, pdfPage.width, pdfPage.height);
    ctx.clip();

    // Sort drawings and shapes by zIndex
    const sortedElements = [...elements]
      .filter(el => typeof el?.id === "string" && !el.id.startsWith("pdf-page-"))
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    sortedElements.forEach((el) => {
      if (el.type === "drawing") {
        const pts = el.points;
        if (!pts || pts.length === 0) return;
        
        ctx.beginPath();
        ctx.strokeStyle = el.color || "#1e293b";
        ctx.lineWidth = el.width || 4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        
        ctx.moveTo(pts[0].x - pdfPage.x, pts[0].y - pdfPage.y);
        for (let j = 1; j < pts.length; j++) {
          ctx.lineTo(pts[j].x - pdfPage.x, pts[j].y - pdfPage.y);
        }
        ctx.stroke();
      } else if (el.type === "sticky") {
        const rx = el.x - pdfPage.x;
        const ry = el.y - pdfPage.y;
        const rw = el.width || 120;
        const rh = el.height || 120;
        
        ctx.save();
        ctx.fillStyle = el.color || "#fef08a";
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(rx, ry, rw, rh, 8);
        } else {
          ctx.rect(rx, ry, rw, rh);
        }
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
        ctx.stroke();
        
        ctx.fillStyle = el.textColor || "#1e293b";
        ctx.font = "bold 14px sans-serif";
        ctx.textBaseline = "top";
        wrapText(ctx, el.text || "", rx + 12, ry + 12, rw - 24, 18);
        ctx.restore();
      } else if (el.type === "text") {
        const rx = el.x - pdfPage.x;
        const ry = el.y - pdfPage.y;
        
        ctx.save();
        ctx.fillStyle = el.color || "#1e293b";
        ctx.font = `${el.fontSize || 16}px sans-serif`;
        ctx.textBaseline = "top";
        wrapText(ctx, el.text || "", rx, ry, el.width || 200, (el.fontSize || 16) * 1.25);
        ctx.restore();
      } else if (el.type === "shape") {
        const rx = el.x - pdfPage.x;
        const ry = el.y - pdfPage.y;
        const rw = el.width || 100;
        const rh = el.height || 100;
        
        ctx.save();
        ctx.fillStyle = el.color || "transparent";
        ctx.strokeStyle = el.borderColor || "#1e293b";
        ctx.lineWidth = 3;
        
        if (el.shapeType === "rect") {
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (el.shapeType === "circle") {
          ctx.beginPath();
          ctx.ellipse(rx + rw/2, ry + rh/2, rw/2, rh/2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (el.shapeType === "diamond") {
          ctx.beginPath();
          ctx.moveTo(rx + rw/2, ry);
          ctx.lineTo(rx + rw, ry + rh/2);
          ctx.lineTo(rx + rw/2, ry + rh);
          ctx.lineTo(rx, ry + rh/2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (el.shapeType === "triangle") {
          ctx.beginPath();
          ctx.moveTo(rx + rw/2, ry);
          ctx.lineTo(rx + rw, ry + rh);
          ctx.lineTo(rx, ry + rh);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
        
        if (el.text) {
          ctx.fillStyle = el.textColor || "#1e293b";
          ctx.font = "14px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(el.text, rx + rw/2, ry + rh/2);
        }
        ctx.restore();
      }
    });

    ctx.restore();

    // Get image data
    const imgData = canvas.toDataURL('image/jpeg', 0.9);
    
    // Setup PDF
    const orientation = pdfPage.width > pdfPage.height ? 'l' : 'p';
    if (!doc) {
      doc = new jsPDF({
        orientation,
        unit: 'px',
        format: [pdfPage.width, pdfPage.height]
      });
    } else {
      doc.addPage([pdfPage.width, pdfPage.height], orientation);
    }
    
    doc.addImage(imgData, 'JPEG', 0, 0, pdfPage.width, pdfPage.height);
  }

  if (doc) {
    const filename = boardName.replace(/^PDF:\s*/i, "").trim() || "board_export";
    doc.save(`${filename}_annotated.pdf`);
  }
}
