import type { BoardElement } from '../types';

export const WHITEBOARD_CLIPBOARD_MIME = 'application/x-whiteboard-elements+json';
const MAX_CLIPBOARD_LENGTH = 8_000_000;
const MAX_CLIPBOARD_ELEMENTS = 300;
const ELEMENT_TYPES = new Set(['sticky', 'shape', 'text', 'drawing', 'image', 'connector', 'audio', 'stamp', 'math', 'table']);

export interface ElementClipboardBundle {
  version: 1;
  boardId: string;
  elements: BoardElement[];
}

// Connectors have no bounding rectangle for marquee selection. Include a link
// when both of its endpoints are selected so copied groups retain their links.
export function selectedElementsForCopy(elements: BoardElement[], ids: Set<string>): BoardElement[] {
  return elements.filter(element => ids.has(element.id) ||
    (element.type === 'connector' && !!element.toId && ids.has(element.fromId) && ids.has(element.toId)));
}

function parseBundle(payload: string): ElementClipboardBundle | null {
  if (!payload || payload.length > MAX_CLIPBOARD_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== 'object') return null;
    const bundle = value as Partial<ElementClipboardBundle>;
    if (bundle.version !== 1 || typeof bundle.boardId !== 'string' || !bundle.boardId ||
        !Array.isArray(bundle.elements) || !bundle.elements.length || bundle.elements.length > MAX_CLIPBOARD_ELEMENTS) return null;
    if (!bundle.elements.every((element) =>
      element && typeof element === 'object' && typeof element.id === 'string' &&
      element.id.length > 0 && ELEMENT_TYPES.has(element.type))) return null;
    return bundle as ElementClipboardBundle;
  } catch {
    return null;
  }
}

// HTML is the widely supported portable format. The app-specific MIME type is an
// optional enhancement; ordinary applications see a readable text description.
export function serializeElementClipboard(boardId: string, elements: BoardElement[]) {
  if (!boardId || !elements.length || elements.length > MAX_CLIPBOARD_ELEMENTS) {
    throw new Error('Select 1 to 300 whiteboard elements to copy.');
  }
  const payload = JSON.stringify({ version: 1, boardId, elements });
  if (payload.length > MAX_CLIPBOARD_LENGTH) {
    throw new Error('Selection is too large for the clipboard. Copy fewer elements.');
  }
  const text = 'Copied ' + elements.length + ' whiteboard element' + (elements.length === 1 ? '' : 's');
  const html = '<span data-whiteboard-elements="' + encodeURIComponent(payload) + '">' + text + '</span>';
  return { payload, html, text };
}

export function readElementClipboard(clipboard: Pick<DataTransfer, 'getData'> | null): ElementClipboardBundle | null {
  if (!clipboard) return null;
  const direct = parseBundle(clipboard.getData(WHITEBOARD_CLIPBOARD_MIME));
  if (direct) return direct;
  const html = clipboard.getData('text/html');
  if (!html || html.length > MAX_CLIPBOARD_LENGTH * 3) return null;
  const match = html.match(/data-whiteboard-elements\s*=\s*["']([^"']+)["']/i);
  if (!match) return null;
  try {
    return parseBundle(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function cloneElementsForPaste(
  elements: BoardElement[],
  offset: number,
  maxZIndex: number,
  fromAnotherBoard: boolean,
): BoardElement[] {
  if (fromAnotherBoard && elements.some((element) =>
    (('assetId' in element) && element.assetId) ||
    (('signatureAssetId' in element) && element.signatureAssetId))) {
    throw new Error('Cloud media cannot yet be pasted between different boards. Copy it within the original board.');
  }
  const ids = new Map<string, string>();
  elements.forEach((element) => {
    ids.set(element.id, 'copy-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
  });
  return elements.flatMap((source, index) => {
    if (fromAnotherBoard && source.type === 'connector' &&
        (!ids.has(source.fromId) || (source.toId && !ids.has(source.toId)))) return [];
    const element = JSON.parse(JSON.stringify(source)) as BoardElement;
    element.id = ids.get(source.id)!;
    element.zIndex = maxZIndex + index + 1;
    element.updatedAt = Date.now() + index;
    if ('updatedByClientId' in element) delete element.updatedByClientId;
    if ('x' in element && 'y' in element) {
      element.x += offset;
      element.y += offset;
    }
    if (element.type === 'drawing') {
      element.points = element.points.map((point) => ({ x: point.x + offset, y: point.y + offset }));
    }
    if (element.type === 'connector') {
      element.fromId = ids.get(element.fromId) || element.fromId;
      if (element.toId) element.toId = ids.get(element.toId) || element.toId;
      if (element.endPoint) element.endPoint = {
        x: element.endPoint.x + offset,
        y: element.endPoint.y + offset,
      };
    }
    return [element];
  });
}
