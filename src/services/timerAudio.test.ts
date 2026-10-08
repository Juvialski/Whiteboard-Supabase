import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerAudio, claimCompletion, saveSoundPreference, soundPreference } from './timerAudio';
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('timer sound policy and deduplication', () => {
  it('never creates or unlocks audio from an alarm tick', () => {
    const ctor = vi.fn(); vi.stubGlobal('AudioContext', ctor);
    expect(new TimerAudio().play()).toBe(false);
    expect(ctor).not.toHaveBeenCalled();
  });
  it('awaits resume and handles rejection without an unhandled promise', async () => {
    const resume = vi.fn().mockRejectedValue(new Error('blocked'));
    vi.stubGlobal('AudioContext', class { state = 'suspended'; resume = resume; });
    const audio = new TimerAudio();
    expect(await audio.unlock()).toBe(false);
    expect(audio.play()).toBe(false);
  });
  it('plays unlocked audio, rejects suspended audio, disconnects nodes and closes context', async () => {
    const disconnect = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
    const oscillators: any[] = [];
    class Context {
      state = 'suspended'; currentTime = 0; destination = {};
      resume = async () => { this.state = 'running'; };
      close = close;
      createOscillator() {
        const osc = { frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect,
          start: vi.fn(), stop: vi.fn(), onended: null };
        oscillators.push(osc); return osc;
      }
      createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect }; }
    }
    const context = new Context();
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    const audio = new TimerAudio();
    expect(await audio.unlock()).toBe(true); expect(audio.play()).toBe(true);
    expect(oscillators).toHaveLength(3);
    oscillators.forEach(osc => osc.onended());
    expect(disconnect).toHaveBeenCalledTimes(6);
    context.state = 'suspended'; expect(audio.play()).toBe(false);
    await audio.close(); expect(close).toHaveBeenCalledOnce();
  });
  it('keeps local preference and claims each completion only once per board/run', () => {
    saveSoundPreference(false); expect(soundPreference()).toBe(false);
    saveSoundPreference(true); expect(soundPreference()).toBe(true);
    expect(claimCompletion('test-alarm-one-1')).toBe(true);
    expect(claimCompletion('test-alarm-one-1')).toBe(false);
    expect(claimCompletion('test-alarm-one-2')).toBe(true);
    expect(claimCompletion('test-alarm-two-1')).toBe(true);
  });
});
