import { describe, expect, it } from 'vitest';
import { timerSeconds, timerMilliseconds, timerCompleted, type TimerState } from './timerState';
const state: TimerState = { board_id: 'one', mode: 'timer', running: true,
  baseline_ms: 300000, total_seconds: 300, started_at: new Date(1000).toISOString(),
  visible: true, completed: false, revision: 3, run_id: 1 };
describe('authoritative timer calculations', () => {
  it('restores a running countdown from persisted baseline and server epoch', () => {
    const reloaded = JSON.parse(JSON.stringify(state));
    expect(timerSeconds(reloaded, 151000)).toBe(150);
    expect(timerMilliseconds(reloaded, 151501)).toBe(149499);
  });
  it('restores paused timers without ticking', () => {
    expect(timerSeconds({ ...state, running: false, started_at: null, baseline_ms: 24550 }, 99999999)).toBe(25);
  });
  it('restores stopwatch including its previous paused baseline', () => {
    expect(timerSeconds({ ...state, mode: 'stopwatch', baseline_ms: 24550 }, 51500)).toBe(75);
  });
  it('handles sleep and background resume without interval drift', () => {
    expect(timerSeconds(state, 3601000)).toBe(0);
    expect(timerCompleted(state, 3601000)).toBe(true);
    expect(timerSeconds({ ...state, mode: 'stopwatch', baseline_ms: 0 }, 3601000)).toBe(3600);
  });
  it('clamps backwards clock corrections and preserves completion', () => {
    expect(timerSeconds(state, 0)).toBe(300);
    expect(timerCompleted({ ...state, running: false, completed: true, baseline_ms: 0 }, 900000)).toBe(true);
  });
});
