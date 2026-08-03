import React, { useState, useRef, useEffect } from "react";
import { StampElement } from "../types";
import { 
  Stamp, 
  CheckCircle2, 
  Star, 
  Award, 
  AlertCircle, 
  FileCheck, 
  X, 
  Trash2, 
  Check, 
  Palette, 
  Smile, 
  Square,
  Circle,
  Shield,
  Gem,
  Bookmark,
  Sparkles,
  Key,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Heart,
  Hexagon,
  Ribbon,
  Crown
} from "lucide-react";

interface StampPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStamp: (
    stampType: StampElement["stampType"],
    label?: string,
    signatureUrl?: string,
    color?: string,
    stampShape?: StampElement["stampShape"]
  ) => void;
}

const PASTEL_COLORS = [
  { hex: "#fef08a", name: "Yellow" },
  { hex: "#fbcfe8", name: "Pink" },
  { hex: "#bfdbfe", name: "Blue" },
  { hex: "#bbf7d0", name: "Green" },
  { hex: "#fed7aa", name: "Orange" },
  { hex: "#e9d5ff", name: "Purple" },
  { hex: "#99f6e4", name: "Teal" },
  { hex: "#fecaca", name: "Red" },
];

const PRESET_EMOJIS = ["👍", "❤️", "🔥", "💡", "🌟", "🚀", "🦖", "🍎", "📚", "🎨", "🧪", "🏆", "✅", "❌", "🧠", "🎯", "✍️", "✨", "💯", "🎈", "🔬", "📐", "🏛️", "🏅"];

export function getShapeClipping(shape?: StampElement["stampShape"]) {
  let clipPath = "";
  let shapeClass = "rounded-2xl";

  switch (shape) {
    case "circle":
      shapeClass = "rounded-full";
      break;
    case "star":
      clipPath = "polygon(50% 0%, 63% 13%, 80% 6%, 82% 24%, 100% 25%, 94% 43%, 100% 60%, 82% 64%, 80% 82%, 63% 79%, 50% 100%, 37% 79%, 20% 82%, 18% 64%, 0% 60%, 6% 43%, 0% 25%, 18% 24%, 20% 6%, 37% 13%)";
      shapeClass = "";
      break;
    case "badge":
      clipPath = "polygon(0% 0%, 100% 0%, 100% 75%, 50% 100%, 0% 75%)";
      shapeClass = "";
      break;
    case "diamond":
      clipPath = "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
      shapeClass = "";
      break;
    case "banner":
      clipPath = "polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)";
      shapeClass = "";
      break;
    case "hexagon":
      clipPath = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
      shapeClass = "";
      break;
    case "ribbon":
      clipPath = "polygon(0% 0%, 100% 0%, 88% 50%, 100% 100%, 0% 100%, 12% 50%)";
      shapeClass = "";
      break;
    case "heart":
      clipPath = "polygon(50% 85%, 15% 55%, 0% 30%, 15% 5%, 40% 5%, 50% 25%, 60% 5%, 85% 5%, 100% 30%, 85% 55%)";
      shapeClass = "";
      break;
    case "shield":
      clipPath = "polygon(0% 0%, 100% 0%, 100% 65%, 50% 100%, 0% 65%)";
      shapeClass = "";
      break;
    case "crest":
      clipPath = "polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 50% 100%, 0% 80%, 0% 20%)";
      shapeClass = "";
      break;
    default:
      shapeClass = "rounded-2xl";
      break;
  }

  return { clipPath, shapeClass };
}

interface PresetStampItem {
  type: StampElement["stampType"];
  label: string;
  category: "grading" | "praise" | "status" | "stem";
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  shape: StampElement["stampShape"];
}

