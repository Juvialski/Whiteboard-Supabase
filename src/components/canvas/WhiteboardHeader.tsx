import React from "react";
import {
  ChevronLeft,
  Undo,
  Redo,
  Video,
  Unlock,
  Lock,
  Download,
  Loader2,
  Image as ImageIcon,
  FileCode,
  Share2,
  Check,
  EyeOff,
  MoreHorizontal,
} from "lucide-react";
import { UserProfile } from "../../types";

interface WhiteboardHeaderProps {
  isZenMode: boolean;
  isTopBarHidden: boolean;
  setIsTopBarHidden: (hidden: boolean) => void;
  onBackToDashboard: () => void;
  boardName: string;
  boardId: string;
  syncStatus: "synced" | "saving-cloud" | "saved-local" | "offline";
  wsConnected: boolean;
  wsLatency: number | null;
  flushPendingChanges: () => void;
  showSyncToast: (msg: string, type: "success" | "error" | "warning" | "info") => void;
  undoStack: any[];
  redoStack: any[];
  handleUndo: () => void;
  handleRedo: () => void;
  currentUser: UserProfile;
  socketCollaboratorsRef: React.MutableRefObject<Record<string, any>>;
  activeCollaboratorIds?: string[];
  followedUserId: string | null;
  setFollowedUserId: (id: string | null) => void;
  isPresenterMode: boolean;
  setIsPresenterMode: (val: boolean) => void;
  wsRef: React.MutableRefObject<WebSocket | null>;
  isTeacher: boolean;
  canManage?: boolean;
  studentsCanWrite: boolean;
  handleToggleStudentsCanWrite: () => void;
  isPdfBoard: boolean;
  handleDownloadPdfWithDrawings: () => void;
  isGeneratingPdf: boolean;
  handleExportImage: (format: "png" | "svg") => void;
  copyBoardLink: () => void;
  copiedLink: boolean;
  isHeaderMenuOpen: boolean;
  setIsHeaderMenuOpen: (open: boolean) => void;
}

