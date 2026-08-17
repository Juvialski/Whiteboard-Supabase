import type {
  BoardElement,
  ConnectorElement,
  Point,
  ShapeElement,
  TableElement,
  TextElement,
} from '../types';
import { normalizeImageRotation } from '../types';
import {
  getBoardAsset,
  releaseBoardAsset,
  retainBoardAsset,
} from '../services/storageService';
import { evaluateSafeMathExpression, parseGraphRelation } from './mathExpression';

export interface ExportRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderBoardOptions {
  background?: string;
  padding?: number;
  maxDimension?: number;
  maxPixels?: number;
  excludeElementIds?: Set<string>;
}

const DEFAULT_ELEMENT_SIZE = { width: 140, height: 80 };
const AUDIO_SIZE = { width: 280, height: 72 };
const EXPORT_MAX_DIMENSION = 8192;
const EXPORT_MAX_PIXELS = 32_000_000;

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function elementRect(element: BoardElement, allElements: BoardElement[]): ExportRegion | null {
  if (element.type === 'drawing') {
    if (!element.points.length) return null;
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    const padding = Math.max(2, element.width || 2);
    return {
      x: Math.min(...xs) - padding,
      y: Math.min(...ys) - padding,
      width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2),
    };
  }

  if (element.type === 'connector') {
    const startElement = allElements.find((candidate) => candidate.id === element.fromId);
    if (!startElement) return null;
    const start = getElementSocket(startElement, element.fromSocket);
    const endElement = element.toId ? allElements.find((candidate) => candidate.id === element.toId) : null;
    const end = endElement
      ? getElementSocket(endElement, element.toSocket || 'top')
      : element.endPoint || start;
    const padding = Math.max(6, element.strokeWidth || 2);
    return {
      x: Math.min(start.x, end.x) - padding,
      y: Math.min(start.y, end.y) - padding,
      width: Math.abs(end.x - start.x) + padding * 2,
      height: Math.abs(end.y - start.y) + padding * 2,
    };
  }

  if ('x' in element && 'y' in element) {
    const width = element.type === 'audio'
      ? AUDIO_SIZE.width
      : Math.max(1, finite((element as any).width, DEFAULT_ELEMENT_SIZE.width));
    const height = element.type === 'audio'
      ? AUDIO_SIZE.height
      : Math.max(1, finite((element as any).height, DEFAULT_ELEMENT_SIZE.height));
    return { x: finite(element.x), y: finite(element.y), width, height };
  }

  return null;
}

export function getBoardExportBounds(elements: BoardElement[], padding = 50): ExportRegion {
  const rectangles = elements
    .map((element) => elementRect(element, elements))
    .filter((region): region is ExportRegion => Boolean(region));

  if (!rectangles.length) return { x: 0, y: 0, width: 800, height: 600 };
  const minX = Math.min(...rectangles.map((rect) => rect.x));
  const minY = Math.min(...rectangles.map((rect) => rect.y));
  const maxX = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

function regionsIntersect(a: ExportRegion, b: ExportRegion): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fontFamily(element: TextElement): string {
  switch (element.fontFamily) {
    case 'serif': return 'Georgia, serif';
    case 'mono': return 'ui-monospace, SFMono-Regular, Menlo, monospace';
    case 'handwritten': return '"Comic Sans MS", cursive';
    case 'display': return 'Impact, sans-serif';
    default: return 'Arial, sans-serif';
  }
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const output: string[] = [];
  for (const paragraph of String(text || '').split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      output.push('');
      continue;
    }
    let line = words[0];
    for (let index = 1; index < words.length; index += 1) {
      const next = `${line} ${words[index]}`;
      if (context.measureText(next).width <= maxWidth) line = next;
      else {
        output.push(line);
        line = words[index];
      }
    }
    output.push(line);
  }
  return output;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxHeight = Number.POSITIVE_INFINITY,
  align: CanvasTextAlign = 'left',
  decoration: TextElement['textDecoration'] = 'none'
): void {
  const lines = wrapLines(context, text, Math.max(10, maxWidth));
  context.textAlign = align;
  const drawX = align === 'center' ? x + maxWidth / 2 : align === 'right' ? x + maxWidth : x;
  let currentY = y;
  for (const line of lines) {
    if (currentY + lineHeight > y + maxHeight) break;
    context.fillText(line, drawX, currentY);
    if (line && decoration && decoration !== 'none') {
      const measuredWidth = Math.min(maxWidth, context.measureText(line).width);
      const startX = align === 'center'
        ? drawX - measuredWidth / 2
        : align === 'right'
          ? drawX - measuredWidth
          : drawX;
      const decorationY = decoration === 'underline'
        ? currentY + lineHeight * 0.88
        : currentY + lineHeight * 0.48;
      context.save();
      context.beginPath();
      context.strokeStyle = typeof context.fillStyle === 'string' ? context.fillStyle : '#1e293b';
      context.lineWidth = Math.max(1, lineHeight / 18);
      context.moveTo(startX, decorationY);
      context.lineTo(startX + measuredWidth, decorationY);
      context.stroke();
      context.restore();
    }
    currentY += lineHeight;
  }
}

