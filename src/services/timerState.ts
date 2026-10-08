export interface TimerState {
  board_id: string;
  mode: 'timer' | 'stopwatch';
  running: boolean;
  baseline_ms: number;
  total_seconds: number;
  started_at: string | null;
  visible: boolean;
  completed: boolean;
  run_id: number;
  revision: number;
}
export type TimerAction = 'start' | 'pause' | 'reset' | 'duration' | 'mode' | 'adjust' | 'visibility';
export function timerMilliseconds(state: TimerState, serverNow: number): number {
  const elapsed = state.running && state.started_at
    ? Math.max(0, serverNow - Date.parse(state.started_at)) : 0;
  return state.mode === 'timer' ? Math.max(0, state.baseline_ms - elapsed)
    : Math.min(31536000000, state.baseline_ms + elapsed);
}
export function timerCompleted(state: TimerState, now: number): boolean {
  return state.mode === 'timer' && (state.completed || (state.running && timerMilliseconds(state, now) === 0));
}
export function timerSeconds(state: TimerState, now: number): number {
  const ms = timerMilliseconds(state, now);
  return state.mode === 'timer' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
}
