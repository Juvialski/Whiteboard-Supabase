import { BoardElement, Point } from "../types";

export interface CompressedImage {
  base64Str: string;
  width: number;
  height: number;
  mimeType: string;
}

// Client-side image compression utility to handle high volumes of pasted images safely
// within Supabase documents without needing Supabase Storage.
export const compressImage = (file: File): Promise<CompressedImage | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Downscale to max 1600px on any dimension to minimize storage footprint while retaining pristine sharpness
        const MAX_DIM = 1600;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Output as high-quality JPEG (balanced visually and file size-wise)
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64Str: compressedBase64, width, height, mimeType: "image/jpeg" });
      };
      img.onerror = () => resolve(null);
      img.src = event.target?.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

// Helper to sanitize objects for Supabase (removes undefined fields)
export function sanitizeForSupabase(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForSupabase);
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      clean[key] = sanitizeForSupabase(val);
    }
  }
  return clean;
}

// Helper to convert drawing points into a smooth SVG path (Quadratic Bezier)
export function getSvgPathFromPoints(points: Point[]): string {
  if (!points || points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const cp = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    d += ` Q ${points[i].x} ${points[i].y} ${cp.x} ${cp.y}`;
  }
  d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  return d;
}

// Helpers for smart connection lines / connectors between shapes
export function getElementSocketCoords(el: BoardElement, socket: "top" | "right" | "bottom" | "left"): Point {
  const bounded = el as any;
  const w = bounded.width || 150;
  const h = bounded.height || 150;
  switch (socket) {
    case "top":
      return { x: bounded.x + w / 2, y: bounded.y };
    case "right":
      return { x: bounded.x + w, y: bounded.y + h / 2 };
    case "bottom":
      return { x: bounded.x + w / 2, y: bounded.y + h };
    case "left":
      return { x: bounded.x, y: bounded.y + h / 2 };
  }
}

export function getConnectorPath(start: Point, end: Point, fromSocket: string, toSocket?: string): string {
  if (!toSocket) {
    // Smooth Bezier path to user mouse/cursor during dragging
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let cp1 = { x: start.x, y: start.y };
    const strength = Math.min(100, Math.max(30, Math.hypot(dx, dy) * 0.3));
    switch (fromSocket) {
      case "top": cp1.y -= strength; break;
      case "right": cp1.x += strength; break;
      case "bottom": cp1.y += strength; break;
      case "left": cp1.x -= strength; break;
    }
    return `M ${start.x} ${start.y} Q ${cp1.x} ${cp1.y} ${end.x} ${end.y}`;
  }
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let cp1 = { x: start.x, y: start.y };
  let cp2 = { x: end.x, y: end.y };
  
  const strength = Math.min(100, Math.max(30, Math.hypot(dx, dy) * 0.3));
  
  switch (fromSocket) {
    case "top": cp1.y -= strength; break;
    case "right": cp1.x += strength; break;
    case "bottom": cp1.y += strength; break;
    case "left": cp1.x -= strength; break;
  }
  
  switch (toSocket) {
    case "top": cp2.y -= strength; break;
    case "right": cp2.x += strength; break;
    case "bottom": cp2.y += strength; break;
    case "left": cp2.x -= strength; break;
  }
  
  return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
}

// High-performance point simplification/downsampling to shrink stroke coordinate sizes
export function simplifyPoints(points: Point[], tolerance: number = 1.0): Point[] {
  if (points.length <= 2) return points;
  
  const result: Point[] = [points[0]];
  let lastPoint = points[0];
  
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dx = p.x - lastPoint.x;
    const dy = p.y - lastPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > tolerance) {
      result.push(p);
      lastPoint = p;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