const PRESET_STAMPS: PresetStampItem[] = [
  // Grading & Feedback
  { type: "checked", label: "Checked ✔", category: "grading", icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />, color: "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100", bgColor: "#10b981", shape: "rounded-rect" },
  { type: "grade_a", label: "Grade A+", category: "grading", icon: <span className="font-black text-lg text-emerald-600">A+</span>, color: "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100", bgColor: "#059669", shape: "shield" },
  { type: "needs_revision", label: "Needs Revision", category: "grading", icon: <AlertCircle className="w-5 h-5 text-rose-500" />, color: "border-rose-200 bg-rose-50/80 hover:bg-rose-100", bgColor: "#f43f5e", shape: "rounded-rect" },
  { type: "custom", label: "💯 100% Perfect", category: "grading", icon: <span className="text-base">💯</span>, color: "border-emerald-200 bg-emerald-50/80 hover:bg-emerald-100", bgColor: "#bbf7d0", shape: "badge" },
  { type: "custom", label: "🌟 Extra Credit", category: "grading", icon: <Star className="w-5 h-5 text-purple-600 fill-purple-200" />, color: "border-purple-200 bg-purple-50/80 hover:bg-purple-100", bgColor: "#e9d5ff", shape: "star" },
  { type: "custom", label: "📝 Submit Again", category: "grading", icon: <span className="text-base">📝</span>, color: "border-orange-200 bg-orange-50/80 hover:bg-orange-100", bgColor: "#fed7aa", shape: "banner" },

  // Praise & Rewards
  { type: "star", label: "Gold Star ★", category: "praise", icon: <Star className="w-5 h-5 text-amber-500 fill-amber-400" />, color: "border-amber-200 bg-amber-50/80 hover:bg-amber-100", bgColor: "#fbbf24", shape: "star" },
  { type: "great_job", label: "Great Job!", category: "praise", icon: <Award className="w-5 h-5 text-blue-600" />, color: "border-blue-200 bg-blue-50/80 hover:bg-blue-100", bgColor: "#3b82f6", shape: "badge" },
  { type: "custom", label: "💡 Brilliant Idea", category: "praise", icon: <span className="text-base">💡</span>, color: "border-yellow-200 bg-yellow-50/80 hover:bg-yellow-100", bgColor: "#fef08a", shape: "diamond" },
  { type: "custom", label: "🧠 Genius Level", category: "praise", icon: <span className="text-base">🧠</span>, color: "border-purple-200 bg-purple-50/80 hover:bg-purple-100", bgColor: "#e9d5ff", shape: "circle" },
  { type: "custom", label: "✋ High Five!", category: "praise", icon: <span className="text-base">✋</span>, color: "border-pink-200 bg-pink-50/80 hover:bg-pink-100", bgColor: "#fbcfe8", shape: "heart" },
  { type: "custom", label: "🥇 Champion", category: "praise", icon: <Crown className="w-5 h-5 text-amber-600" />, color: "border-amber-200 bg-amber-50/80 hover:bg-amber-100", bgColor: "#fef08a", shape: "crest" },
  { type: "custom", label: "🚀 Super Star", category: "praise", icon: <span className="text-base">🚀</span>, color: "border-blue-200 bg-blue-50/80 hover:bg-blue-100", bgColor: "#bfdbfe", shape: "star" },

  // Status & Verification
  { type: "approved", label: "Approved", category: "status", icon: <FileCheck className="w-5 h-5 text-teal-600" />, color: "border-teal-200 bg-teal-50/80 hover:bg-teal-100", bgColor: "#0d9488", shape: "crest" },
  { type: "custom", label: "🛡️ Verified", category: "status", icon: <Shield className="w-5 h-5 text-sky-600" />, color: "border-sky-200 bg-sky-50/80 hover:bg-sky-100", bgColor: "#bfdbfe", shape: "shield" },
  { type: "custom", label: "🔒 Top Secret", category: "status", icon: <span className="text-base">🔒</span>, color: "border-red-200 bg-red-50/80 hover:bg-red-100", bgColor: "#fecaca", shape: "crest" },
  { type: "custom", label: "📑 Draft Review", category: "status", icon: <span className="text-base">📑</span>, color: "border-orange-200 bg-orange-50/80 hover:bg-orange-100", bgColor: "#fed7aa", shape: "banner" },
  { type: "custom", label: "🚫 Confidential", category: "status", icon: <span className="text-base">🚫</span>, color: "border-rose-200 bg-rose-50/80 hover:bg-rose-100", bgColor: "#fecaca", shape: "hexagon" },

  // STEM & Learning
  { type: "custom", label: "📐 Math Wizard", category: "stem", icon: <span className="text-base">📐</span>, color: "border-indigo-200 bg-indigo-50/80 hover:bg-indigo-100", bgColor: "#bfdbfe", shape: "hexagon" },
  { type: "custom", label: "🧪 Lab Verified", category: "stem", icon: <span className="text-base">🧪</span>, color: "border-teal-200 bg-teal-50/80 hover:bg-teal-100", bgColor: "#99f6e4", shape: "badge" },
  { type: "custom", label: "🎨 Creative Spark", category: "stem", icon: <span className="text-base">🎨</span>, color: "border-pink-200 bg-pink-50/80 hover:bg-pink-100", bgColor: "#fbcfe8", shape: "ribbon" },
  { type: "custom", label: "💻 Code Master", category: "stem", icon: <span className="text-base">💻</span>, color: "border-slate-200 bg-slate-100 hover:bg-slate-200", bgColor: "#e2e8f0", shape: "rounded-rect" },
];