function getElementSocket(element: BoardElement, socket: 'top' | 'right' | 'bottom' | 'left'): Point {
  const rect = elementRect(element, []);
  if (!rect) return { x: 0, y: 0 };
  switch (socket) {
    case 'top': return { x: rect.x + rect.width / 2, y: rect.y };
    case 'right': return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case 'bottom': return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    default: return { x: rect.x, y: rect.y + rect.height / 2 };
  }
}

function drawPolygon(
  context: CanvasRenderingContext2D,
  points: Point[],
  fill: string,
  stroke: string,
  lineWidth: number
): void {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function regularPolygonPoints(x: number, y: number, width: number, height: number, sides: number, rotation = -Math.PI / 2): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + index * Math.PI * 2 / sides;
    return {
      x: x + width / 2 + Math.cos(angle) * width / 2,
      y: y + height / 2 + Math.sin(angle) * height / 2,
    };
  });
}

function evaluateImplicitGraphExpression(
  expression: string,
  x: number,
  y: number,
  variables: Record<string, number>
): number | null {
  const equalsIndex = expression.indexOf('=');
  if (equalsIndex <= 0 || equalsIndex >= expression.length - 1) return null;
  const left = evaluateSafeMathExpression(expression.slice(0, equalsIndex), { ...variables, x, y });
  const right = evaluateSafeMathExpression(expression.slice(equalsIndex + 1), { ...variables, x, y });
  if (left === null || right === null) return null;
  const difference = left - right;
  return Number.isFinite(difference) ? difference : null;
}

