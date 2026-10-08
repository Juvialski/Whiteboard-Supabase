import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Plus, Clock, Timer as TimerIcon, Volume2, VolumeX, X, Minus, Sparkles } from 'lucide-react';
import { timerSeconds, timerCompleted, type TimerState, type TimerAction } from '../services/timerState';
import { TimerAudio, soundPreference, saveSoundPreference, claimCompletion } from '../services/timerAudio';
import { getScopedBoardCacheKey } from '../utils/boardRecoveryCache';

interface WorkspaceTimerProps {
  isOpen: boolean;
  onClose: () => void;
  state: TimerState | null;
  serverNow: () => number;
  onAction: (action: TimerAction, value?: number) => Promise<void>;
  error?: string | null;
  busy?: boolean;
  isReadOnly?: boolean;
}
export default function WorkspaceTimer({ isOpen, onClose, state, serverNow, onAction, error, busy, isReadOnly = false }: WorkspaceTimerProps) {
  const [soundEnabled, setSoundEnabled] = useState(soundPreference);
  const [isMinimized, setIsMinimized] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [, setTick] = useState(0);
  const [minInput, setMinInput] = useState('05');
  const [secInput, setSecInput] = useState('00');
  const [isEditingTime, setIsEditingTime] = useState(false);
  const audio = useRef<TimerAudio | null>(null);
  if (!audio.current) audio.current = new TimerAudio();
  useEffect(() => {
    // StrictMode cleans up and re-runs effects, so recreate resources on setup.
    audio.current ??= new TimerAudio();
    return () => { const previous = audio.current; audio.current = null; void previous?.close(); };
  }, []);
  const currentDisplaySeconds = state ? timerSeconds(state, serverNow()) : 300;
  const completed = state ? timerCompleted(state, serverNow()) : false;
  const mode = state?.mode || 'timer';
  const totalSeconds = state?.total_seconds ?? 300;
  const isRunning = !!state?.running && !completed;
  const controlsDisabled = isReadOnly || busy || !state;
  useEffect(() => {
    if (!state?.running) return;
    const interval = setInterval(() => setTick(value => value + 1), 250);
    const resume = () => setTick(value => value + 1);
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', resume); };
  }, [state?.running]);
  useEffect(() => {
    if (!isEditingTime) {
      setMinInput(Math.floor(currentDisplaySeconds / 60).toString().padStart(2, '0'));
      setSecInput((currentDisplaySeconds % 60).toString().padStart(2, '0'));
    }
  }, [currentDisplaySeconds, isEditingTime]);
  useEffect(() => {
    if (!completed || !state) return;
    const identity = getScopedBoardCacheKey('pending', state.board_id);
    if (!identity) return;
    if (claimCompletion('timer_alarm_' + identity + '_' + state.run_id)) {
      if (soundEnabled && !audio.current?.play()) setAudioBlocked(true);
    }
  }, [completed, state?.run_id, state?.board_id, soundEnabled]);
  const unlock = async (test = false) => {
    const allowed = await audio.current?.unlock();
    setAudioBlocked(!allowed || (test && !audio.current?.play()));
  };
  const action = (name: TimerAction, value?: number) => {
    if (controlsDisabled) return;
    if (soundEnabled) void unlock();
    void onAction(name, value);
  };
  const handleStartPause = () => action(isRunning ? 'pause' : 'start');
  const handleReset = () => { setAudioBlocked(false); action('reset'); };
  const handlePreset = (seconds: number) => action('duration', seconds);
  const handleAddSeconds = (seconds: number) => action('adjust', seconds);
  const commitTimeInput = () => {
    if (!isEditingTime) return;
    setIsEditingTime(false);
    const minutes = Math.min(99, Math.max(0, parseInt(minInput) || 0));
    const seconds = Math.min(59, Math.max(0, parseInt(secInput) || 0));
    action('duration', minutes * 60 + seconds);
  };
  const formatTime = (secs: number) => Math.floor(secs / 60).toString().padStart(2, '0') + ':' + (secs % 60).toString().padStart(2, '0');
  const progress = mode === 'timer' && totalSeconds > 0 ? Math.min(1, currentDisplaySeconds / totalSeconds) : 1;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;
  const ringColor = mode === 'timer' && currentDisplaySeconds <= 10 ? 'text-rose-500'
    : mode === 'timer' && currentDisplaySeconds <= 30 ? 'text-amber-500' : 'text-indigo-600';
  if (!isOpen) return completed ? (
    <div role="status" className="fixed bottom-6 right-6 z-50 bg-white rounded-xl shadow-lg border border-rose-300 p-3 text-xs">
      <span className="text-rose-600 font-bold">Time is up{audioBlocked ? ' — sound unavailable' : ''}</span>
      <button className="ml-2 text-indigo-600" onClick={() => void unlock(true)}>Test Sound</button>
      {!isReadOnly && <button className="ml-2" disabled={busy} onClick={handleReset}>Reset</button>}
    </div>
  ) : null;
  return (
    <div className="fixed bottom-18 sm:bottom-6 right-3 sm:right-6 z-50 animate-scale-up select-none pointer-events-auto max-w-[calc(100vw-1.5rem)]">
      <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-2xl rounded-3xl overflow-hidden w-72 max-w-full transition-all">
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
              onClick={() => { const enabled = !soundEnabled; setSoundEnabled(enabled); saveSoundPreference(enabled); if (enabled) void unlock(); else void audio.current?.close(); }}
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
        {isMinimized && completed && <div role="status" className="p-2 text-xs text-rose-600">Time is up{audioBlocked ? ' — sound unavailable' : ''}</div>}

        {!isMinimized && (
          <div className="p-4 flex flex-col items-center">
            <button type="button" onClick={() => void unlock(true)} className="text-xs text-indigo-600 mb-2">Test Sound</button>
            {completed && <div role="status" className="text-rose-600 text-xs font-bold mb-2">Time is up{audioBlocked ? ' — sound unavailable; use Test Sound' : ''}</div>}
            {audioBlocked && !completed && <div role="status" className="text-xs mb-2">Sound unavailable. Check browser and tab audio settings.</div>}
            {error && <div role="alert" className="text-rose-600 text-xs mb-2">{error}</div>}
            {busy && <div role="status" className="text-xs mb-2">Saving timer…</div>}
            <fieldset disabled={controlsDisabled} className="contents">
            {/* Mode Selector Tabs */}
            {!isReadOnly ? (
              <div className="flex items-center bg-slate-100 p-1 rounded-xl w-full mb-3 text-xs font-bold">
                <button
                  onClick={() => {
                    action('mode', 0);
                  }}
                  className={`flex-1 py-1 rounded-lg transition-all cursor-pointer ${
                    mode === 'timer' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Timer
                </button>
                <button
                  onClick={() => {
                    action('mode', 1);
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
                      onBlur={(event) => {
                        if (!(event.relatedTarget instanceof HTMLInputElement) || !event.currentTarget.parentElement?.contains(event.relatedTarget)) commitTimeInput();
                      }}
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
                      onBlur={(event) => {
                        if (!(event.relatedTarget instanceof HTMLInputElement) || !event.currentTarget.parentElement?.contains(event.relatedTarget)) commitTimeInput();
                      }}
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
            </fieldset>
          </div>
        )}
      </div>
    </div>
  );
}

