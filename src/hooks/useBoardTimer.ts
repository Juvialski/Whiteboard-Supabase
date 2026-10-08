import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { subscribeBoardSocketMessages, subscribeBoardSocketStatus, sendBoardSocketMessage } from '../services/boardSocketService';
import type { TimerAction, TimerState } from '../services/timerState';

// Uses the existing relay, with notifications only. Every state comes from an RPC.
export function useBoardTimer(boardId: string, identity: string) {
  const [state, setState] = useState<TimerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = useRef<{
    active: boolean; identity: string; state: TimerState | null; offset: number; busy: boolean;
    refresh: () => Promise<void>;
    accept: (payload: any, before: number) => void;
  } | null>(null);
  useEffect(() => {
    const current = { active: true, identity, state: null as TimerState | null, offset: 0, busy: false,
      refresh: async () => {}, accept: (_payload: any, _before: number) => {} };
    session.current = current;
    setState(null); setError(null); setBusy(false);
    let refreshing: Promise<void> | null = null;
    let refreshAgain = false;
    const accept = (payload: any, before: number) => {
      if (!current.active || payload?.timer?.board_id !== boardId) return;
      if (current.state && Number(payload.timer.revision) < current.state.revision) return;
      current.offset = Number(payload.serverTime) - (before + Date.now()) / 2;
      current.state = payload.timer;
      setState(payload.timer);
    };
    current.refresh = () => {
      if (refreshing) { refreshAgain = true; return refreshing; }
      refreshing = (async () => {
        do {
          refreshAgain = false;
          const before = Date.now();
          const { data, error } = await supabase.rpc('get_board_timer', { p_board_id: boardId });
          if (error) throw error;
          accept(data, before);
          if (current.active) setError(null);
        } while (current.active && refreshAgain);
      })().catch((err) => {
        if (current.active) setError(err.message || 'Timer recovery failed. Retry when connected.');
      }).finally(() => { refreshing = null; });
      return refreshing;
    };
    const refresh = () => { void current.refresh(); };
    const unsubMessage = subscribeBoardSocketMessages(boardId, (message) => {
      if (message.type === 'timer_sync' && message.boardId === boardId &&
          (!current.state || Number(message.revision) > current.state.revision)) refresh();
    });
    let authenticated = false;
    const unsubStatus = subscribeBoardSocketStatus(boardId, (status) => {
      const recovered = status.authenticated && !authenticated;
      authenticated = status.authenticated;
      if (recovered) refresh();
    });
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    const authSubscription = supabase.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') queueMicrotask(refresh);
    });
    // Fetch immediately for late joiners; coalesces with socket authentication.
    refresh();
    current.accept = accept;
    return () => {
      current.active = false; unsubMessage(); unsubStatus();
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
      authSubscription.data.subscription.unsubscribe();
    };
  }, [boardId, identity]);
  const transition = async (action: TimerAction, value?: number) => {
    const current = session.current;
    if (!current?.active || current.identity !== identity || current.busy || !current.state || current.state.board_id !== boardId) return;
    current.busy = true; setBusy(true); setError(null);
    const before = Date.now();
    try {
      const { data, error } = await supabase.rpc('transition_board_timer', {
        p_board_id: boardId, p_expected_revision: current.state.revision, p_action: action, p_value: value ?? null,
      });
      if (error) throw error;
      if (!current.active) return;
      current.accept(data, before);
      sendBoardSocketMessage(boardId, { type: 'timer_sync', revision: data.timer.revision });
    } catch (err: any) {
      if (current.active) {
        // Never replay a failed transition: the response may have been lost after commit.
        await current.refresh();
        setError(err.message || 'Timer change could not be confirmed. Refresh and retry.');
      }
    } finally {
      current.busy = false;
      if (current.active) setBusy(false);
    }
  };
  return { state: state?.board_id === boardId && session.current?.identity === identity ? state : null, error, busy, transition,
    serverNow: () => Date.now() + (session.current?.offset || 0) };
}
