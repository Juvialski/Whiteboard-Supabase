// Audio is created/resumed only from a user's click. A timer tick never unlocks it.
export class TimerAudio {
  private context: AudioContext | null = null;
  async unlock(): Promise<boolean> {
    try {
      const Audio = window.AudioContext || (window as any).webkitAudioContext;
      if (!Audio) return false;
      this.context ??= new Audio();
      if (this.context.state !== 'running') await this.context.resume();
      return this.context.state === 'running';
    } catch { return false; }
  }
  play(): boolean {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return false;
    try {
      [659.25, 987.77, 830.61].forEach((frequency, index) => {
        const at = ctx.currentTime + index * 0.15;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.3, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.8);
        oscillator.connect(gain); gain.connect(ctx.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at + 0.8);
      });
      return true;
    } catch { return false; }
  }
  async close(): Promise<void> {
    const ctx = this.context; this.context = null;
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined);
  }
}

export function soundPreference(): boolean {
  try { return localStorage.getItem('whiteboard_timer_sound') !== 'off'; } catch { return true; }
}
export function saveSoundPreference(enabled: boolean): void {
  try { localStorage.setItem('whiteboard_timer_sound', enabled ? 'on' : 'off'); } catch { /* in-memory preference remains usable */ }
}
// Same session dedup survives component remount, reconnect, and timer revisions.
const alarmed = new Set<string>();
export function claimCompletion(key: string): boolean {
  if (alarmed.has(key)) return false;
  try {
    if (sessionStorage.getItem(key)) { alarmed.add(key); return false; }
    sessionStorage.setItem(key, '1');
  } catch { /* memory still prevents repeated alarms in this page */ }
  alarmed.add(key);
  return true;
}
