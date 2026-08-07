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
  Users,
  Maximize2,
  Timer as TimerIcon,
  Keyboard,
  Trash2,
} from "lucide-react";
import { UserProfile } from "../../types";
import type { BoardSocketHandle } from "../../services/boardSocketService";
import type { BoardMember, BoardMemberRole } from "../../services/boardMemberService";

interface WhiteboardHeaderProps {
  isZenMode: boolean;
  isTopBarHidden: boolean;
  setIsTopBarHidden: (hidden: boolean) => void;
  onBackToDashboard: () => void;
  boardName: string;
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
  wsRef: React.MutableRefObject<BoardSocketHandle | null>;
  canManage?: boolean;
  studentsCanWrite: boolean;
  handleToggleStudentsCanWrite: () => void;
  boardMembers?: BoardMember[];
  isBoardMembersLoading?: boolean;
  onRefreshBoardMembers?: () => Promise<void>;
  onSetBoardMemberRole?: (userId: string, role: BoardMemberRole) => Promise<void>;
  isPdfBoard: boolean;
  handleDownloadPdfWithDrawings: () => void;
  isGeneratingPdf: boolean;
  handleExportImage: (format: "png" | "svg") => void;
  copyBoardLink: () => void;
  copiedLink: boolean;
  isHeaderMenuOpen: boolean;
  setIsHeaderMenuOpen: (open: boolean) => void;
  onToggleZenMode?: () => void;
  onToggleTimer?: () => void;
  isTimerOpen?: boolean;
  onOpenShortcuts?: () => void;
  onOpenClearModal?: () => void;
}

