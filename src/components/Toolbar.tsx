import React, { useState, useEffect } from "react";
import {
  MousePointer,
  Hand,
  Pen,
  Highlighter,
  StickyNote,
  Square,
  Circle,
  Triangle,
  CornerDownRight,
  Type,
  Eraser,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronRight,
  ArrowRight,
  Grid,
  Hexagon,
  TrendingUp,
  Zap,
  ChevronLeft,
  Eye,
  EyeOff,
  PenTool,
  Keyboard,
  Flame,
  Timer as TimerIcon,
  Video,
  Mic,
  Stamp,
  Calculator,
  Settings,
  X,
  HelpCircle,
  MoreHorizontal,
  LayoutGrid,
  Table as TableIcon,
} from "lucide-react";
import { ShapeType } from "../types";

export type Tool =
  | "select"
  | "pan"
  | "pencil"
  | "highlighter"
  | "sticky"
  | "shape"
  | "cartesian"
  | "numberline"
  | "advanced-cartesian"
  | "text"
  | "eraser"
  | "connector"
  | "laser"
  | "audio"
  | "stamp"
  | "math"
  | "table";

interface ToolbarProps {
  activeTool: Tool;
  onChangeTool: (tool: Tool) => void;
  activeColor: string;
  onChangeColor: (color: string) => void;
  activeShape: ShapeType;
  onChangeShape: (shape: ShapeType) => void;
  onClearBoard: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  strokeWidth: number;
  onChangeStrokeWidth: (width: number) => void;
  gridMode: "dots" | "math" | "none";
  onChangeGridMode: (mode: "dots" | "math" | "none") => void;
  hasSelection?: boolean;
  hasColorableSelection?: boolean;
  hasStampSelection?: boolean;
  selectedStampShape?: string;
  onChangeStampShape?: (shape: string) => void;
  isPdfMode?: boolean;
  isZenMode?: boolean;
  onToggleZenMode?: () => void;
  isTopBarHidden?: boolean;
  onOpenShortcuts?: () => void;
  onOpenClearModal?: () => void;
  onToggleTimer?: () => void;
  isTimerOpen?: boolean;
  tableRows?: number;
  tableCols?: number;
  onChangeTableDimensions?: (rows: number, cols: number) => void;
}

const STICKY_COLORS = [
  // Pastel row 1
  { name: "Yellow", hex: "#fef08a" },
  { name: "Pink", hex: "#fbcfe8" },
  { name: "Blue", hex: "#bfdbfe" },
  { name: "Green", hex: "#bbf7d0" },
  // Pastel row 2
  { name: "Orange", hex: "#fed7aa" },
  { name: "Purple", hex: "#e9d5ff" },
  { name: "Teal", hex: "#99f6e4" },
  { name: "Red", hex: "#fecaca" },
  // Solid/Vibrant row 3
  { name: "Vibrant Red", hex: "#e11d48" },
  { name: "Vibrant Orange", hex: "#f97316" },
  { name: "Vibrant Green", hex: "#059669" },
  { name: "Vibrant Blue", hex: "#2563eb" },
  // Dark/Neutrals row 4
  { name: "Vibrant Purple", hex: "#7c3aed" },
  { name: "Slate Grey", hex: "#64748b" },
  { name: "White", hex: "#ffffff" },
  { name: "Pure Black", hex: "#000000" },
];

const SHAPES: { type: ShapeType; label: string; icon: React.ReactNode }[] = [
  { type: "rect", label: "Rectangle", icon: <Square className="w-4 h-4" /> },
  { type: "circle", label: "Circle", icon: <Circle className="w-4 h-4" /> },
  {
    type: "triangle",
    label: "Triangle",
    icon: <Triangle className="w-4 h-4" />,
  },
  {
    type: "diamond",
    label: "Diamond",
    icon: (
      <div className="w-3.5 h-3.5 border-2 border-current rotate-45 transform mx-auto" />
    ),
  },
  {
    type: "star",
    label: "Star",
    icon: (
      <div className="text-[14px] leading-none font-bold text-center">
        &#9733;
      </div>
    ),
  },
  { type: "hexagon", label: "Hexagon", icon: <Hexagon className="w-4 h-4" /> },
  {
    type: "pentagon",
    label: "Pentagon",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="12 2 22 9.27 18.18 21 5.82 21 2 9.27" />
      </svg>
    ),
  },
  {
    type: "parallelogram",
    label: "Parallelogram",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="6 4 21 4 18 20 3 20" />
      </svg>
    ),
  },
  {
    type: "right-triangle",
    label: "Right Triangle",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="4 4 4 20 20 20" />
      </svg>
    ),
  },
  {
    type: "line",
    label: "Line Segment",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <line x1="4" y1="12" x2="20" y2="12" />
      </svg>
    ),
  },
];

