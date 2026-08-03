import React, { useState, useRef, useEffect } from "react";
import { Mic, Square, Play, Pause, Trash2, Check, X, Volume2 } from "lucide-react";

interface VoiceRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAudio: (audioDataUrl: string, durationSec: number) => void;
}

export default function VoiceRecordModal({
  isOpen,
  onClose,
  onSaveAudio,
}: VoiceRecordModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(audioBlob);
        setAudioBlobUrl(url);

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          setAudioBase64(reader.result as string);
        };

        // Stop all audio track streams
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      alert("Microphone access was denied or is unavailable on this device.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const togglePreview = () => {
    if (!audioBlobUrl) return;
    if (!previewAudioRef.current) {
      const audio = new Audio(audioBlobUrl);
      previewAudioRef.current = audio;
      audio.onended = () => setIsPlaying(false);
    }

    if (isPlaying) {
      previewAudioRef.current.pause();
      setIsPlaying(false);
    } else {
      previewAudioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleConfirm = () => {
    if (audioBase64) {
      onSaveAudio(audioBase64, recordingTime);
      onClose();
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl w-full max-w-sm p-6 flex flex-col items-center space-y-5">
        <div className="flex items-center justify-between w-full border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2 text-amber-600">
            <Mic className="w-5 h-5" />
            <span className="font-extrabold text-sm text-slate-800">Record Voice Comment</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Timer / Waveform Display */}
        <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-200/80 rounded-2xl w-full space-y-2">
          <span className="text-3xl font-black font-mono text-slate-800 tracking-wider">
            {formatTime(recordingTime)}
          </span>
          <span className="text-xs text-slate-400 font-medium">
            {isRecording ? "Recording in progress..." : audioBase64 ? "Recording complete!" : "Ready to record"}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-4">
          {!isRecording && !audioBase64 && (
            <button
              onClick={startRecording}
              className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-md transition-all flex items-center space-x-2 cursor-pointer"
            >
              <Mic className="w-5 h-5 animate-pulse" />
              <span>Start Recording</span>
            </button>
          )}

          {isRecording && (
            <button
              onClick={stopRecording}
              className="px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl shadow-md transition-all flex items-center space-x-2 cursor-pointer"
            >
              <Square className="w-5 h-5" />
              <span>Stop Recording</span>
            </button>
          )}

          {audioBase64 && !isRecording && (
            <div className="flex items-center space-x-2">
              <button
                onClick={togglePreview}
                className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl transition-colors cursor-pointer"
                title="Preview"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={() => {
                  setAudioBase64(null);
                  setAudioBlobUrl(null);
                  setRecordingTime(0);
                }}
                className="p-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-2xl transition-colors cursor-pointer"
                title="Re-record"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleConfirm}
                className="px-5 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-5 h-5" />
                <span>Attach Note</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