export const WhiteboardHeader: React.FC<WhiteboardHeaderProps> = ({
  isZenMode,
  isTopBarHidden,
  setIsTopBarHidden,
  onBackToDashboard,
  boardName,
  boardId,
  syncStatus,
  wsConnected,
  wsLatency,
  flushPendingChanges,
  showSyncToast,
  undoStack,
  redoStack,
  handleUndo,
  handleRedo,
  currentUser,
  socketCollaboratorsRef,
  activeCollaboratorIds,
  followedUserId,
  setFollowedUserId,
  isPresenterMode,
  setIsPresenterMode,
  wsRef,
  isTeacher,
  canManage = false,
  studentsCanWrite,
  handleToggleStudentsCanWrite,
  isPdfBoard,
  handleDownloadPdfWithDrawings,
  isGeneratingPdf,
  handleExportImage,
  copyBoardLink,
  copiedLink,
  isHeaderMenuOpen,
  setIsHeaderMenuOpen,
}) => {
  return (
    <div
      className={`pointer-events-none absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-3 flex items-center justify-between gap-1.5 z-30 transition-all duration-300 ${
        isZenMode || isTopBarHidden ? "-translate-y-16 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      {/* Left Floating Island */}
      <div className="pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-md hover:shadow-lg p-1 sm:p-1.5 flex items-center space-x-1 sm:space-x-1.5 shrink min-w-0 overflow-x-auto scrollbar-none touch-manipulation">
        <button
          onClick={onBackToDashboard}
          className="p-1.5 sm:p-2 min-h-[36px] sm:min-h-[40px] hover:bg-slate-100/80 active:bg-slate-200 rounded-xl text-slate-600 hover:text-slate-900 transition-colors flex items-center space-x-1 font-bold text-xs cursor-pointer shrink-0 touch-manipulation"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden md:inline">All Boards</span>
        </button>

        <div className="h-4 w-[1px] bg-slate-200 shrink-0 hidden sm:block"></div>

        <div className="flex items-center space-x-1 sm:space-x-2 shrink min-w-0">
          <h2 className="text-xs sm:text-sm font-semibold leading-tight text-slate-900 flex items-center space-x-1">
            <span className="truncate max-w-[90px] sm:max-w-[180px]" title={boardName}>{boardName}</span>
            
            <div className="hidden sm:flex items-center space-x-1">
              {/* Unified Sync & WS Status Indicator */}
              {syncStatus === "synced" && (
                <span 
                  className={`border px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center space-x-1.5 transition-colors ${
                    wsConnected 
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200/80" 
                      : "bg-slate-50 text-slate-700 border-slate-200/80"
                  }`}
                  title={`Cloud: Synced | WebSockets: ${wsConnected ? `Connected (${wsLatency ?? 0}ms)` : "Disconnected"}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                  <span>{wsConnected ? "Live" : "Synced"}</span>
                </span>
              )}
              {syncStatus === "saving-cloud" && (
                <span className="bg-blue-50 text-blue-700 border border-blue-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center space-x-1.5">
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-500" />
                  <span>Syncing...</span>
                </span>
              )}
              {syncStatus === "saved-local" && (
                <span className="bg-amber-50 text-amber-700 border border-amber-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center space-x-1.5" title="Offline-ready local buffer active. Synced to cloud once you pause or others join.">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>Local Buffer</span>
                </span>
              )}
              {syncStatus === "offline" && (
                <button
                  onClick={() => {
                    showSyncToast("Attempting to force sync offline progress...", "info");
                    flushPendingChanges();
                  }}
                  className="bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200/80 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center space-x-1.5 cursor-pointer transition-colors touch-manipulation"
                  title="No internet connection detected or Supabase offline. Click to manually force synchronize progress with Cloud."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  <span>Offline (Sync)</span>
                </button>
              )}
            </div>

            {/* Minimal compact indicator dot for mobile */}
            <div className="flex sm:hidden items-center px-0.5">
              <span 
                className={`w-2 h-2 rounded-full ${
                  syncStatus === "synced" && wsConnected ? "bg-purple-500 animate-pulse" :
                  syncStatus === "synced" ? "bg-emerald-500" :
                  syncStatus === "saving-cloud" ? "bg-blue-500 animate-bounce" :
                  syncStatus === "saved-local" ? "bg-amber-500 animate-pulse" : "bg-rose-500"
                }`}
                title={`Status: ${syncStatus} | WS: ${wsConnected ? "Connected" : "Disconnected"}`}
              />
            </div>
          </h2>
        </div>

        <div className="h-4 w-[1px] bg-slate-200 shrink-0 hidden md:block"></div>

        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          className={`px-2 py-1 h-8 md:px-2.5 rounded-xl flex items-center space-x-1 font-bold text-xs transition-all cursor-pointer shrink-0 touch-manipulation ${
            undoStack.length > 0
              ? "bg-slate-100 border border-slate-200/80 text-slate-700 hover:bg-slate-200 active:bg-slate-300 hover:text-slate-950 hover:scale-[1.02] active:scale-[0.98]"
              : "text-slate-300 bg-slate-50 border border-slate-150 cursor-not-allowed"
          }`}
          title="Undo last action (Ctrl+Z)"
        >
          <Undo
            className={`w-3.5 h-3.5 ${undoStack.length > 0 ? "text-slate-600" : "text-slate-300"}`}
          />
          <span className="hidden md:inline">Undo</span>
          {undoStack.length > 0 && (
            <span className="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-mono font-extrabold">
              {undoStack.length}
            </span>
          )}
        </button>

        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          className={`px-2 py-1 h-8 md:px-2.5 rounded-xl flex items-center space-x-1 font-bold text-xs transition-all cursor-pointer shrink-0 touch-manipulation ${
            redoStack.length > 0
              ? "bg-slate-100 border border-slate-200/80 text-slate-700 hover:bg-slate-200 active:bg-slate-300 hover:text-slate-950 hover:scale-[1.02] active:scale-[0.98]"
              : "text-slate-300 bg-slate-50 border border-slate-150 cursor-not-allowed"
          }`}
          title="Redo last action (Ctrl+Y)"
        >
          <Redo
            className={`w-3.5 h-3.5 ${redoStack.length > 0 ? "text-slate-600" : "text-slate-300"}`}
          />
          <span className="hidden md:inline">Redo</span>
          {redoStack.length > 0 && (
            <span className="bg-blue-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-mono font-extrabold">
              {redoStack.length}
            </span>
          )}
        </button>
      </div>

      {/* Right Floating Island */}
      <div className="pointer-events-auto bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-md hover:shadow-lg p-1 sm:p-1.5 flex items-center space-x-1 sm:space-x-1.5 shrink min-w-0 transition-all">
        <div className="hidden sm:flex items-center space-x-1.5 bg-slate-100/90 p-1 md:px-2.5 md:py-1 rounded-full text-xs font-bold text-slate-600 border border-slate-200/80 shrink-0" title={`${currentUser.name} (You)`}>
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: currentUser.color }}
          />
          <span className="hidden md:inline truncate max-w-[80px]">{currentUser.name} (You)</span>
        </div>

        {/* Online Collaborators Avatars List with Follow Feature */}
        <div className="hidden sm:flex items-center space-x-1 sm:space-x-1.5 shrink-0">
          {(activeCollaboratorIds && activeCollaboratorIds.length > 0
            ? activeCollaboratorIds.map((id) => socketCollaboratorsRef.current[id]).filter(Boolean)
            : Object.values(socketCollaboratorsRef.current)
          ).map((collab) => {
            if (collab.id === currentUser.id) return null;
            const isFollowed = followedUserId === collab.id;
            return (
              <button
                key={collab.id}
                onClick={() => setFollowedUserId(collab.id)}
                className={`p-1 md:px-2.5 md:py-1 rounded-full flex items-center space-x-1.5 text-xs font-bold transition-all cursor-pointer border shrink-0 ${
                  isFollowed
                    ? "bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500/30 scale-105"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:scale-105"
                }`}
                title={isFollowed ? `Stop following ${collab.name}` : `Follow ${collab.name}'s live screen`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: collab.color }}
                />
                <span className="hidden sm:inline truncate max-w-[80px]">{collab.name}</span>
                {collab.role === "teacher" && (
                  <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0.2 rounded font-extrabold uppercase">
                    Teacher
                  </span>
                )}
                {isFollowed ? (
                  <span className="text-[9px] bg-blue-600 text-white px-1.5 py-0.2 rounded-full font-bold">
                    Following
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-400 font-medium">Follow</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Presenter Mode Button ("Follow Me") */}
        <button
          onClick={() => {
            const nextState = !isPresenterMode;
            setIsPresenterMode(nextState);
            if (nextState) {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: "request_follow",
                  boardId,
                  teacherId: currentUser.id,
                  teacherName: currentUser.name,
                }));
              }
              showSyncToast("Started Presenter Mode! Team will follow your screen.", "success");
            } else {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: "stop_follow",
                  boardId,
                  teacherId: currentUser.id,
                }));
              }
              showSyncToast("Exited Presenter Mode.", "info");
            }
          }}
          className={`hidden md:flex p-1.5 md:px-2.5 md:py-1 rounded-xl font-bold text-xs items-center space-x-1 transition-all cursor-pointer border shrink-0 ${
            isPresenterMode
              ? "bg-purple-600 border-purple-700 text-white shadow-md shadow-purple-600/20 ring-2 ring-purple-400"
              : "bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700"
          }`}
          title={isPresenterMode ? "Stop Presenter Mode" : "Start Presenter Mode (Broadcast View)"}
        >
          <Video className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">{isPresenterMode ? "Presenting" : "Presenter Mode"}</span>
        </button>

        {/* Teacher control to allow/disallow student writing */}
        {canManage ? (
          <button
            onClick={handleToggleStudentsCanWrite}
            className={`hidden md:flex p-1.5 md:px-2.5 md:py-1 rounded-xl items-center space-x-1.5 font-bold text-xs transition-all cursor-pointer border shrink-0 ${
              studentsCanWrite
                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 animate-pulse"
            }`}
            title={
              studentsCanWrite
                ? "Click to lock board for students (Read Only)"
                : "Click to unlock board for students (Collaborative)"
            }
          >
            {studentsCanWrite ? (
              <>
                <Unlock className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">Students Can Write</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="hidden md:inline">Students Locked</span>
              </>
            )}
          </button>
        ) : (
          /* Student status indicator */
          <div
            className={`hidden md:flex p-1.5 md:px-2.5 md:py-1 rounded-xl items-center space-x-1.5 font-bold text-xs border shrink-0 ${
              studentsCanWrite
                ? "bg-emerald-50 border-emerald-100 text-emerald-600"
                : "bg-amber-50 border-amber-200 text-amber-700"
            }`}
            title={studentsCanWrite ? "Collaborative Mode" : "View Only Mode"}
          >
            {studentsCanWrite ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="hidden md:inline">Collaborative Mode</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-amber-500 animate-bounce shrink-0" />
                <span className="hidden md:inline">View Only Mode</span>
              </>
            )}
          </div>
        )}

        {isPdfBoard && (
          <button
            onClick={handleDownloadPdfWithDrawings}
            disabled={isGeneratingPdf}
            className="hidden md:flex p-1.5 md:px-3 md:py-1 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs items-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0"
            title="Download PDF"
          >
            {isGeneratingPdf ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="hidden lg:inline">Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">Download PDF</span>
              </>
            )}
          </button>
        )}

        <button
          onClick={() => handleExportImage('png')}
          className="hidden md:flex p-1.5 md:px-3 md:py-1 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/80 shadow-xs items-center space-x-1.5 transition-all cursor-pointer shrink-0"
          title="Export full board as PNG image"
        >
          <ImageIcon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="hidden lg:inline">Export PNG</span>
        </button>

        <button
          onClick={() => handleExportImage('svg')}
          className="hidden md:flex p-1.5 md:px-3 md:py-1 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/80 shadow-xs items-center space-x-1.5 transition-all cursor-pointer shrink-0"
          title="Export full board as vector SVG"
        >
          <FileCode className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="hidden lg:inline">Export SVG</span>
        </button>

        {canManage && (
          <button
            onClick={copyBoardLink}
            className={`hidden md:flex p-1.5 md:px-3 md:py-1 rounded-xl text-xs font-medium items-center space-x-1.5 transition-all cursor-pointer shrink-0 ${
              copiedLink
                ? "bg-green-500 text-white shadow-xs"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
            }`}
            title="Create secure sharing link"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">Link Copied</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">Share Canvas</span>
              </>
            )}
          </button>
        )}

        {/* Subtle Button to Hide Header */}
        <button
          onClick={() => setIsTopBarHidden(true)}
          className="hidden md:flex p-1.5 hover:bg-slate-100/80 rounded-xl text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
          title="Hide Header Controls"
        >
          <EyeOff className="w-4 h-4" />
        </button>

        {/* Mobile Actions Dropdown Menu Button (Mobile Only) */}
        <div className="relative md:hidden flex items-center">
          <button
            onClick={() => setIsHeaderMenuOpen(!isHeaderMenuOpen)}
            className={`min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] p-1.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center touch-manipulation active:scale-95 ${
              isHeaderMenuOpen
                ? "bg-slate-100 border-slate-300 text-slate-800"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 active:bg-slate-200"
            }`}
            title="More Options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {isHeaderMenuOpen && (
            <div className="absolute right-0 top-10 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-2.5 flex flex-col space-y-1.5 z-45 min-w-[210px] text-slate-800 animate-fade-in">
              {/* Presenter Mode */}
              <button
                onClick={() => {
                  const nextState = !isPresenterMode;
                  setIsPresenterMode(nextState);
                  if (nextState) {
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                      wsRef.current.send(JSON.stringify({
                        type: "request_follow",
                        boardId,
                        teacherId: currentUser.id,
                        teacherName: currentUser.name,
                      }));
                    }
                    showSyncToast("Started Presenter Mode! Team will follow your screen.", "success");
                  } else {
                    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                      wsRef.current.send(JSON.stringify({
                        type: "stop_follow",
                        boardId,
                        teacherId: currentUser.id,
                      }));
                    }
                    showSyncToast("Exited Presenter Mode.", "info");
                  }
                  setIsHeaderMenuOpen(false);
                }}
                className={`w-full px-3 py-2 rounded-xl font-semibold text-xs flex items-center space-x-2 transition-all cursor-pointer border ${
                  isPresenterMode
                    ? "bg-purple-600 border-purple-700 text-white shadow-md shadow-purple-600/20"
                    : "bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700"
                }`}
              >
                <Video className="w-4 h-4 shrink-0" />
                <span>{isPresenterMode ? "Presenting..." : "Presenter Mode"}</span>
              </button>

              {/* Teacher lock/unlock or student status */}
              {canManage ? (
                <button
                  onClick={() => {
                    handleToggleStudentsCanWrite();
                    setIsHeaderMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl flex items-center space-x-2 font-semibold text-xs transition-all cursor-pointer border ${
                    studentsCanWrite
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                  }`}
                >
                  {studentsCanWrite ? (
                    <>
                      <Unlock className="w-4 h-4 shrink-0" />
                      <span>Students Can Write</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Students Locked</span>
                    </>
                  )}
                </button>
              ) : (
                <div
                  className={`w-full px-3 py-2 rounded-xl flex items-center space-x-2 font-semibold text-xs border ${
                    studentsCanWrite
                      ? "bg-emerald-50 border-emerald-100 text-emerald-600"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  }`}
                >
                  {studentsCanWrite ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500 relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span>Collaborative Mode</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>View Only Mode</span>
                    </>
                  )}
                </div>
              )}

              {/* Download PDF */}
              {isPdfBoard && (
                <button
                  onClick={() => {
                    handleDownloadPdfWithDrawings();
                    setIsHeaderMenuOpen(false);
                  }}
                  disabled={isGeneratingPdf}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs flex items-center space-x-2 transition-all cursor-pointer disabled:opacity-50 border border-emerald-700"
                >
                  {isGeneratingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>Exporting...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 shrink-0" />
                      <span>Download PDF</span>
                    </>
                  )}
                </button>
              )}

              {/* Share Canvas */}
              {canManage && (
                <button
                  onClick={() => {
                    void copyBoardLink();
                    setIsHeaderMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer border ${
                    copiedLink
                      ? "bg-green-500 border-green-600 text-white"
                      : "bg-blue-600 border-blue-700 text-white"
                  }`}
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-4 h-4 shrink-0" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-4 h-4 shrink-0" />
                      <span>Share Canvas</span>
                    </>
                  )}
                </button>
              )}

              {/* Hide Header */}
              <button
                onClick={() => {
                  setIsTopBarHidden(true);
                  setIsHeaderMenuOpen(false);
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all hover:bg-slate-50 text-slate-600 border border-transparent cursor-pointer"
              >
                <EyeOff className="w-4 h-4 shrink-0 text-slate-400" />
                <span>Hide Header</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
