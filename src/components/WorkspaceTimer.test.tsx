import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceTimer from './WorkspaceTimer';
import type { TimerState } from '../services/timerState';
import { setBoardRecoveryProjectScope, setBoardRecoveryUserScope } from '../utils/boardRecoveryCache';
const audio = vi.hoisted(() => ({ play: vi.fn(() => false), unlock: vi.fn(async () => false), close: vi.fn(async () => {}) }));
vi.mock('../services/timerAudio', async original => ({
  ...await original<any>(),
  TimerAudio: class { play = audio.play; unlock = audio.unlock; close = audio.close; },
}));
const initial: TimerState = { board_id: 'completion-test', mode: 'timer', running: true, baseline_ms: 1000,
  total_seconds: 1, started_at: new Date(1000).toISOString(), visible: true, completed: false, revision: 1, run_id: 0 };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  audio.play.mockClear(); audio.unlock.mockClear(); audio.close.mockClear();
  setBoardRecoveryProjectScope('widget-tests'); setBoardRecoveryUserScope('test');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('timer widget reliability', () => {
  it('shows completion after browser sleep without writing on ticks or replaying alarms', async () => {
    const onAction = vi.fn(async () => {});
    const props = { isOpen: true, onClose: vi.fn(), state: { ...initial, run_id: 91 }, onAction, serverNow: () => Date.now() };
    const view = render(<WorkspaceTimer {...props} />);
    vi.setSystemTime(500000);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText(/Time is up/)).toBeTruthy();
    expect(screen.getByText(/sound unavailable; use Test Sound/)).toBeTruthy();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
    view.rerender(<WorkspaceTimer {...props} state={{ ...props.state, revision: 2 }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(audio.play).toHaveBeenCalledOnce();
    view.unmount(); expect(audio.close).toHaveBeenCalled();
    render(<WorkspaceTimer {...props} />);
    expect(audio.play).toHaveBeenCalledOnce();
  });
  it('keeps a visual completion alert visible when the timer panel is closed', () => {
    render(<WorkspaceTimer isOpen={false} onClose={vi.fn()} state={{ ...initial, completed: true, running: false, baseline_ms: 0, run_id: 92 }} onAction={vi.fn(async () => {})} serverNow={() => Date.now()} />);
    expect(screen.getByText(/Time is up/)).toBeTruthy();
  });
  it('allows read-only participants to test sound but prevents timer transitions', () => {
    const onAction = vi.fn(async () => {});
    render(<WorkspaceTimer isOpen onClose={vi.fn()} state={initial} isReadOnly onAction={onAction} serverNow={() => Date.now()} />);
    expect(screen.queryByText('Reset')).toBeNull();
    fireEvent.click(screen.getByText('Test Sound'));
    expect(audio.unlock).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });
});
