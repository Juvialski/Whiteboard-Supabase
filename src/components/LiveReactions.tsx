import React, { useState, useEffect, useCallback } from 'react';
import { Smile, Sparkles } from 'lucide-react';

export interface FloatingReaction {
  id: string;
  emoji: string;
  userName?: string;
  color?: string;
  x: number;
  y: number;
  createdAt: number;
}

interface LiveReactionsProps {
  onSendReaction: (emoji: string) => void;
  incomingReaction?: FloatingReaction | null;
}

export const EMOJI_OPTIONS = ['👍', '❤️', '💡', '👏', '🙋‍♂️', '🎯', '🚀', '⭐'];

export default function LiveReactions({ onSendReaction, incomingReaction }: LiveReactionsProps) {
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const addReaction = useCallback((reaction: FloatingReaction) => {
    setReactions((prev) => [...prev, reaction]);
  }, []);

  useEffect(() => {
    if (incomingReaction) {
      addReaction(incomingReaction);
    }
  }, [incomingReaction, addReaction]);

  // Clean up finished reactions after 2.5 seconds
  useEffect(() => {
    if (reactions.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setReactions((prev) => prev.filter((r) => now - r.createdAt < 2500));
    }, 500);
    return () => clearInterval(timer);
  }, [reactions.length]);

  const handleTrigger = (emoji: string) => {
    onSendReaction(emoji);
    addReaction({
      id: `local-${Date.now()}-${Math.random()}`,
      emoji,
      x: window.innerWidth / 2 + (Math.random() * 120 - 60),
      y: window.innerHeight - 100,
      createdAt: Date.now(),
    });
  };

  return (
    <>
      {/* Floating Animated Bubbles */}
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        {reactions.map((r) => {
          const age = Date.now() - r.createdAt;
          const progress = Math.min(1, age / 2500);
          const translateY = -progress * 240;
          const opacity = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
          const scale = 1 + Math.sin(progress * Math.PI) * 0.3;

          return (
            <div
              key={r.id}
              className="absolute transition-transform flex flex-col items-center pointer-events-none"
              style={{
                left: `${r.x}px`,
                top: `${r.y}px`,
                transform: `translate(-50%, ${translateY}px) scale(${scale})`,
                opacity,
              }}
            >
              <div className="text-3xl select-none filter drop-shadow-md animate-bounce">
                {r.emoji}
              </div>
              {r.userName && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white shadow-xs mt-1"
                  style={{ backgroundColor: r.color || '#4f46e5' }}
                >
                  {r.userName}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Reaction Launcher */}
      <div className="fixed bottom-6 right-6 z-30 flex items-center space-x-1.5">
        {isOpen && (
          <div className="bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-2xl rounded-2xl p-1.5 flex items-center space-x-1 animate-in fade-in zoom-in-95 duration-150">
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleTrigger(emoji)}
                className="w-8 h-8 flex items-center justify-center text-lg hover:scale-125 active:scale-95 transition-transform rounded-xl hover:bg-slate-100 cursor-pointer"
                title={`Send ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-10 h-10 rounded-2xl flex items-center justify-center border shadow-lg transition-all cursor-pointer ${
            isOpen
              ? 'bg-indigo-600 border-indigo-700 text-white shadow-indigo-200 scale-105'
              : 'bg-white/95 backdrop-blur-md border-slate-200/90 text-slate-700 hover:bg-slate-50'
          }`}
          title="Live Reactions"
        >
          <Smile className="w-5 h-5" />
        </button>
      </div>
    </>
  );
}