function interpolateZero(
  a: { x: number; y: number; value: number },
  b: { x: number; y: number; value: number }
): Point {
  const denominator = Math.abs(a.value) + Math.abs(b.value);
  const t = denominator > 1e-12 ? Math.abs(a.value) / denominator : 0.5;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function drawImplicitGraph(
  context: CanvasRenderingContext2D,
  expression: string,
  centerX: number,
  centerY: number,
  xScale: number,
  yScale: number,
  range: number,
  variables: Record<string, number>
): void {
  const steps = 72;
  const minX = -range;
  const maxX = range;
  const minY = -range;
  const maxY = range;
  const dx = (maxX - minX) / steps;
  const dy = (maxY - minY) / steps;
  const grid: Array<Array<number | null>> = Array.from({ length: steps + 1 }, () => Array(steps + 1).fill(null));

  for (let column = 0; column <= steps; column += 1) {
    const graphX = minX + column * dx;
    for (let row = 0; row <= steps; row += 1) {
      const graphY = minY + row * dy;
      grid[column][row] = evaluateImplicitGraphExpression(expression, graphX, graphY, variables);
    }
  }

  context.beginPath();
  for (let column = 0; column < steps; column += 1) {
    for (let row = 0; row < steps; row += 1) {
      const values = [
        grid[column][row],
        grid[column + 1][row],
        grid[column + 1][row + 1],
        grid[column][row + 1],
      ];
      if (values.some((value) => value === null)) continue;

      const x0 = minX + column * dx;
      const y0 = minY + row * dy;
      const corners = [
        { x: x0, y: y0, value: values[0] as number },
        { x: x0 + dx, y: y0, value: values[1] as number },
        { x: x0 + dx, y: y0 + dy, value: values[2] as number },
        { x: x0, y: y0 + dy, value: values[3] as number },
      ];
      const crossings: Point[] = [];
      const edgePairs: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0]];
      for (const [fromIndex, toIndex] of edgePairs) {
        const from = corners[fromIndex];
        const to = corners[toIndex];
        if ((from.value >= 0) !== (to.value >= 0)) crossings.push(interpolateZero(from, to));
      }

      if (crossings.length === 2) {
        context.moveTo(centerX + crossings[0].x * xScale, centerY - crossings[0].y * yScale);
        context.lineTo(centerX + crossings[1].x * xScale, centerY - crossings[1].y * yScale);
      } else if (crossings.length === 4) {
        // Saddle cells have two contour segments. Keeping both avoids dropping
        // branches from hyperbolas and other implicit relations during export.
        context.moveTo(centerX + crossings[0].x * xScale, centerY - crossings[0].y * yScale);
        context.lineTo(centerX + crossings[1].x * xScale, centerY - crossings[1].y * yScale);
        context.moveTo(centerX + crossings[2].x * xScale, centerY - crossings[2].y * yScale);
        context.lineTo(centerX + crossings[3].x * xScale, centerY - crossings[3].y * yScale);
      }
    }
  }
  context.stroke();
}