const GRAPH_TOOLS: { type: Tool; label: string; icon: React.ReactNode }[] = [
  {
    type: "advanced-cartesian",
    label: "Advanced Cartesian",
    icon: <TrendingUp className="w-4 h-4" />,
  },
  {
    type: "cartesian",
    label: "Basic Cartesian",
    icon: <Grid className="w-4 h-4" />,
  },
  {
    type: "numberline",
    label: "Number Line",
    icon: (
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 3 12 L 21 12" strokeWidth="2.5" />
        <path d="M 6 9 L 3 12 L 6 15" strokeWidth="2.5" />
        <path d="M 18 9 L 21 12 L 18 15" strokeWidth="2.5" />
        <path d="M 12 9 L 12 15" strokeWidth="2.5" />
        <path d="M 7 10 L 7 14" />
        <path d="M 17 10 L 17 14" />
      </svg>
    ),
  },
];

export default function Toolbar({
  activeTool,
  onChangeTool,
  activeColor,
  onChangeColor,
  activeShape,
  onChangeShape,
  onClearBoard,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  strokeWidth,
  onChangeStrokeWidth,
  gridMode,
  onChangeGridMode,
  hasSelection = false,
  hasColorableSelection = false,
  hasStampSelection = false,
  selectedStampShape = "rounded-rect",
  onChangeStampShape,
  isPdfMode = false,
  isZenMode = false,
  onToggleZenMode,
  isTopBarHidden = false,
  onOpenShortcuts,
  onOpenClearModal,
  onToggleTimer,
  isTimerOpen = false,
  tableRows = 3,
  tableCols = 3,
  onChangeTableDimensions,
}: ToolbarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(true);
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);

  const isGraphTool =
    activeTool === "cartesian" ||
    activeTool === "advanced-cartesian" ||
    activeTool === "numberline";
  const activeGraphMode = isGraphTool ? activeTool : "advanced-cartesian";

  // Re-organize tools into clean logical groupings to reduce cognitive overhead
  const toolGroups = [
    {
      id: "navigation",
      label: "Navigation",
      items: [
        { id: "select", icon: <MousePointer className="w-5 h-5" />, label: "Select & Edit", shortcut: "V" },
        { id: "pan", icon: <Hand className="w-5 h-5" />, label: "Pan Canvas", shortcut: "H" },
        { id: "eraser", icon: <Eraser className="w-5 h-5" />, label: "Eraser Tool", shortcut: "E" },
      ]
    },
    {
      id: "drawing",
      label: "Drawing",
      items: [
        { id: "pencil", icon: <Pen className="w-5 h-5" />, label: "Pencil Draw", shortcut: "P" },
        { id: "highlighter", icon: <Highlighter className="w-5 h-5" />, label: "Highlighter", shortcut: "I" },
        { id: "laser", icon: <Flame className="w-5 h-5 text-rose-500" />, label: "Laser Pointer", shortcut: "K" },
      ]
    },
    {
      id: "elements",
      label: "Elements",
      items: [
        { id: "text", icon: <Type className="w-5 h-5" />, label: "Text Box", shortcut: "T" },
        { id: "sticky", icon: <StickyNote className="w-5 h-5" />, label: "Sticky Note", shortcut: "N" },
        { id: "table", icon: <TableIcon className="w-5 h-5 text-blue-600" />, label: "Table", shortcut: "B" },
        { id: "math", icon: <Calculator className="w-5 h-5 text-indigo-500" />, label: "Math Equation", shortcut: "M" },
        { id: "shape", icon: <Square className="w-5 h-5" />, label: "Shapes Picker", shortcut: "S" },
        { id: "graph_menu", icon: <TrendingUp className="w-5 h-5" />, label: "Grid Graphs", shortcut: "G" },
        { id: "connector", icon: <CornerDownRight className="w-5 h-5" />, label: "Connector Arrow", shortcut: "L" },
      ]
    },
    {
      id: "collaboration",
      label: "Interaction",
      items: [
        { id: "audio", icon: <Mic className="w-5 h-5 text-amber-500" />, label: "Voice Annotation", shortcut: "U" },
        { id: "stamp", icon: <Stamp className="w-5 h-5 text-emerald-500" />, label: "Feedback Stamps", shortcut: "O" },
      ]
    }
  ];

  const hasSettings = [
    "pencil",
    "highlighter",
    "laser",
    "shape",
    "sticky",
    "text",
    "table",
    "math",
    "connector",
    "cartesian",
    "numberline",
    "advanced-cartesian",
  ].includes(activeTool) || (activeTool === "select" && (hasColorableSelection || hasStampSelection));

  const [hoverGrid, setHoverGrid] = useState<{ r: number; c: number } | null>(null);

  const autoHideTimeoutRef = React.useRef<any>(null);

  const resetAutoHideTimer = () => {
    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
    }
    autoHideTimeoutRef.current = setTimeout(() => {
      setShowSettingsPanel(false);
    }, 5000); // 5 seconds of idle auto-hides panel
  };

  const cancelAutoHideTimer = () => {
    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
      autoHideTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    if (hasSettings) {
      setShowSettingsPanel(true);
      resetAutoHideTimer();
    } else {
      setShowSettingsPanel(false);
    }
    return () => cancelAutoHideTimer();
  }, [activeTool]);

  useEffect(() => {
    if (hasColorableSelection || hasStampSelection) {
      setShowSettingsPanel(true);
      resetAutoHideTimer();
    }
  }, [hasColorableSelection, hasStampSelection]);

  useEffect(() => {
    return () => cancelAutoHideTimer();
  }, []);

  const getToolDisplayName = () => {
    if (activeTool === "select" && hasStampSelection) return "Stamp Settings";
    if (activeTool === "select" && hasColorableSelection) return "Selection Theme";
    if (activeTool === "pencil") return "Pencil Settings";
    if (activeTool === "highlighter") return "Highlighter Settings";
    if (activeTool === "laser") return "Laser Pointer Settings";
    if (activeTool === "shape") return "Shape Settings";
    if (activeTool === "sticky") return "Sticky Note Settings";
    if (activeTool === "text") return "Text Settings";
    if (activeTool === "table") return "Table Dimensions";
    if (activeTool === "math") return "Math Formula Settings";
    if (activeTool === "connector") return "Connector Settings";
    if (isGraphTool) return "Graph Settings";
    return "";
  };

  const getToolIcon = () => {
    if (activeTool === "select") return <MousePointer className="w-4 h-4 text-blue-600" />;
    if (activeTool === "pencil") return <Pen className="w-4 h-4 text-blue-600" />;
    if (activeTool === "highlighter") return <Highlighter className="w-4 h-4 text-blue-600" />;
    if (activeTool === "laser") return <Flame className="w-4 h-4 text-rose-500" />;
    if (activeTool === "shape") return <Square className="w-4 h-4 text-blue-600" />;
    if (activeTool === "sticky") return <StickyNote className="w-4 h-4 text-blue-600" />;
    if (activeTool === "text") return <Type className="w-4 h-4 text-blue-600" />;
    if (activeTool === "table") return <TableIcon className="w-4 h-4 text-blue-600" />;
    if (activeTool === "math") return <Calculator className="w-4 h-4 text-indigo-600" />;
    if (activeTool === "connector") return <CornerDownRight className="w-4 h-4 text-blue-600" />;
    if (isGraphTool) return <TrendingUp className="w-4 h-4 text-blue-600" />;
    return null;
  };

  const getToolTipText = () => {
    if (activeTool === "pencil") return "Freehand pencil sketch. Select active color and line stroke weight below.";
    if (activeTool === "highlighter") return "Semi-transparent highlighter to annotate text, models or layouts.";
    if (activeTool === "laser") return "Temporary laser pointer to draw attention. Auto-fades in 2 seconds.";
    if (activeTool === "shape") return "Place shapes onto the canvas. Links perfectly with connection arrows.";
    if (activeTool === "sticky") return "Standard sticky notes. Double-click after creation to write messages.";
    if (activeTool === "text") return "Annotate specific zones with precise styled text blocks.";
    if (activeTool === "table") return "Choose number of rows and columns, then click canvas to insert table.";
    if (activeTool === "math") return "Renders advanced KaTeX mathematical equations on the board.";
    if (activeTool === "connector") return "Links shapes together using top, bottom, left or right socket anchors.";
    if (isGraphTool) return "Draw a standard cartesian graph or number line coordinates automatically.";
    if (activeTool === "select" && hasStampSelection) return "Change the shape or color theme of selected stamp(s).";
    if (activeTool === "select" && hasColorableSelection) return "Update the background or outline color of selected elements.";
    return "";
  };

  const isColorable = [
    "pencil",
    "highlighter",
    "laser",
    "shape",
    "sticky",
    "text",
    "math",
    "connector",
    "cartesian",
    "numberline",
    "advanced-cartesian",
  ].includes(activeTool) || (activeTool === "select" && (hasColorableSelection || hasStampSelection));

  const topOffsetClass = isZenMode || isTopBarHidden ? "md:top-3" : "md:top-16 lg:md:top-20";

  // Reusable Bottom Bar Component with Zoom, Grid, Shortcuts, and Clear Modal
  const renderBottomControls = () => (
    <div className="fixed top-14 left-2 md:top-auto md:bottom-6 md:left-6 z-20 flex items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-1rem)] overflow-x-auto scrollbar-none touch-manipulation">
      {/* Zoom Controls */}
      <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-md p-1 sm:p-1.5 flex items-center space-x-0.5 sm:space-x-1 shrink-0">
        <button
          onClick={onZoomOut}
          className="p-1.5 sm:p-2 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center cursor-pointer transition-colors touch-manipulation"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={onZoomReset}
          className="py-1 px-1.5 sm:px-2 min-h-[36px] sm:min-h-[40px] text-[11px] font-bold text-slate-600 hover:bg-slate-100 active:bg-slate-200 rounded-lg text-center font-mono whitespace-nowrap min-w-[2.5rem] sm:min-w-[3rem] flex items-center justify-center cursor-pointer transition-colors touch-manipulation"
          title="Reset Zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={onZoomIn}
          className="p-1.5 sm:p-2 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-200 flex items-center justify-center cursor-pointer transition-colors touch-manipulation"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      {/* Grid Mode Selection */}
      {!isPdfMode && (
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-md p-1 sm:p-1.5 flex items-center space-x-0.5 sm:space-x-1 shrink-0">
          <button
            onClick={() => onChangeGridMode("dots")}
            className={`p-1.5 sm:p-2 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl transition-all flex items-center justify-center cursor-pointer touch-manipulation ${
              gridMode === "dots"
                ? "bg-blue-50 text-blue-600 ring-1 ring-blue-600/20 font-bold shadow-xs"
                : "text-slate-500 hover:bg-slate-100 active:bg-slate-200"
            }`}
            title="Dotted Canvas"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="6" cy="6" r="1" fill="currentColor" />
              <circle cx="12" cy="6" r="1" fill="currentColor" />
              <circle cx="18" cy="6" r="1" fill="currentColor" />
              <circle cx="6" cy="12" r="1" fill="currentColor" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="18" cy="12" r="1" fill="currentColor" />
              <circle cx="6" cy="18" r="1" fill="currentColor" />
              <circle cx="12" cy="18" r="1" fill="currentColor" />
              <circle cx="18" cy="18" r="1" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={() => onChangeGridMode("math")}
            className={`p-1.5 sm:p-2 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl transition-all flex items-center justify-center cursor-pointer touch-manipulation ${
              gridMode === "math"
                ? "bg-blue-50 text-blue-600 ring-1 ring-blue-600/20 font-bold shadow-xs"
                : "text-slate-500 hover:bg-slate-100 active:bg-slate-200"
            }`}
            title="Math Grid (Graph Paper)"
          >
            <Grid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onChangeGridMode("none")}
            className={`p-1.5 sm:p-2 min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl transition-all flex items-center justify-center cursor-pointer touch-manipulation ${
              gridMode === "none"
                ? "bg-blue-50 text-blue-600 ring-1 ring-blue-600/20 font-bold shadow-xs"
                : "text-slate-500 hover:bg-slate-100 active:bg-slate-200"
            }`}
            title="Plain White Background"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        </div>
      )}

      {/* Utilities Group (Zen, Timer, Shortcuts, Clear Canvas) */}
      {(onToggleZenMode || onToggleTimer || onOpenShortcuts || onOpenClearModal) && (
        <div className="hidden md:flex bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-md p-1 sm:p-1.5 items-center space-x-0.5 sm:space-x-1 shrink-0">
          {onToggleZenMode && (
            <button
              onClick={onToggleZenMode}
              className="p-1.5 sm:p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-all cursor-pointer"
              title={isZenMode ? "Exit Full Screen" : "Enter Full Screen (Zen Mode)"}
            >
              <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}

          {onToggleTimer && (
            <button
              onClick={onToggleTimer}
              className={`p-1.5 sm:p-2 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                isTimerOpen
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "text-slate-500 hover:text-indigo-600 hover:bg-slate-100"
              }`}
              title="Sprint Timer & Stopwatch"
            >
              <TimerIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}

          {onOpenShortcuts && (
            <button
              onClick={onOpenShortcuts}
              className="p-1.5 sm:p-2 rounded-xl text-slate-500 hover:text-blue-600 hover:bg-slate-100 flex items-center justify-center transition-all cursor-pointer"
              title="Keyboard Shortcuts (?)"
            >
              <Keyboard className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}

          {onOpenClearModal && (
            <button
              onClick={onOpenClearModal}
              className="p-1.5 sm:p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-all cursor-pointer"
              title="Clear Whiteboard Canvas"
            >
              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (isCollapsed) {
    return (
      <>
        {/* Subtle Floating Toggle Button when Toolbar is Collapsed */}
        <div
          className={`fixed md:absolute bottom-3 left-3 md:bottom-auto md:left-3 z-30 transition-all duration-300 ${topOffsetClass}`}
          id="whiteboard-toolbar-collapsed"
        >
          <button
            onClick={() => setIsCollapsed(false)}
            className="bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 hover:text-blue-600 border border-slate-200/90 shadow-md hover:shadow-lg rounded-2xl px-3.5 py-3 flex items-center space-x-2 text-xs font-bold cursor-pointer transition-all hover:scale-105 active:scale-95 group"
            title="Show Toolbar"
          >
            <PenTool className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-bold tracking-wide">Workspace Tools</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors" />
          </button>
        </div>

        {/* Floating Bottom Left Controls */}
        {renderBottomControls()}
      </>
    );
  }

  return (
    <>
      <div
        className={`fixed md:absolute bottom-3 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-3 md:bottom-auto z-30 flex flex-col items-center md:items-start space-y-2 transition-all duration-300 max-w-[98vw] ${topOffsetClass}`}
        id="whiteboard-toolbar"
      >
        {/* Primary Segmented Toolbar */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-xl p-1.5 flex flex-row md:flex-col items-center max-w-full overflow-x-auto md:overflow-visible scrollbar-none space-x-1 md:space-x-0 md:space-y-1">
          {/* Toolbar Header (Desktop Only) */}
          <div className="hidden md:flex flex-col items-center space-y-1.5 pb-2 border-b border-slate-100 mb-1.5 w-full">
            <button
              id="btn-collapse-toolbar"
              onClick={() => setIsCollapsed(true)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              title="Hide Toolbar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Grouped Tools Renderer (Desktop Only) */}
          <div className="hidden md:flex flex-col items-center space-y-1 w-full">
            {toolGroups.map((group, groupIdx) => (
              <React.Fragment key={group.id}>
                {groupIdx > 0 && <div className="w-full h-px bg-slate-100 my-1" />}
                <div className="flex flex-col items-center space-y-1 w-full">
                  {group.items.map((t) => {
                    const isActive = activeTool === t.id;
                    const isGraphActive = t.id === "graph_menu" && isGraphTool;
                    const showActive = isActive || isGraphActive;
                    
                    return (
                      <div key={t.id} className="relative group shrink-0 w-full flex justify-center">
                        <button
                          onClick={() => {
                            if (showActive) {
                              setShowSettingsPanel(!showSettingsPanel);
                            } else {
                              if (t.id === "graph_menu") {
                                onChangeTool(activeGraphMode as Tool);
                              } else {
                                onChangeTool(t.id as Tool);
                              }
                              setShowSettingsPanel(true);
                            }
                          }}
                          title={`${t.label} (${t.shortcut})`}
                          className={`p-2.5 sm:p-3 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                            showActive
                              ? "bg-blue-600 text-white shadow-md shadow-blue-600/15 scale-105"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          {t.id === "shape"
                            ? SHAPES.find((s) => s.type === activeShape)?.icon || t.icon
                            : t.id === "graph_menu"
                              ? GRAPH_TOOLS.find((g) => g.type === activeGraphMode)?.icon || t.icon
                              : t.icon}
                        </button>

                        {/* Desktop Tooltip */}
                        <div className="hidden md:block absolute left-16 top-1/2 -translate-y-1/2 bg-slate-900 text-white text-[11px] px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap shadow-md z-50">
                          {t.label} {t.shortcut && <span className="ml-1.5 text-slate-400 font-mono font-bold text-[9px] bg-slate-800 px-1 py-0.5 rounded">({t.shortcut})</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Compact Primary Tools Renderer (Mobile Only) */}
          <div className="flex md:hidden items-center space-x-1 shrink-0">
            {[
              { id: "select", icon: <MousePointer className="w-5 h-5" />, label: "Select" },
              { id: "pan", icon: <Hand className="w-5 h-5" />, label: "Pan" },
              { id: "eraser", icon: <Eraser className="w-5 h-5" />, label: "Eraser" },
              { id: "pencil", icon: <Pen className="w-5 h-5" />, label: "Pencil" },
              { id: "graph_menu", icon: GRAPH_TOOLS.find((g) => g.type === activeGraphMode)?.icon || <TrendingUp className="w-5 h-5" />, label: "Graphs" },
              { id: "shape", icon: SHAPES.find((s) => s.type === activeShape)?.icon || <Square className="w-5 h-5" />, label: "Shapes" },
              { id: "text", icon: <Type className="w-5 h-5" />, label: "Text" },
            ].map((t) => {
              const isActive = t.id === "graph_menu" ? isGraphTool : activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (isActive) {
                      setShowSettingsPanel(!showSettingsPanel);
                    } else {
                      if (t.id === "graph_menu") {
                        onChangeTool(activeGraphMode as Tool);
                      } else {
                        onChangeTool(t.id as Tool);
                      }
                      setShowSettingsPanel(true);
                    }
                    setIsMobileMoreOpen(false);
                  }}
                  className={`min-w-[44px] min-h-[44px] p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 touch-manipulation active:scale-95 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm scale-105 font-bold"
                      : "text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                  }`}
                  title={t.label}
                >
                  {t.icon}
                </button>
              );
            })}

            {/* Mobile-Only More Tools Toggle Button */}
            {(() => {
              const secondaryTools = [
                "highlighter",
                "laser",
                "table",
                "sticky",
                "math",
                "connector",
                "audio",
                "stamp",
                "cartesian",
                "numberline",
                "advanced-cartesian",
              ];
              const isSecondaryActive = secondaryTools.includes(activeTool) || isGraphTool;
              
              const getSecondaryActiveIcon = () => {
                if (activeTool === "highlighter") return <Highlighter className="w-5 h-5" />;
                if (activeTool === "laser") return <Flame className="w-5 h-5 text-rose-500" />;
                if (activeTool === "table") return <TableIcon className="w-5 h-5 text-blue-600" />;
                if (activeTool === "sticky") return <StickyNote className="w-5 h-5" />;
                if (activeTool === "math") return <Calculator className="w-5 h-5 text-indigo-500" />;
                if (isGraphTool) return <TrendingUp className="w-5 h-5" />;
                if (activeTool === "connector") return <CornerDownRight className="w-5 h-5" />;
                if (activeTool === "audio") return <Mic className="w-5 h-5 text-amber-500" />;
                if (activeTool === "stamp") return <Stamp className="w-5 h-5 text-emerald-500" />;
                return <LayoutGrid className="w-5 h-5" />;
              };

              return (
                <button
                  onClick={() => setIsMobileMoreOpen(!isMobileMoreOpen)}
                  className={`min-w-[44px] min-h-[44px] p-2.5 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 border border-transparent touch-manipulation active:scale-95 ${
                    isSecondaryActive
                      ? "bg-blue-600 text-white shadow-sm scale-105"
                      : isMobileMoreOpen
                        ? "bg-slate-100 text-slate-800 border-slate-200/60"
                        : "text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                  }`}
                  title="More Tools"
                >
                  {getSecondaryActiveIcon()}
                </button>
              );
            })()}
          </div>
          
          {/* Mobile Collapse Button */}
          <button
            onClick={() => setIsCollapsed(true)}
            className="md:hidden min-w-[44px] min-h-[44px] p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer shrink-0 ml-1 border-l border-slate-100 pl-2 flex items-center justify-center touch-manipulation"
            title="Hide Toolbar"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
        </div>

        {/* Mobile "More Tools" Grid Popover */}
        {isMobileMoreOpen && (
          <div className="md:hidden bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-2xl p-3 grid grid-cols-4 gap-2 absolute bottom-16 left-1/2 -translate-x-1/2 w-[94vw] max-w-[320px] animate-fade-in z-40 touch-manipulation">
            {[
              { id: "table", icon: <TableIcon className="w-5 h-5 text-blue-600" />, label: "Table" },
              { id: "highlighter", icon: <Highlighter className="w-5 h-5 text-slate-600" />, label: "Highlight" },
              { id: "laser", icon: <Flame className="w-5 h-5 text-rose-500" />, label: "Laser" },
              { id: "sticky", icon: <StickyNote className="w-5 h-5 text-slate-600" />, label: "Sticky" },
              { id: "math", icon: <Calculator className="w-5 h-5 text-indigo-500" />, label: "Math" },
              { id: "connector", icon: <CornerDownRight className="w-5 h-5 text-slate-600" />, label: "Connector" },
              { id: "audio", icon: <Mic className="w-5 h-5 text-amber-500" />, label: "Voice" },
              { id: "stamp", icon: <Stamp className="w-5 h-5 text-emerald-500" />, label: "Stamps" },
            ].map((t) => {
              const isActive = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    onChangeTool(t.id as Tool);
                    setShowSettingsPanel(true);
                    setIsMobileMoreOpen(false);
                  }}
                  className={`min-h-[48px] p-2 rounded-xl flex flex-col items-center justify-center space-y-1 transition-all border cursor-pointer touch-manipulation active:scale-95 ${
                    isActive
                      ? "bg-blue-50 border-blue-200 text-blue-600 font-bold"
                      : "bg-slate-50/50 border-transparent hover:bg-slate-100 active:bg-slate-200 text-slate-600"
                  }`}
                >
                  {t.icon}
                  <span className="text-[10px] font-bold tracking-tight">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* UNIFIED PROPERTIES PANEL: Merges shape menu, graph selector, line width, and color palette */}
        {hasSettings && showSettingsPanel && (
          <div
            onMouseEnter={cancelAutoHideTimer}
            onMouseLeave={resetAutoHideTimer}
            className={`bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-xl p-3.5 flex flex-col space-y-3.5 absolute transition-all duration-200 z-40 w-[94vw] max-w-[280px] animate-fade-in ${
              isCollapsed
                ? "bottom-16 left-1/2 -translate-x-1/2 md:bottom-auto md:left-24 md:top-10 md:translate-x-0"
                : "bottom-20 left-1/2 -translate-x-1/2 md:bottom-auto md:left-24 md:top-10 md:translate-x-0"
            }`}
          >
            {/* Properties Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
              <div className="flex items-center space-x-1.5 font-bold text-slate-900 text-xs">
                {getToolIcon()}
                <span>{getToolDisplayName()}</span>
              </div>
              <button
                onClick={() => setShowSettingsPanel(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 hover:bg-slate-100 rounded-md transition-colors"
                title="Collapse Panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Table Dimension Selector */}
            {activeTool === "table" && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                  <span>Size:</span>
                  <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-mono">
                    {hoverGrid ? `${hoverGrid.r} × ${hoverGrid.c}` : `${tableRows || 3} × ${tableCols || 3}`} Table
                  </span>
                </div>

                {/* Interactive Grid Selection (up to 6x6) */}
                <div className="flex flex-col items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                  {Array.from({ length: 6 }).map((_, r) => (
                    <div key={r} className="flex space-x-1 mb-1 last:mb-0">
                      {Array.from({ length: 6 }).map((_, c) => {
                        const curR = r + 1;
                        const curC = c + 1;
                        const targetR = hoverGrid ? hoverGrid.r : (tableRows || 3);
                        const targetC = hoverGrid ? hoverGrid.c : (tableCols || 3);
                        const isHighlighted = curR <= targetR && curC <= targetC;

                        return (
                          <button
                            key={c}
                            onMouseEnter={() => setHoverGrid({ r: curR, c: curC })}
                            onMouseLeave={() => setHoverGrid(null)}
                            onClick={() => {
                              if (onChangeTableDimensions) {
                                onChangeTableDimensions(curR, curC);
                              }
                            }}
                            className={`w-6 h-6 rounded border transition-all cursor-pointer ${
                              isHighlighted
                                ? "bg-blue-500 border-blue-600 shadow-xs"
                                : "bg-white border-slate-200 hover:border-blue-300"
                            }`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Quick Presets */}
                <div className="grid grid-cols-4 gap-1">
                  {[
                    { r: 2, c: 2 },
                    { r: 3, c: 3 },
                    { r: 4, c: 4 },
                    { r: 5, c: 5 },
                  ].map((preset) => {
                    const isSelected = (tableRows || 3) === preset.r && (tableCols || 3) === preset.c;
                    return (
                      <button
                        key={`${preset.r}x${preset.c}`}
                        onClick={() => {
                          if (onChangeTableDimensions) {
                            onChangeTableDimensions(preset.r, preset.c);
                          }
                        }}
                        className={`py-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer text-center ${
                          isSelected
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {preset.r}×{preset.c}
                      </button>
                    );
                  })}
                </div>

                {/* Specific Custom Numeric Input for Rows & Columns */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Rows</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={tableRows || 3}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                        if (onChangeTableDimensions) {
                          onChangeTableDimensions(val, tableCols || 3);
                        }
                      }}
                      className="w-full px-2 py-1 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors"
                      placeholder="Rows"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Cols</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={tableCols || 3}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                        if (onChangeTableDimensions) {
                          onChangeTableDimensions(tableRows || 3, val);
                        }
                      }}
                      className="w-full px-2 py-1 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition-colors"
                      placeholder="Cols"
                    />
                  </div>
                </div>
              </div>
            )}
            {activeTool === "shape" && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Shape Type
                </span>
                <div className="grid grid-cols-2 gap-1.5 max-h-[140px] overflow-y-auto pr-0.5" style={{ scrollbarWidth: "thin" }}>
                  {SHAPES.map((s) => {
                    const isSelected = activeShape === s.type;
                    return (
                      <button
                        key={s.type}
                        onClick={() => onChangeShape(s.type)}
                        className={`px-2 py-1.5 rounded-xl text-[11px] font-semibold flex items-center space-x-2 transition-all cursor-pointer border ${
                          isSelected
                            ? "bg-blue-50 text-blue-600 border-blue-200"
                            : "bg-slate-50 text-slate-600 border-transparent hover:bg-slate-100"
                        }`}
                      >
                        <span className={isSelected ? "text-blue-600" : "text-slate-500 shrink-0"}>{s.icon}</span>
                        <span className="truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stamp Shape Selection Grid when a stamp is selected */}
            {hasStampSelection && onChangeStampShape && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Stamp Shape
                </span>
                <div className="grid grid-cols-2 gap-1.5 max-h-[140px] overflow-y-auto pr-0.5" style={{ scrollbarWidth: "thin" }}>
                  {[
                    { type: "rounded-rect", label: "Rectangle" },
                    { type: "circle", label: "Circle" },
                    { type: "star", label: "Star" },
                    { type: "badge", label: "Badge" },
                    { type: "diamond", label: "Diamond" },
                    { type: "banner", label: "Banner" },
                    { type: "hexagon", label: "Hexagon" },
                    { type: "ribbon", label: "Ribbon" },
                    { type: "heart", label: "Heart" },
                    { type: "shield", label: "Shield" },
                    { type: "crest", label: "Crest" },
                  ].map((s) => {
                    const isSelected = selectedStampShape === s.type;
                    return (
                      <button
                        key={s.type}
                        onClick={() => onChangeStampShape(s.type)}
                        className={`px-2 py-1.5 rounded-xl text-[11px] font-semibold flex items-center space-x-1.5 transition-all cursor-pointer border ${
                          isSelected
                            ? "bg-indigo-50 text-indigo-600 border-indigo-200 font-bold"
                            : "bg-slate-50 text-slate-600 border-transparent hover:bg-slate-100"
                        }`}
                      >
                        <span className="truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Graph-specific System Segmented Selector */}
            {isGraphTool && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Graph System
                </span>
                <div className="flex flex-col space-y-1">
                  {GRAPH_TOOLS.map((g) => {
                    const isSelected = activeTool === g.type;
                    return (
                      <button
                        key={g.type}
                        onClick={() => onChangeTool(g.type)}
                        className={`w-full text-left px-3 py-1.5 rounded-xl text-[11px] font-semibold flex items-center space-x-2 transition-all cursor-pointer border ${
                          isSelected
                            ? "bg-blue-50 text-blue-600 border-blue-200 shadow-xs"
                            : "bg-slate-50 text-slate-600 border-transparent hover:bg-slate-100"
                        }`}
                      >
                        <span className={isSelected ? "text-blue-600" : "text-slate-500 shrink-0"}>{g.icon}</span>
                        <span>{g.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Drawing Tool Type Selector */}
            {(activeTool === "pencil" || activeTool === "highlighter" || activeTool === "laser") && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Pencil Type
                </span>
                <div className="flex space-x-1">
                  {[
                    { id: "pencil", label: "Pencil", icon: <Pen className="w-3.5 h-3.5" /> },
                    { id: "highlighter", label: "Highlight", icon: <Highlighter className="w-3.5 h-3.5" /> },
                    { id: "laser", label: "Laser", icon: <Flame className="w-3.5 h-3.5 text-rose-500" /> },
                  ].map((item) => {
                    const isSelected = activeTool === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onChangeTool(item.id as Tool);
                          setShowSettingsPanel(true);
                        }}
                        className={`flex-1 py-1.5 px-2 rounded-xl border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center space-x-1 ${
                          isSelected
                            ? "bg-blue-50 text-blue-600 border-blue-200 shadow-xs scale-102"
                            : "bg-slate-50 text-slate-500 border-transparent hover:bg-slate-100"
                        }`}
                      >
                        {item.icon}
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stroke Thickness Panel for Drawing Tools */}
            {(activeTool === "pencil" || activeTool === "highlighter") && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Stroke Weight
                </span>
                <div className="flex items-center space-x-1">
                  {[2, 4, 8, 16].map((w) => (
                    <button
                      key={w}
                      onClick={() => onChangeStrokeWidth(w)}
                      className={`flex-1 py-1 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                        strokeWidth === w
                          ? "bg-blue-50 text-blue-600 border-blue-200"
                          : "bg-slate-50 text-slate-500 border-transparent hover:bg-slate-100"
                      }`}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Dynamic Palette Color Selector */}
            {isColorable && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Color Theme
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {STICKY_COLORS.map((color) => {
                    const isSelected = activeColor === color.hex;
                    const isDarkColor = [
                      "#e11d48",
                      "#f97316",
                      "#059669",
                      "#2563eb",
                      "#7c3aed",
                      "#64748b",
                      "#000000",
                    ].includes(color.hex);
                    return (
                      <button
                        key={color.hex}
                        onClick={() => {
                          onChangeColor(color.hex);
                          if (autoHideTimeoutRef.current) {
                            clearTimeout(autoHideTimeoutRef.current);
                          }
                          autoHideTimeoutRef.current = setTimeout(() => {
                            setShowSettingsPanel(false);
                          }, 1500); // Hide settings panel 1.5 seconds after selection
                        }}
                        className={`h-7 rounded-lg border relative transition-all cursor-pointer ${
                          isSelected
                            ? "ring-2 ring-blue-500 ring-offset-1 border-white scale-105"
                            : "border-slate-200/65 hover:scale-105"
                        }`}
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      >
                        {isSelected && (
                          <div
                            className={`absolute inset-0 m-auto w-1.5 h-1.5 rounded-full shadow-xs ${isDarkColor ? "bg-white" : "bg-slate-800"}`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dynamic Pedagogical Action Tip footer */}
            <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-100">
              <div className="flex items-start space-x-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-slate-500 leading-normal font-medium">
                  {getToolTipText()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Left Controls */}
      {renderBottomControls()}
    </>
  );
}
