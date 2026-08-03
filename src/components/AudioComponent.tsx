import React, { useState, useRef, useEffect } from "react";
import { AudioElement, UserProfile } from "../types";
import { Play, Pause, Mic, Trash2, Lock, Volume2, Clock } from "lucide-react";
import { useBoardAsset } from "../hooks/useBoardAsset";

interface AudioComponentProps {
  element: AudioElement;
  isSelected: boolean;
  isInteractive: boolean;
  boardId?: string;
  onSelect: (e: React.MouseEvent) => void;
  onUpdate: (updates: Partial<AudioElement>) => void;
  onDelete: () => void;
  currentUser?: UserProfile;
}

export default function AudioComponent({
  element,
  isSelected,
  isInteractive,
  boardId,
  onSelect,
  onUpdate,
  onDelete,
  currentUser,
}: AudioComponentProps) {
  const { data: audioDataUrl } = useBoardAsset(boardId, element.assetId, element.audioUrl);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioDataUrl) return;
    const audio = new Audio(audioDataUrl);
    audioRef.current = audio;

    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [audioDataUrl]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch((err) => console.error("Audio play error:", err));
      setIsPlaying(true);
    }
  };

  const formatDuration = (sec?: number) => {
    if (!sec) return "Voice Note";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div
      onPointerDown={onSelect}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        zIndex: element.zIndex || 10,
      }}
      className={`absolute left-0 top-0 cursor-pointer select-none group touch-none ${
        isSelected ? "ring-2 ring-amber-500 ring-offset-2 rounded-2xl shadow-lg" : ""
      }`}
    >
      <div className="bg-amber-500/95 hover:bg-amber-600 text-white backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-md border border-amber-400 flex items-center space-x-3 transition-all transform hover:scale-105">
        <button
          onClick={togglePlay}
          className="p-2 bg-white/20 hover:bg-white/30 rounded-xl transition-colors flex items-center justify-center shrink-0 cursor-pointer"
          title={isPlaying ? "Pause Voice Note" : "Play Voice Note"}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>

        <div className="flex flex-col pr-1">
          <div className="flex items-center space-x-1.5">
            <Mic className="w-3.5 h-3.5 text-amber-100" />
            <span className="text-xs font-bold text-white truncate max-w-[120px]">
              {element.authorName || "Voice Comment"}
            </span>
          </div>
          <span className="text-[10px] font-mono text-amber-100 flex items-center space-x-1">
            <Clock className="w-2.5 h-2.5 inline mr-0.5" />
            {formatDuration(element.duration)}
          </span>
        </div>

        {isSelected && isInteractive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 hover:bg-amber-700/50 rounded-lg text-amber-100 hover:text-white transition-colors"
            title="Delete Audio Comment"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
