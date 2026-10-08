import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ retry: vi.fn(), asset: { data: 'data:audio/webm;base64,AAAA', loading: false, error: null as Error | null } }));
vi.mock('../hooks/useBoardAsset', () => ({ useBoardAsset: () => ({ ...mocks.asset, retry: mocks.retry }) }));
import AudioComponent from './AudioComponent';
const props = { element: { id: 'voice', type: 'audio' as const, x: 0, y: 0, assetId: 'asset', duration: 10, zIndex: 1 },
  isSelected: false, isInteractive: true, boardId: 'one', onSelect: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() };
let instance: any;
let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
  mocks.asset = { data: 'data:audio/webm;base64,AAAA', loading: false, error: null };
  vi.stubGlobal('Audio', class {
    paused = true; onplaying: any; onpause: any; onended: any; onerror: any;
    play = play; pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
    constructor() { instance = this; }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('voice-note playback accuracy', () => {
  it('keeps Play visible when playback is denied and provides retry', async () => {
    render(<AudioComponent {...props} />);
    fireEvent.click(screen.getByTitle('Play Voice Note'));
    await waitFor(() => expect(screen.getByText('Retry audio')).toBeTruthy());
    expect(screen.queryByTitle('Pause Voice Note')).toBeNull();
  });
  it('waits for successful playback before showing Pause and cleans up resources', async () => {
    let resolve!: () => void;
    play.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    const view = render(<AudioComponent {...props} />);
    fireEvent.click(screen.getByTitle('Play Voice Note'));
    expect(screen.queryByTitle('Pause Voice Note')).toBeNull();
    instance.paused = false; resolve();
    await waitFor(() => expect(screen.getByTitle('Pause Voice Note')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Pause Voice Note'));
    expect(instance.pause).toHaveBeenCalledOnce();
    view.unmount(); expect(instance.removeAttribute).toHaveBeenCalledWith('src');
    expect(instance.onplaying).toBeNull();
  });
  it('disables unloaded audio and retries failed asset resolution', () => {
    mocks.asset = { data: null, loading: false, error: new Error('download failed') };
    render(<AudioComponent {...props} />);
    expect((screen.getByTitle('Play Voice Note') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Retry audio'));
    expect(mocks.retry).toHaveBeenCalled();
  });
});