function drawCartesianGraph(context: CanvasRenderingContext2D, element: ShapeElement): void {
  const { x, y, width, height } = element;
  const range = Math.max(1, Math.min(100, element.cartesianRange || 10));
  const centerX = x + width / 2 + finite(element.graphPanX);
  const centerY = y + height / 2 + finite(element.graphPanY);
  const xScale = width / (range * 2);
  const yScale = height / (range * 2);

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = element.color || '#ffffff';
  context.fillRect(x, y, width, height);
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  const gridMode = element.cartesianGridMode || 'cartesian';
  if (gridMode === 'polar') {
    const maximumRadius = Math.hypot(width, height);
    const radialStep = Math.max(8, Math.min(xScale, yScale));
    for (let radius = radialStep; radius <= maximumRadius; radius += radialStep) {
      context.beginPath();
      context.ellipse(centerX, centerY, radius, radius * (yScale / Math.max(xScale, 1e-6)), 0, 0, Math.PI * 2);
      context.stroke();
    }
    for (let degrees = 0; degrees < 360; degrees += 30) {
      const angle = degrees * Math.PI / 180;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(
        centerX + Math.cos(angle) * maximumRadius,
        centerY - Math.sin(angle) * maximumRadius * (yScale / Math.max(xScale, 1e-6))
      );
      context.stroke();
    }
  } else if (gridMode === 'isometric') {
    const span = width + height;
    const spacing = Math.max(8, xScale * 2);
    for (let offset = -span; offset <= span; offset += spacing) {
      context.beginPath();
      context.moveTo(centerX + offset - height, y + height);
      context.lineTo(centerX + offset + height, y);
      context.stroke();
      context.beginPath();
      context.moveTo(centerX + offset - height, y);
      context.lineTo(centerX + offset + height, y + height);
      context.stroke();
    }
  } else {
    for (let value = -range; value <= range; value += 1) {
      const px = centerX + value * xScale;
      const py = centerY - value * yScale;
      context.beginPath();
      context.moveTo(px, y);
      context.lineTo(px, y + height);
      context.stroke();
      context.beginPath();
      context.moveTo(x, py);
      context.lineTo(x + width, py);
      context.stroke();
    }
  }
  context.strokeStyle = element.borderColor || '#334155';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, centerY);
  context.lineTo(x + width, centerY);
  context.moveTo(centerX, y);
  context.lineTo(centerX, y + height);
  context.stroke();

  const equations = element.equations?.length
    ? element.equations
    : [element.equation, element.equation2, element.equation3]
      .filter((value): value is string => Boolean(value))
      .map((expr, index) => ({ id: String(index), expr, color: ['#2563eb', '#dc2626', '#16a34a'][index] }));

  const graphVariables: Record<string, number> = {};
  for (const [name, config] of Object.entries(element.cartesianVariables || {})) {
    if (config && Number.isFinite(config.val)) graphVariables[name] = config.val;
  }

  for (const equation of equations) {
    const parsed = parseGraphRelation(equation.expr);
    const expression = parsed.cleanExpr;
    const color = equation.color || '#2563eb';
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash(parsed.isStrict ? [6, 4] : []);

    const isImplicit = !parsed.isInequality
      && expression.includes('=')
      && /\bx\b/i.test(expression)
      && /\by\b/i.test(expression);
    if (isImplicit) {
      drawImplicitGraph(context, expression, centerX, centerY, xScale, yScale, range, graphVariables);
      context.setLineDash([]);
      continue;
    }

    const samples: Array<{ px: number; py: number } | null> = [];
    for (let pixel = 0; pixel <= width; pixel += 2) {
      const graphX = (pixel - (centerX - x)) / xScale;
      const graphY = evaluateSafeMathExpression(expression, { ...graphVariables, x: graphX });
      if (graphY == null) {
        samples.push(null);
        continue;
      }
      const px = x + pixel;
      const py = centerY - graphY * yScale;
      samples.push(Number.isFinite(py) && py >= y - height && py <= y + height * 2 ? { px, py } : null);
    }

    if (parsed.isInequality && parsed.op) {
      context.save();
      context.globalAlpha = 0.18;
      context.fillStyle = color;
      const boundaryY = parsed.op === '<' || parsed.op === '<=' ? y + height : y;
      for (const sample of samples) {
        if (!sample) continue;
        const top = Math.max(y, Math.min(sample.py, boundaryY));
        const bottom = Math.min(y + height, Math.max(sample.py, boundaryY));
        if (bottom > top) context.fillRect(sample.px, top, 2.5, bottom - top);
      }
      context.restore();
    }

    context.beginPath();
    let started = false;
    for (const sample of samples) {
      if (!sample) {
        started = false;
        continue;
      }
      if (!started) {
        context.moveTo(sample.px, sample.py);
        started = true;
      } else {
        context.lineTo(sample.px, sample.py);
      }
    }
    context.stroke();
    context.setLineDash([]);
  }

  for (const point of element.cartesianTablePoints || []) {
    context.fillStyle = '#dc2626';
    context.beginPath();
    context.arc(centerX + point.x * xScale, centerY - point.y * yScale, 3, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawShape(context: CanvasRenderingContext2D, element: ShapeElement): void {
  const { x, y, width, height } = element;
  const fill = element.color || '#dbeafe';
  const stroke = element.borderColor || '#3b82f6';
  context.save();
  context.lineWidth = 2;

  if (element.shapeType === 'cartesian' || element.shapeType === 'advanced-cartesian') {
    drawCartesianGraph(context, element);
  } else if (element.shapeType === 'numberline') {
    context.fillStyle = fill;
    context.fillRect(x, y, width, height);
    const cy = y + height / 2;
    context.strokeStyle = stroke;
    context.beginPath();
    context.moveTo(x + 12, cy);
    context.lineTo(x + width - 12, cy);
    context.stroke();
    const range = Math.max(1, Math.min(50, element.cartesianRange || 10));
    context.font = '10px Arial';
    context.textAlign = 'center';
    context.fillStyle = element.textColor || '#334155';
    for (let value = -range; value <= range; value += 1) {
      const px = x + width / 2 + value * ((width - 24) / (range * 2));
      context.beginPath();
      context.moveTo(px, cy - 5);
      context.lineTo(px, cy + 5);
      context.stroke();
      if (value % Math.max(1, Math.ceil(range / 10)) === 0) context.fillText(String(value), px, cy + 18);
    }
  } else if (element.shapeType === 'circle') {
    context.beginPath();
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.stroke();
  } else if (element.shapeType === 'triangle') {
    drawPolygon(context, [{ x: x + width / 2, y }, { x: x + width, y: y + height }, { x, y: y + height }], fill, stroke, 2);
  } else if (element.shapeType === 'right-triangle') {
    drawPolygon(context, [{ x, y }, { x, y: y + height }, { x: x + width, y: y + height }], fill, stroke, 2);
  } else if (element.shapeType === 'diamond') {
    drawPolygon(context, [{ x: x + width / 2, y }, { x: x + width, y: y + height / 2 }, { x: x + width / 2, y: y + height }, { x, y: y + height / 2 }], fill, stroke, 2);
  } else if (element.shapeType === 'parallelogram') {
    drawPolygon(context, [{ x: x + width * .2, y }, { x: x + width, y }, { x: x + width * .8, y: y + height }, { x, y: y + height }], fill, stroke, 2);
  } else if (element.shapeType === 'star') {
    const points: Point[] = [];
    for (let index = 0; index < 10; index += 1) {
      const radius = index % 2 === 0 ? 1 : .45;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      points.push({ x: x + width / 2 + Math.cos(angle) * width / 2 * radius, y: y + height / 2 + Math.sin(angle) * height / 2 * radius });
    }
    drawPolygon(context, points, fill, stroke, 2);
  } else if (element.shapeType === 'hexagon') {
    drawPolygon(context, regularPolygonPoints(x, y, width, height, 6), fill, stroke, 2);
  } else if (element.shapeType === 'pentagon') {
    drawPolygon(context, regularPolygonPoints(x, y, width, height, 5), fill, stroke, 2);
  } else if (element.shapeType === 'line') {
    context.strokeStyle = stroke;
    context.beginPath();
    context.moveTo(x, y + height / 2);
    context.lineTo(x + width, y + height / 2);
    context.stroke();
  } else {
    roundedRectPath(context, x, y, width, height, 8);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.stroke();
  }

  if (element.text && !['cartesian', 'advanced-cartesian', 'numberline'].includes(element.shapeType)) {
    context.fillStyle = element.textColor || '#1e293b';
    context.font = '600 14px Arial';
    context.textBaseline = 'middle';
    drawWrappedText(context, element.text, x + 8, y + height / 2 - 8, width - 16, 17, height - 12, 'center');
  }
  context.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('An exported image asset could not be decoded.'));
    image.src = src;
  });
}