export default function StampPickerModal({
  isOpen,
  onClose,
  onSelectStamp,
}: StampPickerModalProps) {
  const [activeTab, setActiveTab] = useState<"stamps" | "custom" | "ai" | "signature">("stamps");
  const [presetCategory, setPresetCategory] = useState<"all" | "grading" | "praise" | "status" | "stem">("all");
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);

  // Customizer State
  const [customEmoji, setCustomEmoji] = useState("👍");
  const [customText, setCustomText] = useState("Reviewed");
  const [selectedColor, setSelectedColor] = useState("#bbf7d0");
  const [selectedShape, setSelectedShape] = useState<StampElement["stampShape"]>("rounded-rect");

  // AI Generator State
  const [aiApiKey, setAiApiKey] = useState(() => localStorage.getItem("lucid_spark_user_gemini_key") || "");
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("Science experiment feedback with rocket or atom");
  const [aiShape, setAiShape] = useState<string>("any");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generatedAiStamps, setGeneratedAiStamps] = useState<Array<{
    label: string;
    emoji: string;
    color: string;
    shape: StampElement["stampShape"];
    description?: string;
  }>>([]);

  useEffect(() => {
    if (activeTab === "signature" && canvasRef.current) {
      clearSigCanvas();
    }
  }, [activeTab]);

  const handleSaveApiKey = (val: string) => {
    setAiApiKey(val);
    localStorage.setItem("lucid_spark_user_gemini_key", val.trim());
  };

  if (!isOpen) return null;

  const startDrawingSig = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    ctx.strokeStyle = "#1e1b4b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    setIsDrawingSig(true);
  };

  const drawSig = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
    ctx.stroke();
  };

  const startDrawingSigTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    ctx.strokeStyle = "#1e1b4b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
    setIsDrawingSig(true);
  };

  const drawSigTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    ctx.lineTo((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
    ctx.stroke();
  };

  const stopDrawingSig = () => {
    setIsDrawingSig(false);
  };

  const clearSigCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSelectStamp("signature", "Teacher Signature", dataUrl);
    onClose();
  };

  const placeCustomStamp = () => {
    const compositeLabel = `${customEmoji} ${customText}`.trim();
    onSelectStamp("custom", compositeLabel, undefined, selectedColor, selectedShape);
    onClose();
  };

  const handleGenerateAiStamps = async () => {
    if (!aiApiKey.trim()) {
      setAiError("Please enter your Google AI Studio API key to generate stamps.");
      return;
    }

    setIsGeneratingAi(true);
    setAiError(null);

    try {
      const res = await fetch("/api/ai/stamp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: aiPrompt,
          apiKey: aiApiKey.trim(),
          preferredShape: aiShape,
          count: 4
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setAiError(data.message || data.error || "Failed to generate stamps. Please verify your API key.");
        setIsGeneratingAi(false);
        return;
      }

      setGeneratedAiStamps(data.stamps || []);
    } catch (err: any) {
      setAiError(err.message || "Network error while connecting to AI Stamp Generator.");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const filteredPresets = presetCategory === "all" 
    ? PRESET_STAMPS 
    : PRESET_STAMPS.filter(s => s.category === presetCategory);

  const { clipPath: customClipPath, shapeClass: customShapeClass } = getShapeClipping(selectedShape);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl w-full max-w-lg p-6 flex flex-col space-y-4 max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2 text-indigo-600">
            <Stamp className="w-5 h-5" />
            <span className="font-extrabold text-sm text-slate-800">Educational Stamps & Signatures</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-slate-100 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab("stamps")}
            className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
              activeTab === "stamps" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Presets
          </button>
          <button
            onClick={() => setActiveTab("custom")}
            className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
              activeTab === "custom" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Custom Stamp
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition-colors cursor-pointer flex items-center justify-center space-x-1 ${
              activeTab === "ai" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>AI Stamps</span>
          </button>
          <button
            onClick={() => setActiveTab("signature")}
            className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
              activeTab === "signature" ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Signature
          </button>
        </div>

        {/* Tab 1: Presets Collection */}
        {activeTab === "stamps" && (
          <div className="flex flex-col space-y-3 overflow-y-auto max-h-[60vh] pr-1">
            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
              {[
                { id: "all", label: "All Stamps" },
                { id: "grading", label: "Grading & Feedback" },
                { id: "praise", label: "Praise & Rewards" },
                { id: "status", label: "Status & Badges" },
                { id: "stem", label: "STEM & Subjects" },
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setPresetCategory(cat.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    presetCategory === cat.id 
                      ? "bg-indigo-600 text-white shadow-xs" 
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
              {filteredPresets.map((s, idx) => {
                const { clipPath, shapeClass } = getShapeClipping(s.shape);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      onSelectStamp(s.type, s.label, undefined, s.bgColor, s.shape);
                      onClose();
                    }}
                    className={`p-3 border rounded-2xl flex flex-col items-center justify-center space-y-1.5 transition-all cursor-pointer transform hover:scale-102 ${s.color}`}
                  >
                    <div 
                      style={{ 
                        backgroundColor: s.bgColor,
                        clipPath: clipPath || undefined,
                      }} 
                      className={`w-full h-10 ${shapeClass} flex items-center justify-center p-1 shadow-xs border border-slate-300/30`}
                    >
                      <div className="flex items-center space-x-1 font-black text-xs text-slate-900 truncate">
                        {s.icon}
                      </div>
                    </div>
                    <span className="font-extrabold text-[11px] text-slate-800 truncate max-w-full">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Custom Stamp Creator */}
        {activeTab === "custom" && (
          <div className="flex flex-col space-y-4 pt-1 overflow-y-auto max-h-[60vh] pr-1">
            {/* Stamp Live Preview */}
            <div className="flex flex-col items-center justify-center p-4 border border-slate-100 bg-slate-50/50 rounded-2xl space-y-2 min-h-[140px]">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Stamp Live Preview</span>
              <div 
                style={{ 
                  backgroundColor: selectedColor,
                  clipPath: customClipPath ? customClipPath : undefined,
                }}
                className={`w-48 h-16 ${customShapeClass} border-2 border-slate-300/40 shadow-md flex items-center justify-center p-3 transition-all duration-150`}
              >
                <div className="flex items-center space-x-1.5 max-w-full font-black text-slate-900 uppercase tracking-wider truncate text-center">
                  <span className="text-xl leading-none">{customEmoji}</span>
                  <span className="truncate max-w-[120px] leading-tight text-xs sm:text-sm">{customText || "Stamp"}</span>
                </div>
              </div>
            </div>

            {/* Customizer Inputs */}
            <div className="flex flex-col space-y-3 bg-white p-3 border border-slate-200/60 rounded-2xl">
              {/* Emoji Row */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-slate-600 flex items-center space-x-1">
                  <Smile className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Choose Emoji</span>
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto p-1 bg-slate-50 rounded-xl border border-slate-100">
                  {PRESET_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => setCustomEmoji(emoji)}
                      className={`w-7 h-7 rounded-lg hover:bg-white flex items-center justify-center text-base transition-all transform active:scale-95 cursor-pointer ${
                        customEmoji === emoji ? "bg-white ring-2 ring-indigo-500 shadow-xs scale-105" : ""
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stamp Text */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-slate-600">Stamp Text</label>
                <input
                  type="text"
                  maxLength={20}
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., Reviewed, Good Effort..."
                />
              </div>

              {/* Shape Selection (All 11 shapes) */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-slate-600 flex items-center space-x-1">
                  <Stamp className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Stamp Shape</span>
                </label>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {[
                    { id: "rounded-rect", label: "Badge", icon: <Square className="w-3.5 h-3.5" /> },
                    { id: "circle", label: "Circle", icon: <Circle className="w-3.5 h-3.5" /> },
                    { id: "star", label: "Star", icon: <Star className="w-3.5 h-3.5" /> },
                    { id: "shield", label: "Shield", icon: <Shield className="w-3.5 h-3.5" /> },
                    { id: "badge", label: "Ribbon", icon: <Ribbon className="w-3.5 h-3.5" /> },
                    { id: "diamond", label: "Diamond", icon: <Gem className="w-3.5 h-3.5" /> },
                    { id: "hexagon", label: "Hexagon", icon: <Hexagon className="w-3.5 h-3.5" /> },
                    { id: "heart", label: "Heart", icon: <Heart className="w-3.5 h-3.5" /> },
                    { id: "crest", label: "Crest", icon: <Crown className="w-3.5 h-3.5" /> },
                    { id: "banner", label: "Plaque", icon: <Bookmark className="w-3.5 h-3.5" /> },
                  ].map((sOpt) => (
                    <button
                      key={sOpt.id}
                      type="button"
                      onClick={() => setSelectedShape(sOpt.id as any)}
                      className={`py-1.5 px-1 border rounded-xl flex flex-col items-center justify-center space-y-0.5 transition-all cursor-pointer ${
                        selectedShape === sOpt.id
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-extrabold shadow-xs"
                          : "border-slate-200 bg-slate-50/50 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {sOpt.icon}
                      <span className="text-[9px] truncate tracking-tighter leading-none">{sOpt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pastel Theme Palette */}
              <div className="flex flex-col space-y-1.5">
                <label className="text-xs font-bold text-slate-600 flex items-center space-x-1">
                  <Palette className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Pastel Theme</span>
                </label>
                <div className="grid grid-cols-8 gap-2">
                  {PASTEL_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => setSelectedColor(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`h-7 w-full rounded-lg border transition-all cursor-pointer relative flex items-center justify-center ${
                        selectedColor === c.hex
                          ? "ring-2 ring-indigo-600 ring-offset-1 border-white scale-105"
                          : "border-slate-200/50 hover:scale-105"
                      }`}
                      title={c.name}
                    >
                      {selectedColor === c.hex && (
                        <Check className="w-3.5 h-3.5 text-slate-800 stroke-[3px]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={placeCustomStamp}
              disabled={!customText.trim()}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-1.5 cursor-pointer mt-1"
            >
              <Check className="w-4 h-4" />
              <span>Place Custom Stamp</span>
            </button>
          </div>
        )}

        {/* Tab 3: AI Stamps Generator */}
        {activeTab === "ai" && (
          <div className="flex flex-col space-y-3.5 pt-1 overflow-y-auto max-h-[65vh] pr-1">
            
            {/* Google AI Studio API Key Notice & Input */}
            <div className="bg-slate-50 p-3 border border-slate-200/80 rounded-2xl flex flex-col space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-500" />
                  <span>Google AI Studio API Key</span>
                </label>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 underline cursor-pointer"
                >
                  <span>Get API Key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={aiApiKey}
                  onChange={(e) => handleSaveApiKey(e.target.value)}
                  placeholder="Paste AI Studio API Key here (AI Studio / Gemini API)"
                  className="w-full pl-3 pr-9 py-1.5 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              {!aiApiKey.trim() && (
                <div className="p-2.5 bg-amber-50/90 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 leading-relaxed flex flex-col space-y-1.5">
                  <span className="font-semibold">
                    🔑 AI Stamp Generation requires your Google AI Studio API Key.
                  </span>
                  <div className="flex items-center space-x-2">
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg shadow-xs transition-colors inline-flex items-center space-x-1 cursor-pointer"
                    >
                      <span>Get Free Key at Google AI Studio</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Prompt & Options */}
            <div className="flex flex-col space-y-2.5 bg-white p-3 border border-slate-200/80 rounded-2xl">
              <label className="text-xs font-bold text-slate-700 flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span>Stamp Prompt or Subject</span>
              </label>

              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., Astronomy homework, Math Olympiad, Creative Writing..."
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              {/* Quick Prompt Pills */}
              <div className="flex flex-wrap gap-1">
                {[
                  "Math Genius 📐",
                  "Science Fair 🧪",
                  "Top Reader 📚",
                  "Code Master 💻",
                  "Artistic Excellence 🎨",
                  "History Buff 🏛️"
                ].map((pill) => (
                  <button
                    key={pill}
                    onClick={() => setAiPrompt(pill)}
                    className="px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-[10px] font-bold text-slate-600 rounded-md transition-colors cursor-pointer"
                  >
                    {pill}
                  </button>
                ))}
              </div>

              {/* Preferred Shape */}
              <div className="flex flex-col space-y-1 pt-1">
                <label className="text-[11px] font-bold text-slate-600">Preferred Shape Variation</label>
                <select
                  value={aiShape}
                  onChange={(e) => setAiShape(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="any">✨ Any Shape (AI Choice)</option>
                  <option value="star">★ Star Shape</option>
                  <option value="circle">● Circle</option>
                  <option value="badge">🛡️ Shield / Ribbon</option>
                  <option value="diamond">◆ Diamond</option>
                  <option value="hexagon">⬡ Hexagon</option>
                  <option value="heart">♥ Heart</option>
                  <option value="crest">👑 Crest</option>
                  <option value="banner">🔖 Plaque / Banner</option>
                </select>
              </div>

              <button
                onClick={handleGenerateAiStamps}
                disabled={isGeneratingAi || !aiApiKey.trim() || !aiPrompt.trim()}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer mt-1"
              >
                {isGeneratingAi ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>Designing AI Stamps with Gemini...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Generate AI Stamp Set</span>
                  </>
                )}
              </button>
            </div>

            {/* Error Message */}
            {aiError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 leading-relaxed flex flex-col space-y-1">
                <span className="font-bold">⚠️ AI Stamp Error</span>
                <span>{aiError}</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-bold text-rose-900 underline hover:text-rose-950 flex items-center space-x-1 pt-1"
                >
                  <span>Verify or get your Google AI Studio API Key ↗</span>
                </a>
              </div>
            )}

            {/* Generated AI Stamps Grid */}
            {generatedAiStamps.length > 0 && (
              <div className="flex flex-col space-y-2 pt-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Generated AI Stamps (Click to Place)</span>
                <div className="grid grid-cols-2 gap-2.5">
                  {generatedAiStamps.map((st, i) => {
                    const { clipPath, shapeClass } = getShapeClipping(st.shape);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          onSelectStamp("custom", `${st.emoji} ${st.label}`, undefined, st.color, st.shape);
                          onClose();
                        }}
                        className="p-3 border border-slate-200 bg-slate-50/80 hover:bg-indigo-50/50 hover:border-indigo-300 rounded-2xl flex flex-col items-center justify-center space-y-2 transition-all transform hover:scale-102 cursor-pointer shadow-xs"
                      >
                        <div 
                          style={{ 
                            backgroundColor: st.color,
                            clipPath: clipPath || undefined,
                          }}
                          className={`w-full h-12 ${shapeClass} flex items-center justify-center p-1.5 shadow-xs border border-slate-300/40`}
                        >
                          <div className="flex items-center space-x-1 font-black text-xs text-slate-900 truncate">
                            <span className="text-base">{st.emoji}</span>
                            <span className="truncate max-w-[90px]">{st.label}</span>
                          </div>
                        </div>
                        {st.description && (
                          <span className="text-[10px] text-slate-500 text-center leading-tight italic truncate max-w-full">
                            {st.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {/* Tab 4: Signature Drawing */}
        {activeTab === "signature" && (
          <div className="flex flex-col space-y-3 pt-1">
            <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-1 relative">
              <canvas
                ref={canvasRef}
                width={360}
                height={140}
                onMouseDown={startDrawingSig}
                onMouseMove={drawSig}
                onMouseUp={stopDrawingSig}
                onMouseLeave={stopDrawingSig}
                onTouchStart={startDrawingSigTouch}
                onTouchMove={drawSigTouch}
                onTouchEnd={stopDrawingSig}
                className="w-full h-36 bg-white rounded-xl cursor-crosshair touch-none"
              />
              <span className="absolute bottom-2 left-3 text-[10px] text-slate-400 font-mono select-none">
                Sign above with cursor or touch
              </span>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={clearSigCanvas}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-rose-600 font-bold transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
              <button
                onClick={saveSignature}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Place Signature</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
