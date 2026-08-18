import React from "react";
import { Lock, Check, WifiOff, Wifi, X } from "lucide-react";
import { BoardElement, UserProfile } from "../../types";

interface ReadOnlyAlertBannerProps {
  show: boolean;
}

export const ReadOnlyAlertBanner: React.FC<ReadOnlyAlertBannerProps> = ({ show }) => {
  if (!show) return null;
  return (
    <div className="fixed top-18 left-1/2 -translate-x-1/2 bg-amber-500 text-white font-bold text-xs px-4 sm:px-5 py-2.5 sm:py-3 rounded-full shadow-2xl z-50 flex items-center space-x-2 border border-amber-400 animate-bounce max-w-[92vw] text-center">
      <Lock className="w-3.5 h-3.5 text-white shrink-0" />
      <span className="truncate sm:whitespace-normal">
        View-Only Mode: The teacher has locked writing access on this board.
      </span>
    </div>
  );
};

interface SyncNotificationToastProps {
  notification: {
    visible: boolean;
    message: string;
    type: "success" | "error" | "warning" | "info";
  };
  onDismiss: () => void;
}

export const SyncNotificationToast: React.FC<SyncNotificationToastProps> = ({
  notification,
  onDismiss,
}) => {
  if (!notification.visible) return null;
  return (
    <div
      className={`fixed bottom-18 sm:bottom-6 right-3 sm:right-6 px-4 py-3 rounded-xl shadow-2xl z-50 flex items-center space-x-2.5 border transition-all duration-300 max-w-[calc(100vw-1.5rem)] ${
        notification.type === "success"
          ? "bg-emerald-600 text-white border-emerald-500"
          : notification.type === "error"
            ? "bg-rose-600 text-white border-rose-500"
            : notification.type === "warning"
              ? "bg-amber-500 text-white border-amber-400"
              : "bg-blue-600 text-white border-blue-500"
      }`}
    >
      {notification.type === "success" && <Check className="w-4 h-4 text-white shrink-0" />}
      {notification.type === "error" && <WifiOff className="w-4 h-4 text-white shrink-0" />}
      {notification.type === "warning" && <WifiOff className="w-4 h-4 text-white shrink-0" />}
      {notification.type === "info" && <Wifi className="w-4 h-4 text-white shrink-0 animate-pulse" />}
      <span className="text-xs font-semibold tracking-wide truncate sm:whitespace-normal">
        {notification.message}
      </span>
      <button
        onClick={onDismiss}
        className="text-white hover:text-white/80 p-0.5 rounded-full hover:bg-white/10 transition-colors cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

interface FollowIndicatorBannerProps {
  followedUserId: string | null;
  collaborators: Record<string, any>;
  onStopFollow: () => void;
}

export const FollowIndicatorBanner: React.FC<FollowIndicatorBannerProps> = ({
  followedUserId,
  collaborators,
  onStopFollow,
}) => {
  if (!followedUserId) return null;
  return (
    <div className="fixed top-18 left-1/2 -translate-x-1/2 z-40 bg-slate-900/90 backdrop-blur-md text-white font-bold text-xs px-4 py-2.5 rounded-2xl shadow-xl border border-slate-700/80 flex items-center space-x-3 animate-fade-in max-w-[94vw]">
      <div className="flex items-center space-x-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
        </span>
        <span>
          Following{" "}
          <strong className="text-blue-400 font-extrabold">
            {collaborators[followedUserId]?.name || "Collaborator"}
          </strong>
          's view
        </span>
      </div>
      <button
        onClick={onStopFollow}
        className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
      >
        Stop Following (Esc)
      </button>
    </div>
  );
};

interface RemoteSelectionsLayerProps {
  elements: BoardElement[];
  remoteSelections: Record<string, any>;
  currentUser: UserProfile;
}

export const RemoteSelectionsLayer: React.FC<RemoteSelectionsLayerProps> = ({
  elements,
  remoteSelections,
  currentUser,
}) => {
  return (
    <>
      {elements.map((el) => {
        if (el.type === "drawing" || el.type === "connector") return null;

        const focusedBy = (Object.entries(remoteSelections) as Array<[string, { selectedIds?: string[]; color?: string; userName?: string }]>).find(
          ([, selection]) => selection.selectedIds?.includes(el.id),
        );

        if (!focusedBy) return null;

        const [focusedUserId, focusInfo] = focusedBy;
        if (focusedUserId === currentUser.id) return null;

        const bounded = el as any;

        return (
          <div
            key={`remote-focus-${el.id}`}
            className="absolute pointer-events-none border transition-all duration-150 z-30"
            style={{
              left: (bounded.x || 0) - 2,
              top: (bounded.y || 0) - 2,
              width: (bounded.width || 100) + 4,
              height: (bounded.height || 80) + 4,
              borderColor: focusInfo.color || "#3b82f6",
              borderStyle: "dashed",
              borderWidth: "2px",
              borderRadius: "8px",
              boxShadow: `0 0 0 1px ${focusInfo.color || "#3b82f6"}33`,
            }}
          >
            <div
              className="absolute left-[-2px] top-[-18px] text-[9px] font-mono font-bold px-1.5 py-0.5 rounded text-white whitespace-nowrap shadow-xs pointer-events-none"
              style={{ backgroundColor: focusInfo.color || "#3b82f6" }}
            >
              {focusInfo.userName || "Collaborator"}
            </div>
          </div>
        );
      })}
    </>
  );
};