interface ResolvedImageSource {
  src: string;
  retainedAssetId?: string;
}

async function resolveImageSource(boardId: string, element: any): Promise<ResolvedImageSource | null> {
  if (element.assetId) {
    try {
      const asset = await getBoardAsset(boardId, element.assetId);
      if (asset?.data) {
        retainBoardAsset(boardId, element.assetId);
        return { src: asset.data, retainedAssetId: element.assetId };
      }
    } catch {
      // A temporary inline source may still be available for a just-created item.
    }
  }
  const inline = element.src || element.signatureDataUrl || element.audioUrl;
  return inline ? { src: inline } : null;
}

function drawUnavailableImagePlaceholder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  context.fillStyle = '#e2e8f0';
  context.fillRect(x, y, width, height);
  context.fillStyle = '#64748b';
  context.font = '12px Arial';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText('Image unavailable', x + 8, y + 20);
}

async function drawElement(
  context: CanvasRenderingContext2D,
  element: BoardElement,
  allElements: BoardElement[],
  boardId: string
): Promise<void> {
  context.save();

  if (element.type === 'drawing') {
    if (element.points.length) {
      context.globalAlpha = element.isHighlighter ? 0.35 : 1;
      context.strokeStyle = element.color || '#1e293b';
      context.lineWidth = element.width || 3;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(element.points[0].x, element.points[0].y);
      for (let index = 1; index < element.points.length; index += 1) context.lineTo(element.points[index].x, element.points[index].y);
      context.stroke();
    }
  } else if (element.type === 'sticky') {
    roundedRectPath(context, element.x, element.y, element.width, element.height, 10);
    context.fillStyle = element.color || '#fef08a';
    context.fill();
    context.strokeStyle = 'rgba(15,23,42,.15)';
    context.stroke();
    context.fillStyle = element.textColor || '#1e293b';
    context.font = '600 14px Arial';
    context.textBaseline = 'top';
    drawWrappedText(context, element.text, element.x + 12, element.y + 12, element.width - 24, 18, element.height - 24);
  } else if (element.type === 'text') {
    if (element.backgroundColor && element.backgroundColor !== 'transparent') {
      context.fillStyle = element.backgroundColor;
      context.fillRect(element.x, element.y, element.width, element.height);
    }
    if (element.borderStyle && element.borderStyle !== 'none' && (element.borderWidth || 0) > 0) {
      context.strokeStyle = element.borderColor || '#cbd5e1';
      context.lineWidth = element.borderWidth || 1;
      context.setLineDash(element.borderStyle === 'dashed' ? [6, 4] : []);
      context.strokeRect(element.x, element.y, element.width, element.height);
      context.setLineDash([]);
    }
    const weight = element.fontWeight === 'bold' ? '700' : '400';
    const style = element.fontStyle === 'italic' ? 'italic ' : '';
    context.font = `${style}${weight} ${element.fontSize || 16}px ${fontFamily(element)}`;
    context.fillStyle = element.color || '#1e293b';
    context.textBaseline = 'top';
    drawWrappedText(
      context,
      element.text,
      element.x + 4,
      element.y + 4,
      element.width - 8,
      (element.fontSize || 16) * 1.25,
      element.height - 8,
      element.textAlign || 'left',
      element.textDecoration || 'none'
    );
  } else if (element.type === 'math') {
    if (element.backgroundColor && element.backgroundColor !== 'transparent') {
      context.fillStyle = element.backgroundColor;
      context.fillRect(element.x, element.y, element.width, element.height);
    }
    if ((element.borderWidth || 0) > 0 && element.borderStyle !== 'none') {
      context.strokeStyle = element.borderColor || '#cbd5e1';
      context.lineWidth = element.borderWidth || 1;
      context.setLineDash(element.borderStyle === 'dashed' ? [6, 4] : []);
      context.strokeRect(element.x, element.y, element.width, element.height);
      context.setLineDash([]);
    }
    context.fillStyle = element.color || '#0f172a';
    context.font = `${element.fontSize || 16}px Georgia, serif`;
    context.textBaseline = 'middle';
    drawWrappedText(context, element.text, element.x + 8, element.y + element.height / 2 - (element.fontSize || 16) / 2, element.width - 16, (element.fontSize || 16) * 1.25, element.height - 8, 'center');
  } else if (element.type === 'shape') {
    drawShape(context, element);
  } else if (element.type === 'image') {
    const source = await resolveImageSource(boardId, element);
    if (source) {
      try {
        const image = await loadImage(source.src);
        const rotation = normalizeImageRotation(element.rotation);
        if (rotation === 90) {
          context.translate(element.x + element.width, element.y);
          context.rotate(Math.PI / 2);
          context.drawImage(image, 0, 0, element.height, element.width);
        } else if (rotation === 180) {
          context.translate(element.x + element.width, element.y + element.height);
          context.rotate(Math.PI);
          context.drawImage(image, 0, 0, element.width, element.height);
        } else if (rotation === 270) {
          context.translate(element.x, element.y + element.height);
          context.rotate(-Math.PI / 2);
          context.drawImage(image, 0, 0, element.height, element.width);
        } else {
          context.drawImage(image, element.x, element.y, element.width, element.height);
        }
      } catch {
        drawUnavailableImagePlaceholder(context, element.x, element.y, element.width, element.height);
      } finally {
        if (source.retainedAssetId) releaseBoardAsset(boardId, source.retainedAssetId);
      }
    } else {
      drawUnavailableImagePlaceholder(context, element.x, element.y, element.width, element.height);
    }
  } else if (element.type === 'connector') {
    const connector = element as ConnectorElement;
    const from = allElements.find((candidate) => candidate.id === connector.fromId);
    if (from) {
      const start = getElementSocket(from, connector.fromSocket);
      const to = connector.toId ? allElements.find((candidate) => candidate.id === connector.toId) : null;
      const end = to ? getElementSocket(to, connector.toSocket || 'top') : connector.endPoint || start;
      context.strokeStyle = connector.color || '#475569';
      context.lineWidth = connector.strokeWidth || 2.5;
      context.beginPath();
      context.moveTo(start.x, start.y);
      if (connector.lineStyle === 'curved') {
        const midX = (start.x + end.x) / 2;
        context.bezierCurveTo(midX, start.y, midX, end.y, end.x, end.y);
      } else if (connector.lineStyle === 'elbow') {
        const midX = (start.x + end.x) / 2;
        context.lineTo(midX, start.y);
        context.lineTo(midX, end.y);
        context.lineTo(end.x, end.y);
      } else context.lineTo(end.x, end.y);
      context.stroke();
      if (connector.label) {
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        context.font = '600 11px Arial';
        const width = context.measureText(connector.label).width + 12;
        context.fillStyle = '#ffffff';
        context.fillRect(midX - width / 2, midY - 10, width, 20);
        context.strokeStyle = '#cbd5e1';
        context.strokeRect(midX - width / 2, midY - 10, width, 20);
        context.fillStyle = '#475569';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(connector.label, midX, midY);
      }
    }
  } else if (element.type === 'stamp') {
    const color = element.color || '#4f46e5';
    roundedRectPath(context, element.x, element.y, element.width, element.height, 14);
    context.fillStyle = color;
    context.globalAlpha = .92;
    context.fill();
    context.globalAlpha = 1;
    const signatureId = element.signatureAssetId || element.assetId;
    if (signatureId || element.signatureDataUrl) {
      let retainedSignature = false;
      try {
        const asset = signatureId ? await getBoardAsset(boardId, signatureId) : null;
        const source = asset?.data || element.signatureDataUrl;
        if (asset?.data && signatureId) {
          retainBoardAsset(boardId, signatureId);
          retainedSignature = true;
        }
        if (source) {
          const image = await loadImage(source);
          context.drawImage(image, element.x + 8, element.y + 8, element.width - 16, element.height - 16);
        }
      } catch {
        // Fall through to the text label when a signature cannot be decoded.
      } finally {
        if (retainedSignature && signatureId) releaseBoardAsset(boardId, signatureId);
      }
    }
    context.fillStyle = '#ffffff';
    context.font = '800 13px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(element.label || element.stampType.replace(/_/g, ' ').toUpperCase(), element.x + element.width / 2, element.y + element.height / 2);
  } else if (element.type === 'table') {
    const table = element as TableElement;
    const rows = Math.max(1, table.rows || table.data?.length || 1);
    const cols = Math.max(1, table.cols || table.data?.[0]?.length || 1);
    const colWidths = table.colWidths?.length === cols
      ? table.colWidths
      : Array.from({ length: cols }, () => table.width / cols);
    const totalConfigured = colWidths.reduce((sum, value) => sum + value, 0) || table.width;
    const normalizedWidths = colWidths.map((value) => value / totalConfigured * table.width);
    const cellHeight = table.height / rows;
    let currentX = table.x;
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        const cellY = table.y + row * cellHeight;
        const width = normalizedWidths[col];
        context.fillStyle = table.hasHeaderRow && row === 0 ? table.headerBgColor || '#f1f5f9' : table.cellBgColor || '#ffffff';
        context.fillRect(currentX, cellY, width, cellHeight);
        context.strokeStyle = table.borderColor || '#cbd5e1';
        context.lineWidth = 1;
        context.strokeRect(currentX, cellY, width, cellHeight);
        context.fillStyle = table.textColor || '#0f172a';
        context.font = `${table.hasHeaderRow && row === 0 ? '700' : '400'} ${table.fontSize || 14}px Arial`;
        context.textBaseline = 'middle';
        drawWrappedText(context, table.data?.[row]?.[col] || '', currentX + 6, cellY + cellHeight / 2 - (table.fontSize || 14) / 2, width - 12, (table.fontSize || 14) * 1.15, cellHeight - 6);
      }
      currentX += normalizedWidths[col];
    }
  } else if (element.type === 'audio') {
    roundedRectPath(context, element.x, element.y, AUDIO_SIZE.width, AUDIO_SIZE.height, 12);
    context.fillStyle = element.color || '#f1f5f9';
    context.fill();
    context.strokeStyle = '#cbd5e1';
    context.stroke();
    context.fillStyle = '#475569';
    context.font = '700 13px Arial';
    context.textBaseline = 'middle';
    context.fillText('🔊 Audio note', element.x + 14, element.y + 25);
    context.font = '11px Arial';
    context.fillText(`${element.authorName || 'Unknown author'}${element.duration ? ` • ${Math.round(element.duration)}s` : ''}`, element.x + 14, element.y + 48);
  }

  context.restore();
}

