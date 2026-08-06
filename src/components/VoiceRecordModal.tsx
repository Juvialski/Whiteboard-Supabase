import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Square, Play, Pause, Trash2, Check, X } from "lucide-react";

interface VoiceRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAudio: (audioDataUrl: string, durationSec: number) => void;
}

const MAX_RECORDING_SECONDS = 5 * 60;

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
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopMediaTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const releasePreview = useCallback(() => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setIsPlaying(false);
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    setAudioBlobUrl(null);
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setIsRecording(false);
    clearTimer();
  }, [clearTimer]);

  const cleanup = useCallback(() => {
    clearTimer();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    stopMediaTracks();
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
  }, [clearTimer, stopMediaTracks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (!isOpen) cleanup();
  }, [isOpen, cleanup]);

  if (!isOpen) return null;

  const startRecording = async () => {
    try {
      releasePreview();
      setAudioBase64(null);
      setRecordingTime(0);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const preferredMimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(type));
      if (!preferredMimeType) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('This browser cannot record in a supported WebM or Ogg audio format.');
      }
      const mediaRecorder = new MediaRecorder(stream, { mimeType: preferredMimeType });

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        clearTimer();
        stopMediaTracks();
        mediaRecorderRef.current = null;
        if (!mountedRef.current) return;

        const mimeType = mediaRecorder.mimeType || audioChunksRef.current[0]?.type || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (!audioBlob.size) {
          setAudioBase64(null);
          return;
        }

        releasePreview();
        const url = URL.createObjectURL(audioBlob);
        blobUrlRef.current = url;
        setAudioBlobUrl(url);

        const reader = new FileReader();
        reader.onloadend = () => {
          if (mountedRef.current && typeof reader.result === "string") setAudioBase64(reader.result);
        };
        reader.onerror = () => {
          if (mountedRef.current) setAudioBase64(null);
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start(1_000);
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setRecordingTime((previous) => {
          const next = Math.min(previous + 1, MAX_RECORDING_SECONDS);
          if (next >= MAX_RECORDING_SECONDS) {
            const activeRecorder = mediaRecorderRef.current;
            if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop();
            setIsRecording(false);
            clearTimer();
          }
          return next;
        });
      }, 1_000);
    } catch (error) {
      stopMediaTracks();
      console.error("Microphone access error:", error);
      alert(error instanceof Error
        ? error.message
        : "Microphone access was denied or is unavailable on this device.");
    }
  };

  const togglePreview = async () => {
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
      try {
        await previewAudioRef.current.play();
        setIsPlaying(true);
      } catch (error) {
        console.warn("Audio preview could not start.", error);
      }
    }
  };

  const resetRecording = () => {
    releasePreview();
    setAudioBase64(null);
    setRecordingTime(0);
  };

  const handleConfirm = () => {
    if (!audioBase64) return;
    onSaveAudio(audioBase64, recordingTime);
    cleanup();
    onClose();
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${remainder < 10 ? "0" : ""}${remainder}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl w-full max-w-sm p-6 flex flex-col items-center space-y-5">
        <div className="flex items-center justify-between w-full border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2 text-amber-600">
            <Mic className="w-5 h-5" />
            <span className="font-extrabold text-sm text-slate-800">Record Voice Comment</span>
          </div>
          <button onClick={handleClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600" aria-label="Close voice recorder">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-200/80 rounded-2xl w-full space-y-2">
          <span className="text-3xl font-black font-mono text-slate-800 tracking-wider">
            {formatTime(recordingTime)}
          </span>
          <span className="text-xs text-slate-400 font-medium">
            {isRecording
              ? `Recording in progress… (maximum ${Math.floor(MAX_RECORDING_SECONDS / 60)} minutes)`
              : audioBase64
                ? "Recording complete!"
                : "Ready to record"}
          </span>
        </div>

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
                onClick={resetRecording}
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
