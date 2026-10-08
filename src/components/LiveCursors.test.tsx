import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveCursors from './LiveCursors';
import type { BoardElement, Collaborator } from '../types';
const peer: Collaborator = { id: 'peer', name: 'Alice', color: '#ff0000', x: 100, y: 100, lastActive: 1 };
const props = { boardId: 'one', currentUser: { id: 'me', name: 'Me', color: '#000000' }, zoom: 1, panX: 0, panY: 0,
  viewportWidth: 600, viewportHeight: 400, elements: [] as BoardElement[] };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('smart live cursor overlay', () => {
  it('renders subtle colored outlines, aligns with zoom/pan, and keeps subpixel live movement', async () => {
    const ref = { current: { peer: { ...peer } } };
    const { container, rerender } = render(<LiveCursors {...props} socketCollaboratorsRef={ref} />);
    let marker = container.querySelector('[data-cursor-id="peer"]') as SVGElement;
    expect(marker.style.left).toBe('95px'); expect(marker.style.top).toBe('95px');
    expect(marker.getAttribute('width')).toBe('10');
    expect(marker.getAttribute('fill')).toBe('none');
    expect(marker.getAttribute('stroke')).toBe(peer.color);
    expect(Number(marker.style.opacity)).toBeLessThan(1);
    rerender(<LiveCursors {...props} panX={20} panY={-10} zoom={2} socketCollaboratorsRef={ref} />);
    marker = container.querySelector('[data-cursor-id="peer"]') as SVGElement;
    expect(marker.style.left).toBe('215px'); expect(marker.style.top).toBe('185px');
    ref.current.peer.x = 100.125;
    await act(async () => { await vi.advanceTimersByTimeAsync(34); });
    expect(marker.style.left).toBe('215.25px');
  });
  it('hides the badge on dense PDF content and retains the moving cursor marker', async () => {
    const ref = { current: { peer: { ...peer } } };
    const page = { id: 'pdf-page-1', type: 'image', x: 0, y: 0, width: 600, height: 400 } as BoardElement;
    const { container } = render(<LiveCursors {...props} elements={[page]} socketCollaboratorsRef={ref} />);
    expect(container.querySelector('[data-cursor-badge]')).toBeNull();
    expect(container.querySelector('[data-cursor-id]')).toBeTruthy();
    ref.current.peer.x = 105;
    await act(async () => { await vi.advanceTimersByTimeAsync(34); });
    expect((container.querySelector('[data-cursor-id]') as SVGElement).style.left).toBe('100px');
  });
  it('has no interactive/focusable descendants and does not stop board input bubbling', () => {
    const pointer = vi.fn(), click = vi.fn(), typing = vi.fn();
    const { container } = render(<div onPointerDown={pointer} onClick={click} onKeyDown={typing}>
      <LiveCursors {...props} socketCollaboratorsRef={{ current: { peer } }} />
      <input aria-label="Question" />
    </div>);
    const overlay = container.querySelector('#live-cursors-layer')!;
    expect(container.querySelector('button')).toBeNull();
    expect(overlay.querySelector('[tabindex]')).toBeNull();
    for (const element of [overlay, ...overlay.querySelectorAll('svg,span')]) {
      expect((element as HTMLElement).style.pointerEvents).toBe('none');
    }
    fireEvent.pointerDown(overlay); fireEvent.click(overlay);
    fireEvent.keyDown(container.querySelector('input')!, { key: 'a' });
    expect(pointer).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(typing).toHaveBeenCalledOnce();
  });
  it('avoids active drawing bounds, removes stale peers, and updates badge metadata', async () => {
    const ref = { current: { peer: { ...peer } } } as React.MutableRefObject<Record<string, Collaborator>>;
    const drawings = { current: { peer: { points: [{ x: 0, y: 0 }, { x: 600, y: 400 }], width: 2 } } };
    const { container } = render(<LiveCursors {...props} socketCollaboratorsRef={ref} remoteDrawingsRef={drawings} />);
    expect(container.querySelector('[data-cursor-badge]')).toBeNull();
    drawings.current = {} as any;
    ref.current.peer.name = 'Renamed'; ref.current.peer.color = '#00ff00';
    await act(async () => { await vi.advanceTimersByTimeAsync(34); });
    expect(container.textContent).toContain('Renamed');
    expect(container.querySelector('[data-cursor-id]')!.getAttribute('stroke')).toBe('#00ff00');
    ref.current = {};
    await act(async () => { await vi.advanceTimersByTimeAsync(34); });
    expect(container.querySelector('[data-cursor-id]')).toBeNull();
  });
  it('keeps mobile names within bounds, resets on board switch/disconnect, and cleans up its interval', () => {
    const ref = { current: { peer: { ...peer, x: 315, y: 15 } } };
    const view = render(<LiveCursors {...props} viewportWidth={320} viewportHeight={500} socketCollaboratorsRef={ref} followedUserId="peer" />);
    const badge = view.container.querySelector('[data-cursor-badge]') as HTMLElement;
    expect(badge).toBeTruthy(); expect(parseFloat(badge.style.left) + parseFloat(badge.style.width)).toBeLessThanOrEqual(312);
    expect(view.container.querySelector('[data-cursor-id]')!.getAttribute('stroke-width')).toBe('1.6');
    view.rerender(<LiveCursors {...props} boardId="two" />);
    expect(view.container.querySelector('[data-cursor-id]')).toBeNull();
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