export async function renderBoardRegionToCanvas(
  elements: BoardElement[],
  boardId: string,
  region?: ExportRegion,
  options: RenderBoardOptions = {}
): Promise<{ canvas: HTMLCanvasElement; region: ExportRegion; scale: number }> {
  const exportRegion = region || getBoardExportBounds(elements, options.padding ?? 50);
  const maxDimension = options.maxDimension || EXPORT_MAX_DIMENSION;
  const maxPixels = options.maxPixels || EXPORT_MAX_PIXELS;
  const scale = Math.min(
    1,
    maxDimension / Math.max(exportRegion.width, exportRegion.height),
    Math.sqrt(maxPixels / Math.max(1, exportRegion.width * exportRegion.height))
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(exportRegion.width * scale));
  canvas.height = Math.max(1, Math.ceil(exportRegion.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create an export canvas.');

  context.fillStyle = options.background || '#f8fafc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  context.translate(-exportRegion.x, -exportRegion.y);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const sorted = [...elements]
    .filter((element) => !options.excludeElementIds?.has(element.id))
    .filter((element) => {
      const bounds = elementRect(element, elements);
      return !bounds || regionsIntersect(bounds, exportRegion);
    })
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  for (const element of sorted) await drawElement(context, element, elements, boardId);
  return { canvas, region: exportRegion, scale };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Unable to encode ${type}.`)), type, quality);
  });
}

export async function exportBoardImage(
  elements: BoardElement[],
  boardId: string,
  boardName: string,
  format: 'png' | 'svg'
): Promise<void> {
  const { canvas } = await renderBoardRegionToCanvas(elements, boardId);
  const safeName = (boardName || 'whiteboard').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'whiteboard';

  try {
    if (format === 'png') {
      downloadBlob(await canvasToBlob(canvas, 'image/png'), `${safeName}_export.png`);
      return;
    }

    // A raster-backed SVG preserves private images, PDF page backgrounds, graphs,
    // tables, stamps, and audio placeholders without unsafe foreignObject markup.
    const pngData = canvas.toDataURL('image/png');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image href="${pngData}" width="${canvas.width}" height="${canvas.height}"/></svg>`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${safeName}_export.svg`);
  } finally {
    // Release the potentially large backing pixel buffer after the browser has
    // copied the encoded export into a Blob or SVG string.
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function exportSelectionImage(
  elements: BoardElement[],
  selectedIds: string[],
  boardId: string,
  fileName: string = 'selection_export'
): Promise<void> {
  const selectedSet = new Set(selectedIds);
  const selectedElements = elements.filter((el) => selectedSet.has(el.id));
  if (selectedElements.length === 0) return;

  const { canvas } = await renderBoardRegionToCanvas(selectedElements, boardId, undefined, { padding: 24 });
  const safeName = (fileName || 'selection').replace(/[^a-z0-9_-]+/gi, '_') || 'selection';

  try {
    const blob = await canvasToBlob(canvas, 'image/png');
    downloadBlob(blob, `${safeName}.png`);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

