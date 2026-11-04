import { describe, expect, it } from 'vitest';
import type { BoardElement } from '../types';
import {
  WHITEBOARD_CLIPBOARD_MIME,
  cloneElementsForPaste,
  readElementClipboard,
  serializeElementClipboard,
} from './elementClipboard';

const sticky = (id: string, x = 10, y = 20): BoardElement => ({
  id, type: 'sticky', x, y, width: 120, height: 80,
  text: 'Practice question', color: '#ffcc00', zIndex: 1,
});

describe('whiteboard element clipboard', () => {
  it('round-trips Unicode and element metadata via HTML or app-specific clipboard MIME', () => {
    const source = [{ ...sticky('note-1'), text: 'Solve π + 2 😊' }];
    const encoded = serializeElementClipboard('board-1', source);
    const html = readElementClipboard({ getData: type => type === 'text/html' ? encoded.html : '' });
    const custom = readElementClipboard({ getData: type => type === WHITEBOARD_CLIPBOARD_MIME ? encoded.payload : '' });
    expect(html).toEqual({ version: 1, boardId: 'board-1', elements: source });
    expect(custom).toEqual(html);
  });

  it('does not paste a stale selection when the user copies ordinary external content', () => {
    expect(readElementClipboard({ getData: type => type === 'text/plain' ? 'Different content' : '' })).toBeNull();
    expect(readElementClipboard({ getData: type => type === 'text/html' ? '<b>External HTML</b>' : '' })).toBeNull();
    expect(readElementClipboard({ getData: () => '<span data-whiteboard-elements="%ZZ"></span>' })).toBeNull();
  });

  it('copies multi-selected elements and remaps connected endpoints while preserving geometry', () => {
    const originals: BoardElement[] = [
      sticky('a', 20, 30), sticky('b', 260, 70),
      { id: 'connector-1', type: 'connector', fromId: 'a', toId: 'b', fromSocket: 'right', toSocket: 'left', color: '#111111', zIndex: 3 },
      { id: 'line-1', type: 'drawing', points: [{ x: 4, y: 8 }, { x: 18, y: 21 }], color: '#444444', width: 3, isHighlighter: false, zIndex: 4 },
    ];
    const copies = cloneElementsForPaste(originals, 40, 100, false);
    expect(copies).toHaveLength(4);
    expect(copies.map(e => e.id)).not.toEqual(originals.map(e => e.id));
    expect(copies[0]).toMatchObject({ x: 60, y: 70, zIndex: 101 });
    expect(copies[1]).toMatchObject({ x: 300, y: 110 });
    expect(copies[2]).toMatchObject({ fromId: copies[0].id, toId: copies[1].id });
    expect(copies[3]).toMatchObject({ points: [{ x: 44, y: 48 }, { x: 58, y: 61 }] });
    expect(originals[0]).toMatchObject({ id: 'a', x: 20, y: 30 });
  });

  it('moves a free-floating connector endpoint with its copied source', () => {
    const copies = cloneElementsForPaste([
      sticky('start'),
      { id: 'arrow', type: 'connector', fromId: 'start', endPoint: { x: 220, y: 80 }, fromSocket: 'right', color: '#111111', zIndex: 2 },
    ], 24, 4, true);
    expect(copies[1]).toMatchObject({ fromId: copies[0].id, endPoint: { x: 244, y: 104 } });
  });

  it('rejects cross-board cloud media and discards dangling cross-board connectors', () => {
    const media: BoardElement = {
      id: 'photo', type: 'image', assetId: 'private-board-asset',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1,
    };
    expect(() => cloneElementsForPaste([media], 40, 1, true)).toThrow(/Cloud media/);
    const orphan: BoardElement = {
      id: 'orphan', type: 'connector', fromId: 'not-copied',
      fromSocket: 'top', color: '#111111', zIndex: 1,
    };
    expect(cloneElementsForPaste([orphan], 40, 1, true)).toEqual([]);
  });

  it('rejects oversized or malformed clipboard envelopes', () => {
    expect(() => serializeElementClipboard('board-1', Array.from({ length: 301 }, (_, i) => sticky('s-' + i)))).toThrow();
    const malformed = JSON.stringify({ version: 1, boardId: 'board-1', elements: [{ id: 'evil', type: 'unknown' }] });
    expect(readElementClipboard({ getData: type => type === WHITEBOARD_CLIPBOARD_MIME ? malformed : '' })).toBeNull();
  });
});