export const WhiteboardHeader: React.FC<WhiteboardHeaderProps> = ({
  isZenMode,
  isTopBarHidden,
  setIsTopBarHidden,
  onBackToDashboard,
  boardName,
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
  canManage = false,
  studentsCanWrite,
  handleToggleStudentsCanWrite,
  boardMembers = [],
  isBoardMembersLoading = false,
  onRefreshBoardMembers,
  onSetBoardMemberRole,
  isPdfBoard,
  handleDownloadPdfWithDrawings,
  isGeneratingPdf,
  handleExportImage,
  copyBoardLink,
  copiedLink,
  isHeaderMenuOpen,
  setIsHeaderMenuOpen,
  onToggleZenMode,
  onToggleTimer,
  isTimerOpen = false,
  onOpenShortcuts,
  onOpenClearModal,
}) => {
  const [isPeopleMenuOpen, setIsPeopleMenuOpen] = React.useState(false);
  const [memberUpdatingId, setMemberUpdatingId] = React.useState<string | null>(null);

  // The People menu is a live-presence view. When the parent provides the
  // active collaborator id list, an empty list must stay empty rather than
  // falling back to stale socket-ref entries.
  const collaborators = (activeCollaboratorIds
    ? activeCollaboratorIds.map((id) => socketCollaboratorsRef.current[id]).filter(Boolean)
    : Object.values(socketCollaboratorsRef.current)
  ).filter((collab: any) => collab.id !== currentUser.id);

  const togglePresenterMode = () => {
    const nextState = !isPresenterMode;
    setIsPresenterMode(nextState);
    if (nextState) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "request_follow",
          teacherName: currentUser.name,
        }));
      }
      showSyncToast("Started Presenter Mode! Team will follow your screen.", "success");
    } else {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop_follow" }));
      }
      showSyncToast("Exited Presenter Mode.", "info");
    }
  };

  const closeHeaderMenu = () => setIsHeaderMenuOpen(false);

  const handleMemberRoleChange = async (member: BoardMember) => {
    if (!onSetBoardMemberRole || memberUpdatingId) return;
    const nextRole: BoardMemberRole = member.role === "editor" ? "viewer" : "editor";
    setMemberUpdatingId(member.userId);
    try {
      await onSetBoardMemberRole(member.userId, nextRole);
    } catch {
      // Parent owns error reporting so the People menu does not duplicate toasts.
    } finally {
      setMemberUpdatingId(null);
    }
  };

  return (
    <div
      className={`pointer-events-none absolute top-2 sm:top-3 left-2 sm:left-3 right-2 sm:right-3 z-30 flex items-center justify-between gap-2 transition-all duration-300 ${
        isZenMode || isTopBarHidden ? "-translate-y-16 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      {/* Board / history controls */}
      <div className="pointer-events-auto min-w-0 max-w-[calc(100vw-126px)] sm:max-w-[70vw] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-md p-1 flex items-center gap-0.5 sm:gap-1 touch-manipulation">
        <button
          onClick={onBackToDashboard}
          className="min-w-[36px] min-h-[36px] p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200 transition-colors flex items-center justify-center gap-1 text-xs font-bold shrink-0"
          title="All Boards"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden xl:inline">All Boards</span>
        </button>

        <div className="hidden sm:block h-5 w-px bg-slate-200 shrink-0" />

        <div className="min-w-0 flex items-center gap-1.5 px-1">
          <span className="truncate max-w-[88px] sm:max-w-[150px] lg:max-w-[220px] text-xs sm:text-sm font-semibold text-slate-900" title={boardName}>
            {boardName}
          </span>

          {syncStatus === "synced" && (
            <span
              className={`hidden sm:flex items-center gap-1 border px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0 ${
                wsConnected
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                  : "bg-slate-50 text-slate-600 border-slate-200/80"
              }`}
              title={`Cloud: Synced | WebSockets: ${wsConnected ? `Connected (${wsLatency ?? 0}ms)` : "Disconnected"}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
              {wsConnected ? "Live" : "Synced"}
            </span>
          )}
          {syncStatus === "saving-cloud" && (
            <span className="hidden sm:flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200/80 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Syncing
            </span>
          )}
          {syncStatus === "saved-local" && (
            <span className="hidden sm:flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200/80 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0" title="Changes are buffered locally and will sync when possible.">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              Local
            </span>
          )}
          {syncStatus === "offline" && (
            <button
              onClick={() => {
                showSyncToast("Attempting to force sync offline progress...", "info");
                flushPendingChanges();
              }}
              className="hidden sm:flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0"
              title="Offline. Click to retry sync."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              Offline
            </button>
          )}

          <span
            className={`sm:hidden w-2 h-2 rounded-full shrink-0 ${
              syncStatus === "synced" && wsConnected ? "bg-emerald-500 animate-pulse" :
              syncStatus === "synced" ? "bg-emerald-500" :
              syncStatus === "saving-cloud" ? "bg-blue-500 animate-pulse" :
              syncStatus === "saved-local" ? "bg-amber-500 animate-pulse" : "bg-rose-500"
            }`}
            title={`Status: ${syncStatus}`}
          />
        </div>

        <div className="hidden sm:block h-5 w-px bg-slate-200 shrink-0" />

        <button
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          className={`relative min-w-[36px] min-h-[36px] p-2 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
            undoStack.length > 0
              ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200"
              : "text-slate-300 cursor-not-allowed"
          }`}
          title="Undo (Ctrl+Z)"
        >
          <Undo className="w-4 h-4" />
          {undoStack.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-blue-600 text-white text-[8px] font-extrabold flex items-center justify-center">
              {Math.min(99, undoStack.length)}
            </span>
          )}
        </button>

        <button
          onClick={handleRedo}
          disabled={redoStack.length === 0}
          className={`relative min-w-[36px] min-h-[36px] p-2 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
            redoStack.length > 0
              ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200"
              : "text-slate-300 cursor-not-allowed"
          }`}
          title="Redo (Ctrl+Y)"
        >
          <Redo className="w-4 h-4" />
          {redoStack.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-blue-600 text-white text-[8px] font-extrabold flex items-center justify-center">
              {Math.min(99, redoStack.length)}
            </span>
          )}
        </button>
      </div>

      {/* Collaboration / board actions */}
      <div className="pointer-events-auto relative bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/80 shadow-md p-1 flex items-center gap-0.5 sm:gap-1 shrink-0">
        <div className="relative">
          <button
            onClick={() => {
              const nextOpen = !isPeopleMenuOpen;
              setIsPeopleMenuOpen(nextOpen);
              setIsHeaderMenuOpen(false);
              if (nextOpen && canManage && onRefreshBoardMembers) {
                void onRefreshBoardMembers();
              }
            }}
            className={`min-w-[36px] min-h-[36px] p-2 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold border transition-colors ${
              isPeopleMenuOpen || followedUserId
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="People on this board"
          >
            <div className="hidden sm:flex -space-x-1.5">
              <span className="w-4 h-4 rounded-full border-2 border-white" style={{ backgroundColor: currentUser.color }} />
              {collaborators.slice(0, 2).map((collab: any) => (
                <span key={collab.id} className="w-4 h-4 rounded-full border-2 border-white" style={{ backgroundColor: collab.color }} />
              ))}
            </div>
            <Users className="sm:hidden w-4 h-4" />
            <span>{collaborators.length + 1}</span>
          </button>

          {isPeopleMenuOpen && (
            <div className="absolute right-0 top-11 w-[340px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-5rem)] overflow-y-auto bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-2 z-50 animate-fade-in">
              <div className="px-2 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">People</div>
              <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-slate-50">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: currentUser.color }} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{currentUser.name} (You)</span>
              </div>

              {canManage ? (
                <>
                  <div className={`mt-2 mx-1 px-2.5 py-2 rounded-xl text-[10px] font-semibold flex items-center gap-2 ${
                    studentsCanWrite ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {studentsCanWrite ? <Unlock className="w-3.5 h-3.5 shrink-0" /> : <Lock className="w-3.5 h-3.5 shrink-0" />}
                    <span>{studentsCanWrite ? "Global writing is on" : "Global student lock is on"}</span>
                  </div>

                  <div className="px-2 pt-3 pb-1 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>Active users</span>
                    <span className="normal-case tracking-normal text-[9px] font-bold text-slate-400">
                      {collaborators.length + 1} online
                    </span>
                  </div>

                  {collaborators.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-slate-400">No one else is connected right now.</p>
                  ) : (
                    <div className="space-y-1">
                      {collaborators.map((collab: any) => {
                        const member = boardMembers.find((entry) => entry.userId === collab.id);
                        const isFollowed = followedUserId === collab.id;
                        const expiresAt = member?.expiresAt ? Date.parse(member.expiresAt) : NaN;
                        const isExpired = Boolean(member) && Number.isFinite(expiresAt) && expiresAt <= Date.now();
                        const isUpdating = memberUpdatingId === collab.id;
                        const roleLabel = !member
                          ? isBoardMembersLoading ? "Checking..." : "Connected"
                          : isExpired
                            ? "Expired"
                            : member.role === "viewer"
                              ? "View only"
                              : studentsCanWrite
                                ? "Can edit"
                                : "Globally locked";

                        return (
                          <div key={collab.id} className="rounded-xl border border-slate-100 bg-white px-2.5 py-2 shadow-sm">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full shrink-0 border-2 border-white ring-1 ring-emerald-300"
                                style={{ backgroundColor: collab.color }}
                                title="Online"
                              />
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700" title={collab.name}>
                                {collab.name}
                              </span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                                !member || isExpired
                                  ? "bg-slate-100 text-slate-500"
                                  : member.role === "viewer"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-emerald-50 text-emerald-700"
                              }`}>
                                {roleLabel}
                              </span>
                            </div>

                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setFollowedUserId(isFollowed ? null : collab.id)}
                                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                                  isFollowed
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                {isFollowed ? "Following" : "Follow"}
                              </button>

                              {member && (
                                <button
                                  type="button"
                                  onClick={() => void handleMemberRoleChange(member)}
                                  disabled={isExpired || Boolean(memberUpdatingId) || !onSetBoardMemberRole}
                                  className={`min-w-[82px] px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                    member.role === "editor"
                                      ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  }`}
                                >
                                  {isUpdating ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                                  ) : isExpired ? (
                                    "Expired"
                                  ) : member.role === "editor" ? (
                                    "View only"
                                  ) : studentsCanWrite ? (
                                    "Allow edit"
                                  ) : (
                                    "Set editor"
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : collaborators.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-400">No one else is connected right now.</p>
              ) : (
                <div className="mt-1 space-y-1">
                  {collaborators.map((collab: any) => {
                    const isFollowed = followedUserId === collab.id;
                    return (
                      <button
                        key={collab.id}
                        onClick={() => {
                          setFollowedUserId(isFollowed ? null : collab.id);
                          setIsPeopleMenuOpen(false);
                        }}
                        className={`w-full px-2 py-2 rounded-xl flex items-center gap-2 text-left border transition-colors ${
                          isFollowed
                            ? "bg-blue-50 border-blue-200 text-blue-700"
                            : "border-transparent hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: collab.color }} />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{collab.name}</span>
                        <span className="text-[9px] font-bold text-slate-400">{isFollowed ? "Following" : "Follow"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Important active states stay visible without occupying full text buttons. */}
        {isPresenterMode && canManage && (
          <button
            onClick={togglePresenterMode}
            className="hidden sm:flex min-w-[36px] min-h-[36px] p-2 rounded-xl items-center justify-center bg-purple-600 border border-purple-700 text-white shadow-sm ring-2 ring-purple-400/40"
            title="Stop Presenter Mode"
          >
            <Video className="w-4 h-4" />
          </button>
        )}

        {canManage && (
          <button
            onClick={handleToggleStudentsCanWrite}
            className={`hidden sm:flex min-w-[36px] min-h-[36px] p-2 rounded-xl items-center justify-center border transition-colors ${
              studentsCanWrite
                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
            }`}
            title={studentsCanWrite ? "Students can write — click to lock" : "Students are locked — click to allow writing"}
          >
            {studentsCanWrite ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </button>
        )}

        {!canManage && !studentsCanWrite && (
          <div className="min-w-[36px] min-h-[36px] p-2 rounded-xl flex items-center justify-center bg-amber-50 border border-amber-200 text-amber-700" title="View Only Mode">
            <Lock className="w-4 h-4" />
          </div>
        )}

        {canManage && (
          <button
            onClick={copyBoardLink}
            className={`min-w-[36px] min-h-[36px] px-2 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold transition-colors ${
              copiedLink
                ? "bg-emerald-500 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
            title="Share Canvas"
          >
            {copiedLink ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
            <span className="hidden lg:inline">{copiedLink ? "Copied" : "Share"}</span>
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => {
              setIsHeaderMenuOpen(!isHeaderMenuOpen);
              setIsPeopleMenuOpen(false);
            }}
            className={`min-w-[36px] min-h-[36px] p-2 rounded-xl border transition-colors flex items-center justify-center ${
              isHeaderMenuOpen
                ? "bg-slate-100 border-slate-300 text-slate-800"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
            title="More board options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {isHeaderMenuOpen && (
            <div className="absolute right-0 top-11 w-[235px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-5rem)] overflow-y-auto bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-2 z-50 animate-fade-in">
              <div className="px-2 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Board controls</div>

              {canManage && (
                <button
                  onClick={() => {
                    togglePresenterMode();
                    closeHeaderMenu();
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors ${
                    isPresenterMode ? "bg-purple-600 text-white" : "text-purple-700 hover:bg-purple-50"
                  }`}
                >
                  <Video className="w-4 h-4 shrink-0" />
                  <span>{isPresenterMode ? "Stop Presenter Mode" : "Presenter Mode"}</span>
                </button>
              )}

              {canManage && (
                <button
                  onClick={() => {
                    handleToggleStudentsCanWrite();
                    closeHeaderMenu();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {studentsCanWrite ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  <span>{studentsCanWrite ? "Lock student writing" : "Allow student writing"}</span>
                </button>
              )}
              {!canManage && (
                <div className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 ${studentsCanWrite ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"}`}>
                  {studentsCanWrite ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <span>{studentsCanWrite ? "Collaborative Mode" : "View Only Mode"}</span>
                </div>
              )}

              <div className="my-1 h-px bg-slate-100" />

              {isPdfBoard && (
                <button
                  onClick={() => {
                    handleDownloadPdfWithDrawings();
                    closeHeaderMenu();
                  }}
                  disabled={isGeneratingPdf}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>{isGeneratingPdf ? "Exporting PDF..." : "Download PDF"}</span>
                </button>
              )}

              <button
                onClick={() => {
                  handleExportImage("png");
                  closeHeaderMenu();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                <span>Export PNG</span>
              </button>

              <button
                onClick={() => {
                  handleExportImage("svg");
                  closeHeaderMenu();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <FileCode className="w-4 h-4 text-indigo-500" />
                <span>Export SVG</span>
              </button>

              {(onToggleTimer || onToggleZenMode || onOpenShortcuts) && <div className="my-1 h-px bg-slate-100" />}

              {onToggleTimer && (
                <button
                  onClick={() => {
                    onToggleTimer();
                    closeHeaderMenu();
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors ${
                    isTimerOpen ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <TimerIcon className="w-4 h-4" />
                  <span>{isTimerOpen ? "Hide Timer" : "Timer / Stopwatch"}</span>
                </button>
              )}

              {onToggleZenMode && (
                <button
                  onClick={() => {
                    onToggleZenMode();
                    closeHeaderMenu();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Maximize2 className="w-4 h-4" />
                  <span>Full Screen / Zen Mode</span>
                </button>
              )}

              {onOpenShortcuts && (
                <button
                  onClick={() => {
                    onOpenShortcuts();
                    closeHeaderMenu();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Keyboard className="w-4 h-4" />
                  <span>Keyboard Shortcuts</span>
                </button>
              )}

              <div className="my-1 h-px bg-slate-100" />

              <button
                onClick={() => {
                  setIsTopBarHidden(true);
                  closeHeaderMenu();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <EyeOff className="w-4 h-4 text-slate-400" />
                <span>Hide Header</span>
              </button>

              {onOpenClearModal && canManage && (
                <button
                  onClick={() => {
                    onOpenClearModal();
                    closeHeaderMenu();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Clear Canvas...</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
