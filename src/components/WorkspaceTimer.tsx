import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Plus, Clock, Timer as TimerIcon, Volume2, VolumeX, X, Minus, Sparkles } from 'lucide-react';

interface WorkspaceTimerProps {
  isOpen: boolean;
  onClose: () => void;
  // Optional sync callbacks
  onTimerSync?: (state: { isRunning: boolean; mode: 'timer' | 'stopwatch'; remainingSeconds: number; totalSeconds: number; startedAt?: number | null }) => void;
  syncedState?: { isRunning: boolean; mode: 'timer' | 'stopwatch'; remainingSeconds: number; totalSeconds: number; startedAt?: number | null } | null;
  isReadOnly?: boolean;
}

export default function WorkspaceTimer({ isOpen, onClose, onTimerSync, syncedState, isReadOnly = false }: WorkspaceTimerProps) {
  const [mode, setMode] = useState<'timer' | 'stopwatch'>('timer');
  const [totalSeconds, setTotalSeconds] = useState<number>(300); // 5 mins default
  const [remainingSeconds, setRemainingSeconds] = useState<number>(300);
  const [stopwatchSeconds, setStopwatchSeconds] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [, setTick] = useState<number>(0);

  // Time editing inputs state
  const [minInput, setMinInput] = useState<string>('05');
  const [secInput, setSecInput] = useState<string>('00');
  const [isEditingTime, setIsEditingTime] = useState<boolean>(false);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Stable ref for onTimerSync to prevent tearing down interval when parent re-renders
  const onTimerSyncRef = useRef(onTimerSync);
  useEffect(() => {
    onTimerSyncRef.current = onTimerSync;
  }, [onTimerSync]);

  // Keep minute and second text inputs synced when not actively editing
  useEffect(() => {
    if (!isEditingTime) {
      const m = Math.floor(remainingSeconds / 60);
      const s = remainingSeconds % 60;
      setMinInput(m.toString().padStart(2, '0'));
      setSecInput(s.toString().padStart(2, '0'));
    }
  }, [remainingSeconds, isEditingTime]);

  // Sync with remote timer if broadcasted
  const prevSyncedStateRef = useRef<any>(null);
  useEffect(() => {
    if (syncedState) {
      const isDiff =
        !prevSyncedStateRef.current ||
        prevSyncedStateRef.current.isRunning !== syncedState.isRunning ||
        prevSyncedStateRef.current.mode !== syncedState.mode ||
        prevSyncedStateRef.current.remainingSeconds !== syncedState.remainingSeconds ||
        prevSyncedStateRef.current.totalSeconds !== syncedState.totalSeconds ||
        prevSyncedStateRef.current.startedAt !== syncedState.startedAt;

      if (isDiff) {
        prevSyncedStateRef.current = syncedState;
        setIsRunning(syncedState.isRunning);
        setMode(syncedState.mode);

        let validStartedAt: number | null = null;
        if (syncedState.isRunning) {
          const raw = syncedState.startedAt;
          const parsed = typeof raw === 'number' ? raw : Number(raw);
          validStartedAt = parsed && !isNaN(parsed) && parsed > 0 ? parsed : Date.now();
        }
        setStartedAt(validStartedAt);

        if (syncedState.mode === 'timer') {
          setRemainingSeconds(syncedState.remainingSeconds);
          setTotalSeconds(syncedState.totalSeconds);
        } else {
          setStopwatchSeconds(syncedState.remainingSeconds);
        }
      }
    }
  }, [syncedState]);

  // Audio synthesizer for sound alert when countdown finishes
  const playSoundAlert = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          audioCtxRef.current = new AudioCtx();
        }
      }
      const ctx = audioCtxRef.current;
      if (ctx) {
        if (ctx.state === 'suspended') {
          ctx.resume();
        }

        const now = ctx.currentTime;
        // Play a pleasant double-chime bell chord (E5 & B5 then G#5)
        const freqs = [659.25, 987.77, 830.61];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.15);
          gain.gain.setValueAtTime(0.3, now + idx * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.8);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.15);
          osc.stop(now + idx * 0.15 + 0.8);
        });
      }
    } catch (e) {
      console.error('Audio alert playback error:', e);
    }
  };

  // Calculate current seconds dynamically with millisecond precision
  const getCurrentDisplaySeconds = () => {
    if (!isRunning) {
      return mode === 'timer' ? remainingSeconds : stopwatchSeconds;
    }
    const parsedStartedAt = typeof startedAt === 'number' ? startedAt : Number(startedAt);
    const effectiveStartedAt =
      parsedStartedAt && !isNaN(parsedStartedAt) && parsedStartedAt > 0
        ? parsedStartedAt
        : Date.now();

    const elapsedMs = Math.max(0, Date.now() - effectiveStartedAt);
    if (mode === 'timer') {
      const remainingMs = remainingSeconds * 1000 - elapsedMs;
      return Math.max(0, Math.ceil(remainingMs / 1000));
    } else {
      const elapsedSecs = Math.floor(elapsedMs / 1000);
      return stopwatchSeconds + elapsedSecs;
    }
  };

  // Main tick timer loop (100ms interval for smooth rendering and completion checks)
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setTick((t) => t + 1);

      // Ensure effectiveStartedAt is populated if missing while running
      const parsedStartedAt = typeof startedAt === 'number' ? startedAt : Number(startedAt);
      const effectiveStartedAt =
        parsedStartedAt && !isNaN(parsedStartedAt) && parsedStartedAt > 0
          ? parsedStartedAt
          : Date.now();

      // Check if the countdown timer has completed
      if (mode === 'timer') {
        const elapsedMs = Date.now() - effectiveStartedAt;
        const currentLeftMs = remainingSeconds * 1000 - elapsedMs;
        if (currentLeftMs <= 0) {
          setIsRunning(false);
          setStartedAt(null);
          setRemainingSeconds(0);
          playSoundAlert();
          if (onTimerSyncRef.current) {
            onTimerSyncRef.current({
              isRunning: false,
              mode: 'timer',
              remainingSeconds: 0,
              totalSeconds,
              startedAt: null
            });
          }
        }
      }
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [isRunning, startedAt, mode, remainingSeconds, totalSeconds]);

  if (!isOpen) return null;

  const handleStartPause = () => {
    const nextIsRunning = !isRunning;
    const now = Date.now();
    const nextStartedAt = nextIsRunning ? now : null;

    let currentRemaining = remainingSeconds;
    let currentStopwatch = stopwatchSeconds;

    if (!nextIsRunning) {
      // Freeze at precisely calculated current values on pause
      const parsedStartedAt = typeof startedAt === 'number' ? startedAt : Number(startedAt);
      const effectiveStartedAt =
        parsedStartedAt && !isNaN(parsedStartedAt) && parsedStartedAt > 0
          ? parsedStartedAt
          : now;
      const elapsedMs = Math.max(0, now - effectiveStartedAt);
      if (mode === 'timer') {
        const remainingMs = Math.max(0, remainingSeconds * 1000 - elapsedMs);
        currentRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
      } else {
        const elapsedSecs = Math.floor(elapsedMs / 1000);
        currentStopwatch = stopwatchSeconds + elapsedSecs;
      }
      setRemainingSeconds(currentRemaining);
      setStopwatchSeconds(currentStopwatch);
    }

    setIsRunning(nextIsRunning);
    setStartedAt(nextStartedAt);

    if (onTimerSyncRef.current) {
      onTimerSyncRef.current({
        isRunning: nextIsRunning,
        mode,
        remainingSeconds: mode === 'timer' ? currentRemaining : currentStopwatch,
        totalSeconds,
        startedAt: nextStartedAt
      });
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setStartedAt(null);
    if (mode === 'timer') {
      setRemainingSeconds(totalSeconds);
    } else {
      setStopwatchSeconds(0);
    }
    if (onTimerSyncRef.current) {
      onTimerSyncRef.current({
        isRunning: false,
        mode,
        remainingSeconds: mode === 'timer' ? totalSeconds : 0,
        totalSeconds,
        startedAt: null
      });
    }
  };

  const handlePreset = (seconds: number) => {
    setIsRunning(false);
    setStartedAt(null);
    setTotalSeconds(seconds);
    setRemainingSeconds(seconds);
    setMode('timer');
    if (onTimerSyncRef.current) {
      onTimerSyncRef.current({
        isRunning: false,
        mode: 'timer',
        remainingSeconds: seconds,
        totalSeconds: seconds,
        startedAt: null
      });
    }
  };

  const handleAddSeconds = (secs: number) => {
    const now = Date.now();

    if (mode === 'timer') {
      let currentLeftSecs = remainingSeconds;
      if (isRunning && startedAt) {
        const elapsedMs = now - startedAt;
        const remainingMs = Math.max(0, remainingSeconds * 1000 - elapsedMs);
        currentLeftSecs = Math.max(0, Math.ceil(remainingMs / 1000));
      }

      const next = Math.max(0, currentLeftSecs + secs);
      const nextTotal = Math.max(next, secs > 0 ? totalSeconds + secs : totalSeconds);

      setRemainingSeconds(next);
      setTotalSeconds(nextTotal);
      if (isRunning) {
        setStartedAt(now);
      }

      if (onTimerSyncRef.current) {
        onTimerSyncRef.current({
          isRunning,
          mode: 'timer',
          remainingSeconds: next,
          totalSeconds: nextTotal,
          startedAt: isRunning ? now : null
        });
      }
    } else {
      let currentStopwatch = stopwatchSeconds;
      if (isRunning && startedAt) {
        const elapsedSecs = Math.floor((now - startedAt) / 1000);
        currentStopwatch = stopwatchSeconds + elapsedSecs;
      }

      const next = Math.max(0, currentStopwatch + secs);
      setStopwatchSeconds(next);
      if (isRunning) {
        setStartedAt(now);
      }

      if (onTimerSyncRef.current) {
        onTimerSyncRef.current({
          isRunning,
          mode: 'stopwatch',
          remainingSeconds: next,
          totalSeconds,
          startedAt: isRunning ? now : null
        });
      }
    }
  };

  const commitTimeInput = () => {
    setIsEditingTime(false);
    const parsedMins = Math.min(99, Math.max(0, parseInt(minInput) || 0));
    const parsedSecs = Math.min(59, Math.max(0, parseInt(secInput) || 0));
    const next = parsedMins * 60 + parsedSecs;
    setRemainingSeconds(next);
    setTotalSeconds(next);
    setMinInput(parsedMins.toString().padStart(2, '0'));
    setSecInput(parsedSecs.toString().padStart(2, '0'));
    if (onTimerSyncRef.current) {
      onTimerSyncRef.current({
        isRunning: false,
        mode: 'timer',
        remainingSeconds: next,
        totalSeconds: next,
        startedAt: null
      });
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentDisplaySeconds = getCurrentDisplaySeconds();

  // Progress ring math
  const progress = mode === 'timer' && totalSeconds > 0 ? (currentDisplaySeconds / totalSeconds) : 1;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;

  // Ring status color
  const ringColor = mode === 'timer' && currentDisplaySeconds <= 10
    ? 'text-rose-500'
    : mode === 'timer' && currentDisplaySeconds <= 30
    ? 'text-amber-500'
    : 'text-indigo-600';

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-scale-up select-none pointer-events-auto">
      <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-2xl rounded-3xl overflow-hidden w-72 transition-all">
        {/* Header Bar */}
        <div className="bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <TimerIcon className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="text-xs font-bold tracking-wide uppercase text-slate-200">
              Sprint Timer
            </span>
            {isReadOnly && (
              <span className="text-[9px] bg-indigo-950/90 text-indigo-300 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider border border-indigo-700/50">
                Teacher Managed
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title={soundEnabled ? 'Mute Sound Alert' : 'Enable Sound Alert'}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-rose-400" />}
            </button>
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
              title={isMinimized ? 'Expand Timer' : 'Minimize Timer'}
            >
              {isMinimized ? <Plus className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
            </button>
            {!isReadOnly && (
              <button
                onClick={onClose}
                className="p-1 hover:bg-rose-900/50 hover:text-rose-300 rounded-lg text-slate-400 transition-colors cursor-pointer"
                title="Close Timer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {!isMinimized && (
          <div className="p-4 flex flex-col items-center">
            {/* Mode Selector Tabs */}
            {!isReadOnly ? (
              <div className="flex items-center bg-slate-100 p-1 rounded-xl w-full mb-3 text-xs font-bold">
                <button
                  onClick={() => {
                    setMode('timer');
                    setIsRunning(false);
                    setStartedAt(null);
                  }}
                  className={`flex-1 py-1 rounded-lg transition-all cursor-pointer ${
                    mode === 'timer' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Timer
                </button>
                <button
                  onClick={() => {
                    setMode('stopwatch');
                    setIsRunning(false);
                    setStartedAt(null);
                  }}
                  className={`flex-1 py-1 rounded-lg transition-all cursor-pointer ${
                    mode === 'stopwatch' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Stopwatch
                </button>
              </div>
            ) : (
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                {mode === 'timer' ? 'Countdown Timer' : 'Stopwatch'}
              </div>
            )}

            {/* Circular Progress Display */}
            <div className="relative w-28 h-28 flex items-center justify-center my-1">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  className="stroke-slate-100"
                  strokeWidth="6"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  className={`${ringColor} transition-all duration-300`}
                  strokeWidth="6"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                {mode === 'timer' && !isRunning && !isReadOnly ? (
                  <div className="flex items-center space-x-0.5 text-2xl font-black font-mono tracking-tight text-slate-900 bg-slate-50/70 rounded-lg px-1.5 py-0.5 border border-slate-200/50">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={minInput}
                      onFocus={() => setIsEditingTime(true)}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setMinInput(val);
                      }}
                      onBlur={commitTimeInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-8 text-center bg-transparent border-none focus:outline-none focus:bg-indigo-50/80 rounded font-mono font-black"
                      title="Set minutes"
                    />
                    <span className="animate-pulse text-indigo-500/70">:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={secInput}
                      onFocus={() => setIsEditingTime(true)}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9]/g, '');
                        setSecInput(val);
                      }}
                      onBlur={commitTimeInput}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-8 text-center bg-transparent border-none focus:outline-none focus:bg-indigo-50/80 rounded font-mono font-black"
                      title="Set seconds"
                    />
                  </div>
                ) : (
                  <span className="text-2xl font-black font-mono tracking-tight text-slate-900">
                    {formatTime(currentDisplaySeconds)}
                  </span>
                )}
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                  {mode === 'timer' ? (isRunning ? 'Remaining' : isReadOnly ? 'Time Limit' : 'Edit Time') : 'Elapsed'}
                </span>
              </div>
            </div>

            {/* Read-Only Status or Interactive Control Buttons */}
            {isReadOnly ? (
              <div className="mt-3 w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-2.5 text-center flex flex-col items-center space-y-1">
                <span className="text-xs font-bold text-indigo-700 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                  <span>Controlled by Teacher</span>
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  {isRunning ? 'Timer is active' : 'Timer is currently paused'}
                </span>
              </div>
            ) : (
              <>
                {/* Control Buttons */}
                <div className="flex items-center space-x-2 mt-3 w-full">
                  <button
                    onClick={handleStartPause}
                    className={`flex-1 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center space-x-1.5 shadow-sm transition-all cursor-pointer ${
                      isRunning
                        ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20'
                    }`}
                  >
                    {isRunning ? (
                      <>
                        <Pause className="w-3.5 h-3.5 fill-current" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Start</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleReset}
                    className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors cursor-pointer flex items-center justify-center space-x-1"
                    title="Reset Timer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span className="text-xs font-bold">Reset</span>
                  </button>
                </div>

                {/* Quick Adjustments Subtraction & Addition Bar */}
                <div className="grid grid-cols-4 gap-1.5 w-full mt-3">
                  <button
                    onClick={() => handleAddSeconds(-60)}
                    disabled={mode === 'timer' && currentDisplaySeconds < 60}
                    className="py-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center"
                    title="Subtract 1 Minute"
                  >
                    -1m
                  </button>
                  <button
                    onClick={() => handleAddSeconds(-10)}
                    disabled={mode === 'timer' && currentDisplaySeconds < 10}
                    className="py-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center"
                    title="Subtract 10 Seconds"
                  >
                    -10s
                  </button>
                  <button
                    onClick={() => handleAddSeconds(10)}
                    className="py-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center"
                    title="Add 10 Seconds"
                  >
                    +10s
                  </button>
                  <button
                    onClick={() => handleAddSeconds(60)}
                    className="py-1 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center"
                    title="Add 1 Minute"
                  >
                    +1m
                  </button>
                </div>

                {/* Presets (Timer Mode only) */}
                {mode === 'timer' && (
                  <div className="grid grid-cols-4 gap-1.5 w-full mt-3 pt-3 border-t border-slate-100">
                    {[
                      { label: '1m', secs: 60 },
                      { label: '3m', secs: 180 },
                      { label: '5m', secs: 300 },
                      { label: '10m', secs: 600 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        onClick={() => handlePreset(p.secs)}
                        className={`py-1 rounded-lg text-xs font-extrabold border transition-all cursor-pointer ${
                          totalSeconds === p.secs
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

