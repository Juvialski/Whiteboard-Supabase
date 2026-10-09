import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimerState } from '../services/timerState';
import { timerSeconds } from '../services/timerState';
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), send: vi.fn(), messages: new Map<string, Set<(m: any) => void>>(),
  statuses: new Map<string, Set<(m: any) => void>>(), auth: new Set<(event: string) => void>(),
}));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc, auth: {
  onAuthStateChange: (cb: any) => { mocks.auth.add(cb); return { data: { subscription: { unsubscribe: () => mocks.auth.delete(cb) } } }; },
} } }));
vi.mock('../services/boardSocketService', () => ({
  sendBoardSocketMessage: mocks.send,
  subscribeBoardSocketMessages: (id: string, cb: any) => {
    if (!mocks.messages.has(id)) mocks.messages.set(id, new Set());
    mocks.messages.get(id)!.add(cb); return () => mocks.messages.get(id)!.delete(cb);
  },
  subscribeBoardSocketStatus: (id: string, cb: any) => {
    if (!mocks.statuses.has(id)) mocks.statuses.set(id, new Set());
    mocks.statuses.get(id)!.add(cb); return () => mocks.statuses.get(id)!.delete(cb);
  },
}));
import { useBoardTimer } from './useBoardTimer';
const base: TimerState = { board_id: 'one', mode: 'timer', running: false, baseline_ms: 300000,
  total_seconds: 300, started_at: null, visible: true, completed: false, revision: 0, run_id: 0 };
beforeEach(() => { mocks.rpc.mockReset(); mocks.send.mockReset(); });
afterEach(() => cleanup());
describe('shared timer persistence and recovery', () => {
  it('recovers authoritative elapsed time on foreground after suspended callbacks, without replaying writes', async () => {
    const start = Date.now();
    let now = start;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      let timer = { ...base, running: true, started_at: new Date(start).toISOString(), revision: 1 };
      mocks.rpc.mockImplementation(async () => ({ data: { timer, serverTime: now + 2000 }, error: null }));
      const first = renderHook(() => useBoardTimer('one', 'teacher'));
      const second = renderHook(() => useBoardTimer('one', 'student'));
      await waitFor(() => expect(second.result.current.state?.revision).toBe(1));
      expect(timerSeconds(first.result.current.state!, first.result.current.serverNow())).toBe(298);
      visibility.mockReturnValue('hidden');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      // Move wall clock directly: no interval callbacks run during this sleep.
      now += 120000;
      timer = { ...timer, revision: 2 };
      visibility.mockReturnValue('visible');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await waitFor(() => expect(second.result.current.state?.revision).toBe(2));
      expect(timerSeconds(first.result.current.state!, first.result.current.serverNow())).toBe(178);
      expect(timerSeconds(second.result.current.state!, second.result.current.serverNow())).toBe(178);
      expect(mocks.rpc.mock.calls.every(([name]) => name === 'get_board_timer')).toBe(true);
      expect(mocks.send).not.toHaveBeenCalled();
      first.unmount(); second.unmount();
      const count = mocks.rpc.mock.calls.length;
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(mocks.rpc).toHaveBeenCalledTimes(count);
    } finally { clock.mockRestore(); visibility.mockRestore(); }
  });
  it('fetches authoritative state for late joiners and reconnects, ignores repeated notifications', async () => {
    let timer = { ...base, revision: 5, running: true, started_at: new Date().toISOString() };
    mocks.rpc.mockImplementation(async () => ({ data: { timer, serverTime: Date.now() }, error: null }));
    const hook = renderHook(() => useBoardTimer('one', 'user'));
    await waitFor(() => expect(hook.result.current.state?.revision).toBe(5));
    act(() => mocks.messages.get('one')!.forEach(cb => cb({ type: 'timer_sync', boardId: 'one', revision: 4 })));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    timer = { ...timer, revision: 8 };
    act(() => mocks.statuses.get('one')!.forEach(cb => cb({ authenticated: true })));
    await waitFor(() => expect(hook.result.current.state?.revision).toBe(8));
    act(() => mocks.statuses.get('one')!.forEach(cb => cb({ authenticated: true })));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(mocks.messages.get('one')!.size).toBe(0); expect(mocks.statuses.get('one')!.size).toBe(0);
  });
  it('never optimistically accepts a denied or conflicting save, refreshes and requires an explicit retry', async () => {
    let revision = 0;
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_board_timer'
      ? { data: { timer: { ...base, revision }, serverTime: Date.now() }, error: null }
      : { data: null, error: { code: '42501', message: 'Timer write access denied' } });
    const hook = renderHook(() => useBoardTimer('one', 'viewer'));
    await waitFor(() => expect(hook.result.current.state).not.toBeNull());
    revision = 2;
    await act(() => hook.result.current.transition('start'));
    expect(hook.result.current.state?.running).toBe(false);
    expect(hook.result.current.state?.revision).toBe(2);
    expect(hook.result.current.error).toMatch(/denied/);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'transition_board_timer')).toHaveLength(1);
  });
  it('ignores in-flight responses from a previous board or account', async () => {
    let resolve!: (data: any) => void;
    mocks.rpc.mockImplementation((_name, args) => args.p_board_id === 'one'
      ? new Promise(r => { resolve = r; }) : Promise.resolve({ data: { timer: { ...base, board_id: 'two', revision: 7 }, serverTime: Date.now() } }));
    const hook = renderHook(({ board, user }) => useBoardTimer(board, user), { initialProps: { board: 'one', user: 'first' } });
    hook.rerender({ board: 'two', user: 'second' });
    await waitFor(() => expect(hook.result.current.state?.board_id).toBe('two'));
    await act(async () => resolve({ data: { timer: base, serverTime: Date.now() } }));
    expect(hook.result.current.state?.revision).toBe(7);
  });
  it('synchronizes two mounted clients via revision notifications and recovers on auth refresh', async () => {
    let timer = { ...base };
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === 'transition_board_timer') timer = { ...timer, revision: timer.revision + 1, running: true, started_at: new Date().toISOString() };
      return { data: { timer, serverTime: Date.now() }, error: null };
    });
    const first = renderHook(() => useBoardTimer('one', 'first'));
    const second = renderHook(() => useBoardTimer('one', 'second'));
    await waitFor(() => expect(second.result.current.state).not.toBeNull());
    await act(() => first.result.current.transition('start'));
    expect(second.result.current.state?.running).toBe(false);
    act(() => mocks.messages.get('one')!.forEach(cb => cb({ type: 'timer_sync', boardId: 'one', revision: 1 })));
    await waitFor(() => expect(second.result.current.state?.running).toBe(true));
    timer = { ...timer, revision: 2, visible: false };
    await act(async () => mocks.auth.forEach(cb => cb('TOKEN_REFRESHED')));
    await waitFor(() => expect(second.result.current.state?.visible).toBe(false));
  });
});
