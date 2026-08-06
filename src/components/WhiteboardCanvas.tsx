import React, { useState, useEffect, useRef } from "react";
import { setDoc, doc } from "../lib/supabaseDb";
import { db, auth, supabase } from "../supabase";
import { isSandboxEnvironment, getSandboxLocalElements, saveSandboxLocalElements } from "../utils/sandboxGuard";
import { getBoardPermissions } from "../utils/boardPermissions";
import {
  subscribeToBoardState,
  queueElementMutation,
  flushBoardCheckpoint,
} from "../services/boardPersistence";
import { getRealtimeAccessToken } from "../services/realtimeAuth";
import {
  BoardElement,
  Point,
  UserProfile,
  StickyElement,
  ShapeElement,
  TextElement,
  DrawingElement,
  ShapeType,
  ImageElement,
  Whiteboard,
  Collaborator,
  ConnectorElement,
  MathElement,
  StampElement,
  TableElement,
} from "../types";

import Toolbar, { Tool } from "./Toolbar";
import StickyComponent from "./StickyComponent";
import ShapeComponent from "./ShapeComponent";
import TextComponent from "./TextComponent";
import MathComponent from "./MathComponent";
import ImageComponent from "./ImageComponent";
import AudioComponent from "./AudioComponent";
import StampComponent from "./StampComponent";
import PdfPageNavigation from "./PdfPageNavigation";
import VoiceRecordModal from "./VoiceRecordModal";
import StampPickerModal from "./StampPickerModal";
import LiveCursors from "./LiveCursors";
import Minimap from "./Minimap";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import ClearCanvasModal from "./ClearCanvasModal";
import { ElementWrapper, DrawingItem, RemoteDrawingStreamsLayer } from "./canvas/ElementWrapper";
import { WhiteboardHeader } from "./canvas/WhiteboardHeader";
import {
  ReadOnlyAlertBanner,
  SyncNotificationToast,
  FollowIndicatorBanner,
  RemoteSelectionsLayer,
} from "./canvas/CanvasOverlays";
import {
  ChevronLeft,
  Share2,
  Copy,
  Check,
  Users,
  Sparkles,
  Keyboard,
  HelpCircle,
  X,
  Undo,
  Redo,
  Trash2,
  Lock,
  Unlock,
  Brain,
  Loader2,
  Wand2,
  Plus,
  PenTool,
  Key,
  Eye,
  EyeOff,
  Zap,
  ZapOff,
  Download,
  Maximize2,
  Minimize2,
  Wifi,
  WifiOff,
  Flame,
  Timer as TimerIcon,
  Video,
  MoreHorizontal,
  Image as ImageIcon,
  FileCode,
} from "lucide-react";
import Markdown from "react-markdown";
import WorkspaceTimer from "./WorkspaceTimer";
import { secureEncrypt, secureDecrypt } from "../utils/crypto";
import { exportPdfWithDrawings } from "../utils/pdf";
import { loadBoardRecoveryCache, scheduleBoardRecoveryCacheSave } from "../utils/boardRecoveryCache";

interface CompressedImage {
  base64Str: string;
  width: number;
  height: number;
}

interface LaserPoint {
  x: number;
  y: number;
  timestamp: number;
  color: string;
}

// Client-side image compression utility to handle high volumes of pasted images safely
// within Supabase documents without needing Supabase Storage.
const compressImage = (file: File): Promise<CompressedImage | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Downscale to max 1600px on any dimension to minimize storage footprint while retaining pristine sharpness
        const MAX_DIM = 1600;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Output as high-quality JPEG (balanced visually and file size-wise)
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64Str: compressedBase64, width, height });
      };
      img.onerror = () => resolve(null);
      img.src = event.target?.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

// Helper to sanitize objects for Supabase (removes undefined fields)
function sanitizeForSupabase(obj: any): any {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForSupabase);
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== undefined) {
      clean[key] = sanitizeForSupabase(val);
    }
  }
  return clean;
}

// Helper to convert drawing points into a smooth SVG path (Quadratic Bezier)
function getSvgPathFromPoints(points: Point[]): string {
  if (!points || points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const cp = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    d += ` Q ${points[i].x} ${points[i].y} ${cp.x} ${cp.y}`;
  }
  d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
  return d;
}

// Helpers for smart connection lines / connectors between shapes
function getElementSocketCoords(el: BoardElement, socket: "top" | "right" | "bottom" | "left"): Point {
  const bounded = el as any;
  const w = bounded.width || 150;
  const h = bounded.height || 150;
  switch (socket) {
    case "top":
      return { x: bounded.x + w / 2, y: bounded.y };
    case "right":
      return { x: bounded.x + w, y: bounded.y + h / 2 };
    case "bottom":
      return { x: bounded.x + w / 2, y: bounded.y + h };
    case "left":
      return { x: bounded.x, y: bounded.y + h / 2 };
  }
}

function getConnectorPath(start: Point, end: Point, fromSocket: string, toSocket?: string): string {
  if (!toSocket) {
    // Smooth Bezier path to user mouse/cursor during dragging
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let cp1 = { x: start.x, y: start.y };
    const strength = Math.min(100, Math.max(30, Math.hypot(dx, dy) * 0.3));
    switch (fromSocket) {
      case "top": cp1.y -= strength; break;
      case "right": cp1.x += strength; break;
      case "bottom": cp1.y += strength; break;
      case "left": cp1.x -= strength; break;
    }
    return `M ${start.x} ${start.y} Q ${cp1.x} ${cp1.y} ${end.x} ${end.y}`;
  }
  
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let cp1 = { x: start.x, y: start.y };
  let cp2 = { x: end.x, y: end.y };
  
  const strength = Math.min(100, Math.max(30, Math.hypot(dx, dy) * 0.3));
  
  switch (fromSocket) {
    case "top": cp1.y -= strength; break;
    case "right": cp1.x += strength; break;
    case "bottom": cp1.y += strength; break;
    case "left": cp1.x -= strength; break;
  }
  
  switch (toSocket) {
    case "top": cp2.y -= strength; break;
    case "right": cp2.x += strength; break;
    case "bottom": cp2.y += strength; break;
    case "left": cp2.x -= strength; break;
  }
  
  return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
}

// High-performance point simplification/downsampling to shrink stroke coordinate sizes
function simplifyPoints(points: Point[], tolerance: number = 1.0): Point[] {
  if (points.length <= 2) return points;
  
  const result: Point[] = [points[0]];
  let lastPoint = points[0];
  
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dx = p.x - lastPoint.x;
    const dy = p.y - lastPoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > tolerance) {
      result.push(p);
      lastPoint = p;
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

interface WhiteboardCanvasProps {
  boardId: string;
  boardName: string;
  currentUser: UserProfile;
  onBackToDashboard: () => void;
  adminClaim?: boolean;
}

const getShardId = (id: string, maxShards: number = 10) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % maxShards;
};

export default function WhiteboardCanvas({
  boardId,
  boardName,
  currentUser,
  onBackToDashboard,
  adminClaim = false,
}: WhiteboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas Viewport State
  const [panX, setPanX] = useState(window.innerWidth / 2 - 400);
  const [panY, setPanY] = useState(window.innerHeight / 2 - 300);
  const [zoom, setZoom] = useState(1);

  const panXRef = useRef(panX);
  const panYRef = useRef(panY);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    panXRef.current = panX;
  }, [panX]);

  useEffect(() => {
    panYRef.current = panY;
  }, [panY]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Whiteboard state hydrates from Supabase. IndexedDB provides a local recovery
  // preview without consuming the small localStorage quota required by OAuth.
  const [elements, setElements] = useState<BoardElement[]>([]);
  
  const [clipboardElements, setClipboardElements] = useState<BoardElement[]>([]);
  const [boardData, setBoardData] = useState<Whiteboard | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const isHydratedRef = useRef(false);
  const [isTopBarHidden, setIsTopBarHidden] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  // Live Screen Following & Modal States
  const [followedUserId, setFollowedUserId] = useState<string | null>(null);
  const followedUserIdRef = useRef<string | null>(null);
  followedUserIdRef.current = followedUserId;
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [containerDimensions, setContainerDimensions] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 1200,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  });

  // Real-Time WebSockets Sync & Caching States
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeCollaboratorIds, setActiveCollaboratorIds] = useState<string[]>([]);
  const socketCollaboratorsRef = useRef<Record<string, Collaborator>>({});
  const remoteDrawingStreamsRef = useRef<Record<string, {
    points: Point[];
    color: string;
    width: number;
    isHighlighter: boolean;
  }>>({});
  const remoteDrawingStreamsDirtyRef = useRef(false);
  const [remoteSelections, setRemoteSelections] = useState<Record<string, {
    userName: string;
    color: string;
    selectedIds: string[];
  }>>({});
  const [wsLatency, setWsLatency] = useState<number | null>(null);

  // Load the complete local recovery snapshot from IndexedDB while the cloud
  // manifest is hydrating. The authoritative Supabase state replaces it later.
  useEffect(() => {
    let cancelled = false;
    void loadBoardRecoveryCache(boardId).then((cachedElements) => {
      if (cancelled || isHydratedRef.current || cachedElements.length === 0) return;
      setElements(cachedElements);
      elementsRef.current = cachedElements;
    });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  // Do not load the legacy `drawings_${boardId}` cache here. That cache was
  // device-local and replaced the authoritative cloud drawing set, making two
  // collaborators appear to be on separate boards. The full recovery cache
  // above is only a temporary preview; Supabase always replaces it after load.

  // Connect to the authenticated same-origin WebSocket relay. The server rejects
  // the old unauthenticated `join` protocol, so the first message must contain
  // a current Supabase access token and the board ID.
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let reconnectAttempt = 0;

    const clearPing = () => {
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = null;
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      const baseDelay = Math.min(10_000, 1_000 * 2 ** Math.min(reconnectAttempt, 3));
      const jitter = Math.floor(Math.random() * 400);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, baseDelay + jitter);
    };

    const connect = () => {
      if (stopped) return;
      const nextSocket = new WebSocket(wsUrl);
      socket = nextSocket;

      nextSocket.onopen = () => {
        void getRealtimeAccessToken()
          .then((accessToken) => {
            if (stopped || nextSocket.readyState !== WebSocket.OPEN) return;
            nextSocket.send(JSON.stringify({
              type: "authenticate",
              accessToken,
              boardId,
            }));
          })
          .catch((error) => {
            console.error("Unable to authenticate the collaboration socket:", error);
            if (nextSocket.readyState === WebSocket.OPEN) {
              nextSocket.close(1008, "Authentication failed");
            }
          });
      };

      nextSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));

          if (msg.type === "authenticated") {
            if (msg.boardId !== boardId) {
              nextSocket.close(1008, "Wrong board");
              return;
            }
            reconnectAttempt = 0;
            wsRef.current = nextSocket;
            setWsConnected(true);
            clearPing();
            pingInterval = setInterval(() => {
              if (wsRef.current === nextSocket && nextSocket.readyState === WebSocket.OPEN) {
                nextSocket.send(JSON.stringify({ type: "ping", id: Date.now() }));
              }
            }, 15_000);
            return;
          }

          if (msg.type === "auth_error") {
            console.error("Collaboration socket authorization failed:", msg.error || "Unknown error");
            nextSocket.close(1008, "Authorization failed");
            return;
          }

          if (msg.type === "permission_updated") {
            setBoardData((previous) => previous ? ({
              ...previous,
              effectivePermission: msg.permission,
              effectiveCanWrite: msg.canWrite === true,
              effectiveCanManage: msg.canManage === true,
            } as any) : previous);
            return;
          }

          // Ignore collaboration traffic until authentication is confirmed.
          if (wsRef.current !== nextSocket) return;

          if (msg.type === "cursor") {
            if (msg.userId === currentUser.id) return;
            const isNew = !socketCollaboratorsRef.current[msg.userId];
            socketCollaboratorsRef.current[msg.userId] = {
              id: msg.userId,
              name: msg.name,
              color: msg.color,
              role: msg.role,
              x: msg.x,
              y: msg.y,
              panX: msg.panX,
              panY: msg.panY,
              zoom: msg.zoom,
              lastActive: msg.lastActive,
            };
            if (isNew) setActiveCollaboratorIds(Object.keys(socketCollaboratorsRef.current));

            if (followedUserIdRef.current === msg.userId) {
              const targetZoom = msg.zoom !== undefined ? msg.zoom : 1;
              const containerW = window.innerWidth;
              const containerH = window.innerHeight;

              if (msg.x !== undefined && msg.y !== undefined) {
                const targetPanX = containerW / 2 - msg.x * targetZoom;
                const targetPanY = containerH / 2 - msg.y * targetZoom;
                setPanX((prev) => prev + (targetPanX - prev) * 0.35);
                setPanY((prev) => prev + (targetPanY - prev) * 0.35);
                setZoom((prev) => prev + (targetZoom - prev) * 0.35);
              } else if (msg.panX !== undefined && msg.panY !== undefined) {
                setPanX((prev) => prev + (msg.panX - prev) * 0.35);
                setPanY((prev) => prev + (msg.panY - prev) * 0.35);
                setZoom((prev) => prev + (targetZoom - prev) * 0.35);
              }
            }
          } else if (msg.type === "request_follow") {
            if (currentUser.role !== "teacher" && msg.teacherId) {
              setFollowedUserId(msg.teacherId);
              showSyncToast(`${msg.teacherName || "Teacher"} is sharing view! Following screen...`, "info");
            }
          } else if (msg.type === "stop_follow") {
            if (currentUser.role !== "teacher") {
              setFollowedUserId(null);
              showSyncToast("Teacher has stopped sharing their view.", "info");
            }
          } else if (msg.type === "drawing_stream") {
            remoteDrawingStreamsRef.current[msg.userId] = {
              points: msg.points,
              color: msg.color,
              width: msg.width,
              isHighlighter: msg.isHighlighter,
            };
            remoteDrawingStreamsDirtyRef.current = true;
          } else if (msg.type === "drawing_stream_end") {
            delete remoteDrawingStreamsRef.current[msg.userId];
            remoteDrawingStreamsDirtyRef.current = true;
          } else if (msg.type === "element_update") {
            const { elementId, elementData, actionType, isMerge } = msg;
            setElements((prev) => {
              let updated: BoardElement[];
              if (actionType === "delete") {
                updated = prev.filter((element) => element.id !== elementId);
              } else {
                const exists = prev.some((element) => element.id === elementId);
                if (exists) {
                  updated = prev.map((element) => element.id === elementId
                    ? (isMerge ? { ...element, ...elementData, id: elementId } : { ...elementData, id: elementId })
                    : element);
                } else {
                  updated = [...prev, { ...elementData, id: elementId } as BoardElement];
                }
              }
              elementsRef.current = updated;
              scheduleBoardRecoveryCacheSave(boardId, updated);
              return updated;
            });
          } else if (msg.type === "element_focus") {
            setRemoteSelections((prev) => ({
              ...prev,
              [msg.userId]: {
                userName: msg.userName,
                color: msg.color,
                selectedIds: msg.selectedIds,
              },
            }));
          } else if (msg.type === "laser_point") {
            if (msg.userId === currentUser.id) return;
            const now = Date.now();
            const existing = remoteLaserPointsRef.current[msg.userId] || [];
            const active = existing.filter((point) => now - point.timestamp < 1500);
            remoteLaserPointsRef.current[msg.userId] = [
              ...active,
              {
                x: msg.x,
                y: msg.y,
                timestamp: msg.timestamp || now,
                color: msg.color || "#ef4444",
              },
            ];
          } else if (msg.type === "timer_sync") {
            setSyncedTimerState(msg.state);
            if (msg.isOpen !== undefined) setIsTimerOpen(msg.isOpen);
            else if (msg.state && (msg.state.isRunning || msg.state.isOpen)) setIsTimerOpen(true);
          } else if (msg.type === "pong") {
            setWsLatency(Date.now() - msg.id);
          }
        } catch (error) {
          console.error("Client WebSocket message parsing error:", error);
        }
      };

      nextSocket.onclose = () => {
        if (wsRef.current === nextSocket) wsRef.current = null;
        setWsConnected(false);
        setWsLatency(null);
        clearPing();
        socketCollaboratorsRef.current = {};
        setActiveCollaboratorIds([]);
        setRemoteSelections({});
        scheduleReconnect();
      };

      nextSocket.onerror = () => {
        setWsConnected(false);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearPing();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (wsRef.current === socket) wsRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "Board closed");
    };
  }, [boardId, currentUser.id, currentUser.role]);

  // Keep socket cursors fresh by purging idle collaborators every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const updated = { ...socketCollaboratorsRef.current };
      Object.keys(updated).forEach((userId) => {
        if (now - updated[userId].lastActive > 15000) {
          delete updated[userId];
          changed = true;
        }
      });
      if (changed) {
        socketCollaboratorsRef.current = updated;
        setActiveCollaboratorIds(Object.keys(updated));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);


  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dragSelectStart, setDragSelectStart] = useState<Point | null>(null);
  const [dragSelectEnd, setDragSelectEnd] = useState<Point | null>(null);
  const [elementStartPositions, setElementStartPositions] = useState<Record<string, any>>({});

  // Broadcast local selection changes to other users
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "element_focus",
        boardId,
        userId: currentUser.id,
        userName: currentUser.name,
        color: currentUser.color,
        selectedIds
      }));
    }
  }, [selectedIds, boardId, currentUser.id, currentUser.name, currentUser.color, wsConnected]);

  // Keep remote selections in sync with active collaborators
  useEffect(() => {
    const activeUserIds = new Set(activeCollaboratorIds);
    setRemoteSelections((prev) => {
      let changed = false;
      const filtered = { ...prev };
      Object.keys(filtered).forEach((uId) => {
        if (!activeUserIds.has(uId)) {
          delete filtered[uId];
          changed = true;
        }
      });
      return changed ? filtered : prev;
    });
  }, [activeCollaboratorIds]);

  // Elements Ref to always bypass stale closure contexts safely in async event handlers
  const elementsRef = useRef<BoardElement[]>([]);
  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  // Write Minimization & Offline Persistence States & Refs
  const [activeUsersCount, setActiveUsersCount] = useState<number>(1);
  const activeUsersCountRef = useRef<number>(1);
  useEffect(() => {
    activeUsersCountRef.current = activeUsersCount;
  }, [activeUsersCount]);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving-cloud' | 'saved-local' | 'offline'>('synced');
  const hasUnsavedChanges = useRef<boolean>(false);
  const pendingSyncElements = useRef<Record<string, { data: any; action: 'set' | 'delete' }>>({});
  const debounceTimer = useRef<any>(null);
  const isMigratingRef = useRef<boolean>(false);
  const attemptedMigrationRef = useRef<Set<string>>(new Set());

  const [syncNotification, setSyncNotification] = useState<{
    message: string;
    type: 'success' | 'info' | 'warning' | 'error';
    visible: boolean;
  }>({ message: '', type: 'info', visible: false });
  const syncNotificationTimeoutRef = useRef<any>(null);

  const showSyncToast = React.useCallback((message: string, type: 'success' | 'info' | 'warning' | 'error' = 'info', duration: number = 4000) => {
    if (syncNotificationTimeoutRef.current) clearTimeout(syncNotificationTimeoutRef.current);
    setSyncNotification({ message, type, visible: true });
    syncNotificationTimeoutRef.current = setTimeout(() => {
      setSyncNotification(prev => ({ ...prev, visible: false }));
    }, duration);
  }, []);

  useEffect(() => {
    const handleSyncStatus = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        boardId?: string;
        status?: 'synced' | 'saving-cloud' | 'saved-local' | 'offline';
        message?: string;
      };
      if (detail?.boardId !== boardId || !detail.status) return;
      setSyncStatus(detail.status);
      hasUnsavedChanges.current = detail.status === 'saved-local' || detail.status === 'offline';
      if (detail.status === 'offline' && detail.message) {
        showSyncToast(`Sync failed: ${detail.message}`, 'error', 10000);
      }
    };

    window.addEventListener('lucid_spark_sync_status', handleSyncStatus);
    return () => window.removeEventListener('lucid_spark_sync_status', handleSyncStatus);
  }, [boardId, showSyncToast]);

  const handleSetFollowedUser = React.useCallback(
    (targetId: string | null) => {
      setFollowedUserId((prev) => {
        const nextId = prev === targetId ? null : targetId;
        followedUserIdRef.current = nextId;

        if (nextId) {
          const targetCollab = socketCollaboratorsRef.current[nextId];
          if (targetCollab) {
            const targetZoom = targetCollab.zoom || 1;
            const containerW = window.innerWidth;
            const containerH = window.innerHeight;

            let targetPanX = targetCollab.panX;
            let targetPanY = targetCollab.panY;

            if (targetCollab.x !== undefined && targetCollab.y !== undefined) {
              targetPanX = containerW / 2 - targetCollab.x * targetZoom;
              targetPanY = containerH / 2 - targetCollab.y * targetZoom;
            }

            if (targetPanX !== undefined && targetPanY !== undefined) {
              setZoom(targetZoom);
              setPanX(targetPanX);
              setPanY(targetPanY);
            }

            showSyncToast(`Now following ${targetCollab.name}'s view`, "info");
          } else {
            showSyncToast("Following user...", "info");
          }
        } else if (prev !== null) {
          showSyncToast("Stopped following user.", "info");
        }

        return nextId;
      });
    },
    [showSyncToast]
  );

  // Undo History state
  interface UndoAction {
    type: "add" | "delete" | "update";
    elementId: string;
    beforeData?: any;
    afterData?: any;
  }
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);

  const pushToUndo = React.useCallback((action: UndoAction) => {
    setUndoStack((prev) => [...prev, action]);
    setRedoStack([]); // standard clear redo on new action
  }, []);

  // Active Tool state
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [activeColor, setActiveColor] = useState("#000000"); // default black color
  const [activeShape, setActiveShape] = useState<ShapeType>("rect");
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [gridMode, setGridMode] = useState<"dots" | "math" | "none">("dots");
  const [isZenMode, setIsZenMode] = useState(false);

  // Interaction State flags
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  const [tempConnector, setTempConnector] = useState<{
    fromId: string;
    fromSocket: "top" | "right" | "bottom" | "left";
    startPoint: Point;
    currentPoint: Point;
  } | null>(null);
  const [snapLines, setSnapLines] = useState<{ x?: number; y?: number } | null>(null);
  const [elementStartPos, setElementStartPos] = useState<Point>({ x: 0, y: 0 });
  const [elementStartSize, setElementStartSize] = useState<{
    w: number;
    h: number;
  }>({ w: 0, h: 0 });

  // Floating Workspace Timer & Presenter / Laser Pointer States
  const [isTimerOpen, setIsTimerOpen] = useState(false);
  const [syncedTimerState, setSyncedTimerState] = useState<any>(null);
  const [isPresenterMode, setIsPresenterMode] = useState(false);
  
  // High performance: Laser Pointer trails stored in Refs and drawn directly to a separate transparent canvas
  const localLaserPointsRef = useRef<LaserPoint[]>([]);
  const remoteLaserPointsRef = useRef<{ [userId: string]: LaserPoint[] }>({});
  const laserCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Kami Tools Modals & Navigation States
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isStampModalOpen, setIsStampModalOpen] = useState(false);
  const [pendingVoiceCoords, setPendingVoiceCoords] = useState<Point | null>(null);
  const [pendingStampCoords, setPendingStampCoords] = useState<Point | null>(null);
  const [activePdfPageIndex, setActivePdfPageIndex] = useState(0);

  const pdfPages = React.useMemo(() => {
    return elements.filter((el) => el.type === "image" && typeof el.id === "string" && el.id.startsWith("pdf-page-")) as ImageElement[];
  }, [elements]);

  const sortedElements = React.useMemo(() => {
    return [...elements].sort((a, b) => {
      const aIsPdf = typeof a?.id === "string" && a.id.startsWith("pdf-page-");
      const bIsPdf = typeof b?.id === "string" && b.id.startsWith("pdf-page-");

      if (aIsPdf && !bIsPdf) return -1;
      if (!aIsPdf && bIsPdf) return 1;

      const zA = typeof a?.zIndex === "number" ? a.zIndex : (aIsPdf ? -1 : 10);
      const zB = typeof b?.zIndex === "number" ? b.zIndex : (bIsPdf ? -1 : 10);

      return zA - zB;
    });
  }, [elements]);

  const handleJumpToPdfPage = React.useCallback((pageIndex: number) => {
    const page = pdfPages[pageIndex];
    if (!page) return;
    setActivePdfPageIndex(pageIndex);
    const containerW = containerDimensions.width || 1200;
    const containerH = containerDimensions.height || 800;
    const targetZoom = Math.min(1.2, (containerH - 120) / (page.height || 800));
    const targetPanX = containerW / 2 - (page.x + page.width / 2) * targetZoom;
    const targetPanY = containerH / 2 - (page.y + page.height / 2) * targetZoom;

    setZoom(targetZoom);
    setPanX(targetPanX);
    setPanY(targetPanY);
  }, [pdfPages, containerDimensions]);

  const handleTimerSync = React.useCallback((timerState: any) => {
    setSyncedTimerState(timerState);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "timer_sync",
          boardId,
          state: timerState,
          isOpen: isTimerOpen,
        })
      );
    }
  }, [boardId, isTimerOpen]);

  // Decay and Draw laser trails on Canvas
  const drawLaserTrails = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.clearRect(0, 0, width, height);
    const now = Date.now();

    // Collect all streams to draw
    const streams: { color: string; points: LaserPoint[] }[] = [];
    
    // Filter out expired local points
    localLaserPointsRef.current = localLaserPointsRef.current.filter(p => now - p.timestamp < 1500);
    if (localLaserPointsRef.current.length > 0) {
      streams.push({ color: activeColorRef.current || "#ef4444", points: localLaserPointsRef.current });
    }

    // Filter out expired remote points
    const updatedRemote: typeof remoteLaserPointsRef.current = {};
    Object.entries(remoteLaserPointsRef.current).forEach(([uid, rawPoints]) => {
      const points = rawPoints as LaserPoint[];
      const active = points.filter((point) => now - point.timestamp < 1500);
      if (active.length > 0) {
        updatedRemote[uid] = active;
        streams.push({ color: active[0]?.color || "#ef4444", points: active });
      }
    });
    remoteLaserPointsRef.current = updatedRemote;

    streams.forEach(stream => {
      const pts = stream.points;
      if (pts.length === 0) return;
      const color = stream.color || "#ef4444";

      // Draw fading line segments
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 1; i < pts.length; i++) {
        const prevPt = pts[i - 1];
        const pt = pts[i];
        
        // Convert canvas coordinates to screen coordinates
        const prevScreenX = prevPt.x * zoomRef.current + panXRef.current;
        const prevScreenY = prevPt.y * zoomRef.current + panYRef.current;
        const screenX = pt.x * zoomRef.current + panXRef.current;
        const screenY = pt.y * zoomRef.current + panYRef.current;

        const age = now - pt.timestamp;
        const alpha = Math.max(0, 1 - age / 1500);
        const strokeW = 3 + alpha * 5;

        ctx.beginPath();
        ctx.moveTo(prevScreenX, prevScreenY);
        ctx.lineTo(screenX, screenY);
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeW;
        ctx.globalAlpha = alpha;

        // Apply a glowing effect
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.stroke();
      }

      // Reset shadow for tip drawing
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1.0;

      // Draw Glowing Laser Pointer Tip Dot
      const latestPt = pts[pts.length - 1];
      const screenX = latestPt.x * zoomRef.current + panXRef.current;
      const screenY = latestPt.y * zoomRef.current + panYRef.current;

      // Pulsing outer glow radius
      const pulse = 1 + 0.2 * Math.sin(now / 100);
      const outerR = 12 * pulse;

      // Outer halo
      ctx.beginPath();
      ctx.arc(screenX, screenY, outerR, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.fill();

      // Middle dot with shadow glow
      ctx.beginPath();
      ctx.arc(screenX, screenY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fill();

      // Reset shadow
      ctx.shadowBlur = 0;

      // Inner white core
      ctx.beginPath();
      ctx.arc(screenX, screenY, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 1.0;
      ctx.fill();
    });
  };

  // Continuous animation loop to decay fading laser trail points smoothly
  useEffect(() => {
    let animId: number;
    const tick = () => {
      const canvas = laserCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Adjust canvas internal size to actual display size (supports high DPI)
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          const width = Math.round(rect.width * dpr);
          const height = Math.round(rect.height * dpr);
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            ctx.scale(dpr, dpr);
          }
          drawLaserTrails(ctx, rect.width, rect.height);
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Permission states using getBoardPermissions
  const activeAuthUser = auth.currentUser
    ? { uid: auth.currentUser.uid, admin: adminClaim }
    : currentUser?.id
      ? { uid: currentUser.id }
      : null;

  const permissions = getBoardPermissions(boardData, activeAuthUser);

  const [showReadOnlyAlert, setShowReadOnlyAlert] = useState(false);
  const alertTimeoutRef = useRef<any>(null);
  const isTeacher = currentUser.role === "teacher" || permissions.isOwner || permissions.isAdmin;
  const studentsCanWrite = boardData?.studentsCanWrite !== false;
  const canWrite = isSandboxEnvironment() || permissions.canWrite;
  const canManage = isSandboxEnvironment() || permissions.canManage;

  const isPdfBoard = boardName.startsWith("PDF: ");
  const [hasCentered, setHasCentered] = useState(false);

  // Mirror refs for multi-touch and touch gesture synchronization
  const activeToolRef = useRef(activeTool);
  const selectedIdRef = useRef(selectedId);
  const selectedIdsRef = useRef(selectedIds);
  const isPanningRef = useRef(isPanning);
  const isDraggingRef = useRef(isDragging);
  const isResizingRef = useRef(isResizing);
  const activeColorRef = useRef(activeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const dragStartRef = useRef(dragStart);
  const canWriteRef = useRef(canWrite);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    isPanningRef.current = isPanning;
  }, [isPanning]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing]);

  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);

  useEffect(() => {
    strokeWidthRef.current = strokeWidth;
  }, [strokeWidth]);

  useEffect(() => {
    dragStartRef.current = dragStart;
  }, [dragStart]);

  useEffect(() => {
    canWriteRef.current = canWrite;
  }, [canWrite]);

  const isTeacherRef = useRef(isTeacher);
  useEffect(() => {
    isTeacherRef.current = isTeacher;
  }, [isTeacher]);

  // Anti-spam rate limiting for element creation & paste actions
  const creationTimestampsRef = useRef<number[]>([]);

  const checkCreationRateLimit = React.useCallback((maxActions = 6, windowMs = 3000): boolean => {
    if (isTeacherRef.current) return true; // Teachers are exempt from anti-spam rate limits
    const now = Date.now();
    const recent = creationTimestampsRef.current.filter(t => now - t < windowMs);
    if (recent.length >= maxActions) {
      showSyncToast("Slow down! Please wait a moment before creating more items.", "warning", 3000);
      return false;
    }
    recent.push(now);
    creationTimestampsRef.current = recent;
    return true;
  }, [showSyncToast]);

  useEffect(() => {
    if (isPdfBoard && elements.length > 0 && !hasCentered && containerRef.current) {
      const pdfPages = elements.filter((el) => typeof el?.id === "string" && el.id.startsWith("pdf-page-"));
      if (pdfPages.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pdfPages.forEach((el) => {
          const img = el as ImageElement;
          minX = Math.min(minX, img.x);
          minY = Math.min(minY, img.y);
          maxX = Math.max(maxX, img.x + img.width);
          maxY = Math.max(maxY, img.y + img.height);
        });

        const rect = containerRef.current.getBoundingClientRect();
        const contentWidth = maxX - minX;
        const targetZoom = Math.min(1.0, (rect.width * 0.9) / contentWidth);
        const newZoom = Math.max(0.4, targetZoom);

        setZoom(newZoom);
        setPanX(rect.width / 2 - (minX + contentWidth / 2) * newZoom);
        setPanY(60); 
        setHasCentered(true);
      }
    }
  }, [isPdfBoard, elements, hasCentered]);

  const handleToggleZenMode = () => {
    const nextZenMode = !isZenMode;
    setIsZenMode(nextZenMode);

    if (nextZenMode) {
      const elem = document.getElementById("whiteboard-workspace");
      if (elem && elem.requestFullscreen) {
        elem.requestFullscreen().catch((err) => {
          console.warn("Fullscreen API rejected or not allowed in iframe:", err);
        });
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.warn("Error exiting fullscreen:", err);
        });
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      setIsZenMode(isCurrentlyFullscreen);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const triggerReadOnlyAlert = () => {
    setShowReadOnlyAlert(true);
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    alertTimeoutRef.current = setTimeout(() => {
      setShowReadOnlyAlert(false);
    }, 3000);
  };

  // In-progress local drawings (drawn locally on canvas for zero-latency feedback)
  const localDrawingPathRef = useRef<SVGPathElement>(null);

  // Drawing state tracking via refs to bypass React state-update asynchronous latency/closures
  const isDrawingRef = useRef(false);
  const drawingPointsRef = useRef<Point[]>([]);
  const lastStreamBroadcast = useRef<number>(0);

  // Clear confirmation modal state
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Copy share button state
  const [copiedLink, setCopiedLink] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleDownloadPdfWithDrawings = async () => {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    try {
      await exportPdfWithDrawings(elements, boardName);
    } catch (err) {
      console.error("Error exporting PDF:", err);
      alert("Failed to export PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleExportImage = (format: 'png' | 'svg') => {
    try {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      elements.forEach((el) => {
        if ('x' in el && 'y' in el) {
          const bounded = el as any;
          const w = bounded.width || 140;
          const h = bounded.height || 60;
          minX = Math.min(minX, bounded.x);
          minY = Math.min(minY, bounded.y);
          maxX = Math.max(maxX, bounded.x + w);
          maxY = Math.max(maxY, bounded.y + h);
        } else if (el.type === 'drawing' && el.points) {
          el.points.forEach((p) => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          });
        }
      });

      // If board is empty, default bounding box
      if (minX === Infinity || minY === Infinity) {
        minX = 0;
        minY = 0;
        maxX = 800;
        maxY = 600;
      } else {
        // Add padding
        minX -= 50;
        minY -= 50;
        maxX += 50;
        maxY += 50;
      }

      const exportWidth = maxX - minX;
      const exportHeight = maxY - minY;

      const escapeXml = (unsafe: string): string => {
        return unsafe.replace(/[<>&'"]/g, (c) => {
          switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
          }
        });
      };

      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${exportWidth} ${exportHeight}" width="${exportWidth}" height="${exportHeight}" style="background-color: #f8fafc;">`;
      
      svgContent += `<style>
        .svg-text { font-family: system-ui, -apple-system, sans-serif; font-weight: bold; }
        .svg-title { font-family: system-ui, -apple-system, sans-serif; font-weight: 900; }
      </style>`;

      elements.forEach((el) => {
        if (el.type === 'sticky') {
          svgContent += `
            <g id="el-${el.id}">
              <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="12" fill="${el.color || '#fef08a'}" stroke="#cbd5e1" stroke-width="1" />
              <text x="${el.x + el.width/2}" y="${el.y + el.height/2}" dominant-baseline="middle" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="600" class="svg-text">${escapeXml(el.text || '')}</text>
            </g>
          `;
        } else if (el.type === 'shape') {
          const rx = el.shapeType === 'circle' ? el.width / 2 : 8;
          const ry = el.shapeType === 'circle' ? el.height / 2 : 8;
          
          if (el.shapeType === 'circle') {
            svgContent += `
              <g id="el-${el.id}">
                <ellipse cx="${el.x + el.width/2}" cy="${el.y + el.height/2}" rx="${rx}" ry="${ry}" fill="${el.color || '#bfdbfe'}" stroke="${el.borderColor || '#3b82f6'}" stroke-width="2" />
                <text x="${el.x + el.width/2}" y="${el.y + el.height/2}" dominant-baseline="middle" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="600" class="svg-text">${escapeXml(el.text || '')}</text>
              </g>
            `;
          } else {
            svgContent += `
              <g id="el-${el.id}">
                <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${rx}" fill="${el.color || '#bfdbfe'}" stroke="${el.borderColor || '#3b82f6'}" stroke-width="2" />
                <text x="${el.x + el.width/2}" y="${el.y + el.height/2}" dominant-baseline="middle" text-anchor="middle" fill="#1e293b" font-size="14" font-weight="600" class="svg-text">${escapeXml(el.text || '')}</text>
              </g>
            `;
          }
        } else if (el.type === 'text') {
          svgContent += `
            <g id="el-${el.id}">
              <text x="${el.x}" y="${el.y + 20}" fill="${el.color || '#1e293b'}" font-size="${el.fontSize || 16}" font-weight="bold" class="svg-text">${escapeXml(el.text || '')}</text>
            </g>
          `;
        } else if (el.type === 'drawing') {
          if (el.points && el.points.length > 0) {
            let pathD = `M ${el.points[0].x} ${el.points[0].y}`;
            for (let i = 1; i < el.points.length; i++) {
              pathD += ` L ${el.points[i].x} ${el.points[i].y}`;
            }
            svgContent += `
              <g id="el-${el.id}">
                <path d="${pathD}" fill="none" stroke="${el.color || '#1e293b'}" stroke-width="${el.width || 3}" stroke-linecap="round" stroke-linejoin="round" opacity="${el.isHighlighter ? 0.4 : 1}" />
              </g>
            `;
          }
        } else if (el.type === 'stamp') {
          const bgColor = el.color || '#4f46e5';
          svgContent += `
            <g id="el-${el.id}">
              <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="16" fill="${bgColor}" stroke="#cbd5e1" stroke-width="1.5" />
              <text x="${el.x + el.width/2}" y="${el.y + el.height/2}" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="13" font-weight="900" class="svg-text">${escapeXml(el.label || 'STAMP')}</text>
            </g>
          `;
        } else if (el.type === 'connector') {
          const conn = el as ConnectorElement;
          const fromEl = elements.find((e) => e.id === conn.fromId);
          const toEl = conn.toId ? elements.find((e) => e.id === conn.toId) : null;
          
          if (fromEl) {
            const start = getElementSocketCoords(fromEl, conn.fromSocket);
            const end = toEl ? getElementSocketCoords(toEl, conn.toSocket || "top") : (conn.endPoint || start);

            svgContent += `
              <g id="el-${el.id}">
                <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${conn.color || '#475569'}" stroke-width="${conn.strokeWidth || 2.5}" />
                ${conn.label ? `
                  <rect x="${(start.x + end.x)/2 - 40}" y="${(start.y + end.y)/2 - 10}" width="80" height="20" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1" />
                  <text x="${(start.x + end.x)/2}" y="${(start.y + end.y)/2}" dominant-baseline="middle" text-anchor="middle" fill="#475569" font-size="10" font-weight="bold" class="svg-text">${escapeXml(conn.label)}</text>
                ` : ''}
              </g>
            `;
          }
        } else if (el.type === 'math') {
          svgContent += `
            <g id="el-${el.id}">
              <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="8" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
              <text x="${el.x + el.width/2}" y="${el.y + el.height/2}" dominant-baseline="middle" text-anchor="middle" fill="${el.color || '#0f172a'}" font-size="${el.fontSize || 14}" class="svg-text">${escapeXml(el.text || '')}</text>
            </g>
          `;
        } else if (el.type === 'table') {
          const tbl = el as TableElement;
          const rows = tbl.rows || 3;
          const cols = tbl.cols || 3;
          const cellWidth = tbl.width / cols;
          const cellHeight = tbl.height / rows;
          const data = tbl.data || [];
          const headerBg = tbl.headerBgColor || "#f1f5f9";
          const cellBg = tbl.cellBgColor || "#ffffff";
          const borderCol = tbl.borderColor || "#cbd5e1";
          const textCol = tbl.textColor || "#0f172a";

          svgContent += `<g id="el-${el.id}">`;
          for (let r = 0; r < rows; r++) {
            const isH = tbl.hasHeaderRow && r === 0;
            const bg = isH ? headerBg : cellBg;
            for (let c = 0; c < cols; c++) {
              const cx = tbl.x + c * cellWidth;
              const cy = tbl.y + r * cellHeight;
              const cellText = data[r]?.[c] || "";
              svgContent += `
                <rect x="${cx}" y="${cy}" width="${cellWidth}" height="${cellHeight}" fill="${bg}" stroke="${borderCol}" stroke-width="1" />
                <text x="${cx + 8}" y="${cy + cellHeight/2}" dominant-baseline="middle" fill="${textCol}" font-size="${tbl.fontSize || 14}" font-weight="${isH ? 'bold' : 'normal'}" class="svg-text">${escapeXml(cellText)}</text>
              `;
            }
          }
          svgContent += `</g>`;
        }
      });

      svgContent += `</svg>`;

      const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const safeBoardName = (boardName || "whiteboard").replace(/[^a-z0-9]/gi, '_').toLowerCase();

      if (format === 'svg') {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeBoardName}_export.svg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showSyncToast("Vector SVG exported successfully!", "success");
      } else {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = exportWidth;
          canvas.height = exportHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, exportWidth, exportHeight);
            ctx.drawImage(img, 0, 0);
            
            try {
              const pngUrl = canvas.toDataURL('image/png');
              const link = document.createElement('a');
              link.href = pngUrl;
              link.download = `${safeBoardName}_export.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              showSyncToast("High-resolution PNG exported successfully!", "success");
            } catch (e) {
              console.error("Error generating canvas data URL for PNG", e);
              showSyncToast("Could not export PNG. Please download as SVG instead.", "error");
            }
          }
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
    } catch (err: any) {
      console.error("Export error:", err);
      showSyncToast("Failed to export image: " + err.message, "error");
    }
  };

  const [isShortcutsExpanded, setIsShortcutsExpanded] = useState(true);

  // Fetch board elements in real time using boardPersistence service
  useEffect(() => {
    if (isSandboxEnvironment()) {
      const initial = getSandboxLocalElements(boardId);
      setElements(initial);
      setIsHydrated(true);
      isHydratedRef.current = true;

      const handleLocalElementsUpdate = (e: CustomEvent) => {
        if (e.detail && e.detail.boardId === boardId) {
          const updated = getSandboxLocalElements(boardId);
          setElements(updated);
        }
      };

      window.addEventListener('lucid_spark_elements_updated', handleLocalElementsUpdate as EventListener);
      return () => {
        window.removeEventListener('lucid_spark_elements_updated', handleLocalElementsUpdate as EventListener);
      };
    }

    const unsubscribe = subscribeToBoardState(boardId, (state) => {
      setElements(state.elements);
      if (state.boardData) {
        setBoardData({
          id: boardId,
          ...state.boardData,
        } as Whiteboard);
      }
      setIsHydrated(true);
      isHydratedRef.current = true;
    });

    return () => {
      unsubscribe();
    };
  }, [boardId]);

  // Live collaborator count comes from the zero-database WebSocket relay.
  useEffect(() => {
    setActiveUsersCount(wsConnected ? activeCollaboratorIds.length + 1 : 1);
  }, [activeCollaboratorIds, wsConnected]);

  // Native non-passive Wheel/Pinch event listener for ultra-responsive zooming and scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!canWriteRef.current) return;
      
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const wheelValue = e.deltaY;
      
      // Support pinch-to-zoom (trackpad) perfectly and standard wheel scrolling smoothly
      const isPinch = e.ctrlKey;
      const zoomIntensity = isPinch ? 0.04 : 0.08;
      const zoomFactor = wheelValue < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
      
      const currentZoom = zoomRef.current;
      const currentPanX = panXRef.current;
      const currentPanY = panYRef.current;

      const newZoom = Math.min(3, Math.max(0.15, currentZoom * zoomFactor));
      
      // Calculate coordinates relative to canvas before zooming
      const canvasMouseX = (mouseX - currentPanX) / currentZoom;
      const canvasMouseY = (mouseY - currentPanY) / currentZoom;
      
      const newPanX = mouseX - canvasMouseX * newZoom;
      const newPanY = mouseY - canvasMouseY * newZoom;

      setPanX(newPanX);
      setPanY(newPanY);
      setZoom(newZoom);
    };

    container.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleNativeWheel);
    };
  }, []);

  // Native non-passive Touch event listeners for seamless single/multi-finger mobile support (pinch-to-zoom, pan, draw, drag, resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const touchStartData = {
      dist: 0,
      midX: 0,
      midY: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
    };

    const findElementAtCoords = (coords: { x: number; y: number }) => {
      const curElements = elementsRef.current;
      for (let i = curElements.length - 1; i >= 0; i--) {
        const el = curElements[i];
        if (el.type === "drawing") continue;
        const bounded = el as any;
        const w = bounded.width || 150;
        const h = bounded.height || 150;
        if (
          coords.x >= bounded.x &&
          coords.x <= bounded.x + w &&
          coords.y >= bounded.y &&
          coords.y <= bounded.y + h
        ) {
          return el;
        }
      }
      return null;
    };

    const isNearResizeHandle = (el: BoardElement, coords: { x: number; y: number }) => {
      const bounded = el as any;
      const w = bounded.width || 150;
      const h = bounded.height || 150;
      const handleSize = 32 / zoomRef.current;
      return (
        coords.x >= bounded.x + w - handleSize &&
        coords.x <= bounded.x + w + 12 &&
        coords.y >= bounded.y + h - handleSize &&
        coords.y <= bounded.y + h + 12
      );
    };

    const handleNativeTouchStart = (e: TouchEvent) => {
      if (!canWriteRef.current) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.touches.length === 2) {
        // Pinch-to-zoom multi-touch trigger
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        touchStartData.dist = dist;
        touchStartData.midX = midX;
        touchStartData.midY = midY;
        touchStartData.zoom = zoomRef.current;
        touchStartData.panX = panXRef.current;
        touchStartData.panY = panYRef.current;

        setIsPanning(false);
        setIsDragging(false);
        setIsResizing(false);
        isDrawingRef.current = false;
        return;
      }
    };

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (!canWriteRef.current) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      // 1. Two-finger pinch-to-zoom
      if (e.touches.length === 2 && touchStartData.dist > 0) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;

        const factor = dist / touchStartData.dist;
        const newZoom = Math.min(3, Math.max(0.15, touchStartData.zoom * factor));

        const canvasMidX = (touchStartData.midX - touchStartData.panX) / touchStartData.zoom;
        const canvasMidY = (touchStartData.midY - touchStartData.panY) / touchStartData.zoom;

        const newPanX = midX - canvasMidX * newZoom;
        const newPanY = midY - canvasMidY * newZoom;

        setZoom(newZoom);
        setPanX(newPanX);
        setPanY(newPanY);
        return;
      }
    };

    const handleNativeTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 || e.touches.length === 1) {
        touchStartData.dist = 0;
      }
    };

    container.addEventListener("touchstart", handleNativeTouchStart, { passive: false });
    container.addEventListener("touchmove", handleNativeTouchMove, { passive: false });
    container.addEventListener("touchend", handleNativeTouchEnd, { passive: false });

    return () => {
      container.removeEventListener("touchstart", handleNativeTouchStart);
      container.removeEventListener("touchmove", handleNativeTouchMove);
      container.removeEventListener("touchend", handleNativeTouchEnd);
    };
  }, []);

  // Flushes pending changes to cloud
  const flushPendingChanges = React.useCallback(async () => {
    if (isSandboxEnvironment()) {
      hasUnsavedChanges.current = false;
      setSyncStatus('synced');
      return;
    }

    setSyncStatus('saving-cloud');
    try {
      await flushBoardCheckpoint(boardId, 'manual-flush');
      hasUnsavedChanges.current = false;
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Flush pending changes to cloud failed:", err);
      hasUnsavedChanges.current = true;
      setSyncStatus('offline');
      showSyncToast("Sync failed: " + (err?.message || 'Error'), "error", 10000);
    }
  }, [boardId, showSyncToast]);

  // Centralized write-minimizer dispatcher handling local-first updates + debounced/immediate syncing
  const saveElementLocallyAndSync = React.useCallback(async (
    elementId: string,
    elementData: any,
    isMerge: boolean = false,
    actionType: 'set' | 'delete' = 'set'
  ) => {
    if (!isHydratedRef.current && !isSandboxEnvironment()) {
      console.warn("Ignoring save element, board not hydrated yet.");
      return;
    }

    const currentElements = elementsRef.current;
    let updatedElements: BoardElement[] = [];

    // Check if we are updating or deleting a drawing element
    const isDrawing = (elementData && elementData.type === 'drawing') || 
                      (actionType === 'delete' && currentElements.find(el => el.id === elementId)?.type === 'drawing');

    let processedData = elementData ? sanitizeForSupabase(elementData) : elementData;
    if (isDrawing && elementData && elementData.type === 'drawing') {
      processedData = {
        ...processedData,
        points: simplifyPoints(processedData.points, 1.5) // Downscale point coordinate resolution to optimize Supabase sizes
      };
    }

    if (actionType === 'delete') {
      updatedElements = currentElements.filter(el => el.id !== elementId);
    } else {
      const exists = currentElements.some(el => el.id === elementId);
      if (exists) {
        updatedElements = currentElements.map(el => {
          if (el.id === elementId) {
            return isMerge ? { ...el, ...processedData } : { id: elementId, ...processedData };
          }
          return el;
        });
      } else {
        updatedElements = [...currentElements, { id: elementId, ...processedData } as BoardElement];
      }
    }

    // Snappy UI update
    setElements(updatedElements);
    elementsRef.current = updatedElements;

    // Keep recovery data in IndexedDB. Full board snapshots must never be stored
    // in localStorage because they can block Supabase OAuth PKCE state writes.
    try {
      if (isSandboxEnvironment()) {
        saveSandboxLocalElements(boardId, updatedElements);
      } else {
        scheduleBoardRecoveryCacheSave(boardId, updatedElements);
      }
    } catch (e) {
      // IndexedDB/Storage error safely handled
    }

    // Broadcast update instantly to connected WebSocket peers (saving Supabase reads)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "element_update",
        boardId,
        elementId,
        elementData: processedData,
        actionType,
        isMerge
      }));
    }

    if (isSandboxEnvironment()) {
      hasUnsavedChanges.current = false;
      setSyncStatus('synced');
      return;
    }

    const currentFullEl = updatedElements.find(el => el.id === elementId);
    queueElementMutation(
      boardId,
      elementId,
      actionType === 'delete' ? null : (currentFullEl || processedData),
      actionType
    );
    setSyncStatus('saved-local');
  }, [boardId, setElements, setSyncStatus]);

  const handleInsertBlankPdfPage = React.useCallback(() => {
    const lastPage = pdfPages[pdfPages.length - 1];
    const newY = lastPage ? lastPage.y + lastPage.height + 40 : 0;
    const newX = lastPage ? lastPage.x : 0;
    const width = lastPage ? lastPage.width : 600;
    const height = lastPage ? lastPage.height : 800;

    const blankSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="50%" y="50%" font-family="sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">Blank PDF Page</text></svg>`;
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(blankSvg)}`;

    const id = `pdf-page-${pdfPages.length}-${Date.now()}`;

    if (boardId && !isSandboxEnvironment()) {
      import('../services/storageService').then(({ saveBoardAsset }) => {
        saveBoardAsset(boardId, undefined, dataUrl, "image/svg+xml")
          .then((saved) => {
            const newPage: ImageElement = {
              id,
              type: "image",
              x: newX,
              y: newY,
              width,
              height,
              assetId: saved.assetId,
              mimeType: saved.mimeType,
              zIndex: 1,
              locked: true,
              updatedAt: Date.now(),
            };
            saveElementLocallyAndSync(id, newPage);
            showSyncToast("Blank page added to document", "success");
          })
          .catch((err) => {
            console.error("Error creating blank PDF page asset:", err);
            showSyncToast("Failed to add blank page", "error");
          });
      });
    } else {
      const newPage: ImageElement = {
        id,
        type: "image",
        x: newX,
        y: newY,
        width,
        height,
        src: dataUrl,
        zIndex: 1,
        locked: true,
        updatedAt: Date.now(),
      };
      saveElementLocallyAndSync(id, newPage);
      showSyncToast("Blank page added to document", "success");
    }
  }, [pdfPages, saveElementLocallyAndSync, showSyncToast]);

  const handleSaveVoiceNote = React.useCallback(async (audioDataUrl: string, durationSec: number) => {
    if (!checkCreationRateLimit(4, 3000)) return;
    const coords = pendingVoiceCoords || { x: -panX + 200, y: -panY + 200 };
    const id = "audio-" + Date.now() + Math.floor(Math.random() * 100);

    let assetId: string | undefined;
    let mimeType = "audio/webm";

    if (!isSandboxEnvironment()) {
      try {
        const { saveBoardAsset } = await import("../services/storageService");
        const meta = await saveBoardAsset(boardId, undefined, audioDataUrl, "audio/webm");
        assetId = meta.assetId;
        mimeType = meta.mimeType;
      } catch (err) {
        console.error("Failed to save audio asset:", err);
        showSyncToast("Failed to save audio asset to cloud", "error");
        return;
      }
    }

    const newAudio: BoardElement = {
      id,
      type: "audio",
      x: coords.x - 20,
      y: coords.y - 20,
      ...(assetId ? { assetId, mimeType } : { audioUrl: audioDataUrl }),
      duration: durationSec,
      authorName: currentUser.name,
      zIndex: elements.length + 1,
      updatedAt: Date.now(),
    } as any;

    saveElementLocallyAndSync(id, newAudio);
    pushToUndo({ type: "add", elementId: id, afterData: newAudio });
    setActiveTool("select");
    setSelectedId(id);
    setIsDragging(false);
    showSyncToast("Voice comment attached!", "success");
  }, [pendingVoiceCoords, panX, panY, currentUser.name, elements.length, saveElementLocallyAndSync, pushToUndo, showSyncToast, setIsDragging, checkCreationRateLimit, boardId]);

  const handleSaveStamp = React.useCallback(async (stampType: any, label?: string, signatureUrl?: string, color?: string, stampShape?: any) => {
    if (!checkCreationRateLimit(6, 3000)) return;
    const coords = pendingStampCoords || { x: -panX + 200, y: -panY + 200 };
    const id = "stamp-" + Date.now() + Math.floor(Math.random() * 100);
    
    const isSquareShape = stampShape && stampShape !== "rounded-rect";
    const width = isSquareShape ? 100 : 140;
    const height = isSquareShape ? 100 : 60;

    let signatureAssetId: string | undefined;

    if (signatureUrl && !isSandboxEnvironment()) {
      try {
        const { saveBoardAsset } = await import("../services/storageService");
        const meta = await saveBoardAsset(boardId, undefined, signatureUrl, "image/png");
        signatureAssetId = meta.assetId;
      } catch (err) {
        console.error("Failed to save signature asset:", err);
        showSyncToast("Failed to save signature asset to cloud", "error");
        return;
      }
    }

    const newStamp: BoardElement = {
      id,
      type: "stamp",
      x: coords.x - (width / 2),
      y: coords.y - (height / 2),
      width,
      height,
      stampType,
      ...(label ? { label } : {}),
      ...(signatureAssetId
        ? { signatureAssetId }
        : signatureUrl
        ? { signatureDataUrl: signatureUrl }
        : {}),
      ...(color ? { color } : {}),
      ...(stampShape ? { stampShape } : {}),
      zIndex: elements.length + 1,
      updatedAt: Date.now(),
    } as any;

    saveElementLocallyAndSync(id, newStamp);
    pushToUndo({ type: "add", elementId: id, afterData: newStamp });
    setActiveTool("select");
    setSelectedId(id);
    setIsDragging(false);
    showSyncToast("Stamp placed!", "success");
  }, [pendingStampCoords, panX, panY, elements.length, saveElementLocallyAndSync, pushToUndo, showSyncToast, setIsDragging, checkCreationRateLimit, boardId]);


  // Handle instant online/offline syncing and online recovery
  useEffect(() => {
    const handleOnline = () => {
      console.log("Device back online. Synchronizing offline progress...");
      showSyncToast("Back Online! Synchronizing offline progress...", "info");
      if (hasUnsavedChanges.current) {
        flushPendingChanges();
      }
    };

    const handleOffline = () => {
      console.log("Device went offline.");
      setSyncStatus('offline');
      showSyncToast("You are offline. Progress is saved locally in buffer.", "warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [flushPendingChanges, showSyncToast]);

  // Clean selection when changing tools
  useEffect(() => {
    setSelectedId(null);
    setSelectedIds([]);
  }, [activeTool]);

  // Auto-switch away from laser or creation tools if write permission is revoked
  useEffect(() => {
    if (!canWrite && activeTool !== "select" && activeTool !== "pan") {
      setActiveTool("select");
      localLaserPointsRef.current = [];
    }
  }, [canWrite, activeTool]);

  // Stream cursor movements over WebSockets without database writes.
  const lastCursorUpdate = useRef<number>(0);
  const lastSyncedCursorPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const updateCursorPosition = (clientX: number, clientY: number) => {
    const now = Date.now();

    // High performance WebSocket throttle: 50ms. If offline fallback, use 30 seconds to strictly prevent quota exhaustion.
    const isWsActive = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    const throttleLimit = isWsActive ? 50 : 30000;
    if (now - lastCursorUpdate.current < throttleLimit) return;

    if (!containerRef.current) return;
    const rect = containerRectRef.current || containerRef.current.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Convert mouse position to whiteboard panned coordinates so cursors align globally
    const canvasX = (mouseX - panX) / zoom;
    const canvasY = (mouseY - panY) / zoom;

    lastCursorUpdate.current = now;
    lastSyncedCursorPos.current = { x: canvasX, y: canvasY };

    // High performance: Use WebSocket if connected to send live cursor!
    if (isWsActive) {
      wsRef.current!.send(JSON.stringify({
        type: "cursor",
        boardId,
        userId: currentUser.id,
        name: currentUser.name,
        color: currentUser.color,
        role: currentUser.role,
        x: canvasX,
        y: canvasY,
        panX,
        panY,
        zoom,
        lastActive: now
      }));
    }
  };


  const containerRectRef = useRef<DOMRect | null>(null);

  // Convert screen coordinates into absolute canvas coordinates
  const screenToCanvasCoords = (clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    
    // Use cached rect if available during an interaction, otherwise fetch it
    const rect = containerRectRef.current || containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - panX) / zoom;
    const y = (clientY - rect.top - panY) / zoom;
    return { x, y };
  };

  // Listen for custom Resize events from child elements
  useEffect(() => {
    const handleResizeStart = (e: Event) => {
      if (!canWriteRef.current) return;
      const customEvent = e as CustomEvent;
      const { elementId, originalEvent } = customEvent.detail;
      const targetElement = elements.find((el) => el.id === elementId);
      if (!targetElement || targetElement.type === "drawing" || targetElement.type === "connector" || (targetElement as any).locked) return;

      setSelectedId(elementId);
      setIsResizing(true);
      setDragStart({ x: originalEvent.clientX, y: originalEvent.clientY });
      const bounded = targetElement as any;
      setElementStartSize({ w: bounded.width, h: bounded.height });
      setElementStartPos({ x: bounded.x, y: bounded.y });
    };

    window.addEventListener("init-resize", handleResizeStart);
    return () => window.removeEventListener("init-resize", handleResizeStart);
  }, [elements]);

  // Synchronize state and handlers to refs for stable window event listener callbacks
  const clipboardElementsRef = useRef(clipboardElements);
  useEffect(() => {
    clipboardElementsRef.current = clipboardElements;
  }, [clipboardElements]);

  const handlePasteRef = useRef<(() => Promise<void>) | null>(null);

  // Handle Paste events for Images!
  useEffect(() => {
    const handleNativePaste = async (e: ClipboardEvent) => {
      if (
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "INPUT"
      ) {
        return; // ignore if user is typing in a sticky note or text input
      }

      const items = e.clipboardData?.items;
      const files = e.clipboardData?.files;
      
      let imageFiles: File[] = [];

      // Extract image files copied directly from disk/file explorer
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file && file.type && file.type.startsWith("image/")) {
            imageFiles.push(file);
          }
        }
      }

      // Fallback or additional item check (copied screenshots, browser copy, etc.)
      if (imageFiles.length === 0 && items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item && item.type && item.type.indexOf("image") !== -1) {
            const file = item.getAsFile();
            if (file) {
              imageFiles.push(file);
            }
          }
        }
      }

      // If we found image files, paste them
      if (imageFiles.length > 0) {
        if (!canWriteRef.current) {
          e.preventDefault();
          triggerReadOnlyAlert();
          return;
        }

        if (!checkCreationRateLimit(3, 3000)) {
          e.preventDefault();
          return;
        }

        e.preventDefault(); // stop default browser paste behavior

        let filesToPaste = imageFiles;
        if (!isTeacherRef.current && filesToPaste.length > 5) {
          filesToPaste = filesToPaste.slice(0, 5);
          showSyncToast("Pasted 5 images max at once.", "warning", 3000);
        }

        for (const file of filesToPaste) {
          const result = await compressImage(file);
          if (!result) continue;

          const { base64Str, width: originalWidth, height: originalHeight } = result;

          // Place the image centered in the user's current view
          let x = 100;
          let y = 100;
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            // Map the screen center coordinates to current canvas scale & pan
            x = (centerX - panXRef.current) / zoomRef.current;
            y = (centerY - panYRef.current) / zoomRef.current;
          }

          const id = "img-" + Date.now() + Math.floor(Math.random() * 100);

          let w = originalWidth;
          let h = originalHeight;
          const maxDim = 320; // nice starting size on the board
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          let assetId: string | undefined;
          let mimeType = "image/png";

          if (!isSandboxEnvironment()) {
            try {
              const { saveBoardAsset } = await import("../services/storageService");
              const meta = await saveBoardAsset(boardId, undefined, base64Str, "image/png");
              assetId = meta.assetId;
              mimeType = meta.mimeType;
            } catch (storageErr) {
              console.error("Failed to save pasted image asset:", storageErr);
              showSyncToast("Failed to save image asset to cloud", "error");
              return;
            }
          }

          const newImageElement: ImageElement = {
            id,
            type: "image",
            x: Math.round(x - w / 2),
            y: Math.round(y - h / 2),
            width: w,
            height: h,
            ...(assetId ? { assetId, mimeType } : { src: base64Str }),
            zIndex: elementsRef.current.length + 1,
            updatedAt: Date.now(),
          };

          // Save using centralized queue manager instead of raw setDoc stray documents!
          saveElementLocallyAndSync(id, newImageElement)
            .then(() => {
              pushToUndo({
                type: "add",
                elementId: id,
                afterData: newImageElement,
              });
              // Select the newly pasted image for convenience
              setSelectedId(id);
              setSelectedIds([id]);
            })
            .catch((err) => console.error("Error saving pasted image:", err));
        }
        return;
      }

      // If we DID NOT find images, check if we have copied whiteboard elements in local clipboard
      if (clipboardElementsRef.current.length > 0) {
        if (!canWriteRef.current) {
          e.preventDefault();
          triggerReadOnlyAlert();
          return;
        }
        e.preventDefault();
        if (handlePasteRef.current) {
          handlePasteRef.current();
        }
      }
    };

    window.addEventListener("paste", handleNativePaste);
    return () => window.removeEventListener("paste", handleNativePaste);
  }, [boardId, saveElementLocallyAndSync, pushToUndo]);

  // Handle Board Canvas Mouse Events
  const handleMouseDown = (e: React.PointerEvent) => {
    // Only primary clicks trigger actions
    if (e.button !== 0) return;

    if (followedUserId) {
      setFollowedUserId(null);
    }

    if (!canWrite) {
      triggerReadOnlyAlert();
      return;
    }

    const coords = screenToCanvasCoords(e.clientX, e.clientY);

    // Laser pointer click trigger
    if (activeTool === "laser") {
      const now = Date.now();
      const color = activeColor || "#ef4444";
      const newPt = { x: coords.x, y: coords.y, timestamp: now, color };
      localLaserPointsRef.current = [...localLaserPointsRef.current.filter((p) => now - p.timestamp < 1500), newPt];
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "laser_point",
            boardId,
            userId: currentUser.id,
            x: coords.x,
            y: coords.y,
            color,
            timestamp: now,
          })
        );
      }
      return;
    }

    // 1. Hand tool / Pan Canvas mode
    if (containerRef.current) {
      containerRectRef.current = containerRef.current.getBoundingClientRect();
    }
    
    if (
      (activeTool === "pan" || e.shiftKey) &&
      activeTool !== "pencil" &&
      activeTool !== "highlighter"
    ) {
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // 2. Pencil / Highlighter drawing tool
    if (activeTool === "pencil" || activeTool === "highlighter") {
      isDrawingRef.current = true;
      drawingPointsRef.current = [coords];
      if (localDrawingPathRef.current) localDrawingPathRef.current.setAttribute("d", getSvgPathFromPoints([coords]));
      return;
    }

    // 4. Click to spawn Stickies, Shapes, and Text instantly
    if (activeTool === "sticky") {
      if (!checkCreationRateLimit(6, 3000)) return;
      const id = "sticky-" + Date.now() + Math.floor(Math.random() * 100);
      const newSticky: StickyElement = {
        id,
        type: "sticky",
        x: coords.x - 75, // center horizontally on tap
        y: coords.y - 75,
        width: 150,
        height: 150,
        text: "",
        color: activeColor,
        zIndex: elements.length + 1,
        reactions: {},
      };
      saveElementLocallyAndSync(id, newSticky);
      pushToUndo({ type: "add", elementId: id, afterData: newSticky });
      setActiveTool("select");
      setSelectedId(id);
      return;
    }

    if (
      activeTool === "cartesian" ||
      activeTool === "numberline" ||
      activeTool === "advanced-cartesian"
    ) {
      if (!checkCreationRateLimit(6, 3000)) return;
      const id = "shape-" + Date.now() + Math.floor(Math.random() * 100);

      let width = 300;
      let height = 300;
      if (activeTool === "numberline") {
        width = 420;
        height = 80;
      } else if (activeTool === "advanced-cartesian") {
        width = 400;
        height = 400;
      }

      const newShape: ShapeElement = {
        id,
        type: "shape",
        shapeType: activeTool,
        x: coords.x - width / 2,
        y: coords.y - height / 2,
        width,
        height,
        text: "",
        color: "#ffffff",
        borderColor: activeColor, // Axis/line color starts with activeColor
        zIndex: elements.length + 1,
        reactions: {},
        // Advanced cartesian properties
        ...(activeTool === "advanced-cartesian"
          ? {
              equation: "",
              equations: [],
              plottedPoints: "",
              cartesianRange: 5,
            }
          : {}),
      };
      saveElementLocallyAndSync(id, newShape);
      pushToUndo({ type: "add", elementId: id, afterData: newShape });
      setActiveTool("select");
      setSelectedId(id);
      return;
    }

    if (activeTool === "shape") {
      if (!checkCreationRateLimit(6, 3000)) return;
      const id = "shape-" + Date.now() + Math.floor(Math.random() * 100);

      const width = 150;
      const height = 150;

      const newShape: ShapeElement = {
        id,
        type: "shape",
        shapeType: activeShape,
        x: coords.x - width / 2,
        y: coords.y - height / 2,
        width,
        height,
        text: "",
        color: activeColor,
        borderColor: "#1e293b", // deep charcoal border
        zIndex: elements.length + 1,
        reactions: {},
      };
      saveElementLocallyAndSync(id, newShape);
      pushToUndo({ type: "add", elementId: id, afterData: newShape });
      setActiveTool("select");
      setSelectedId(id);
      return;
    }

    if (activeTool === "text") {
      if (!checkCreationRateLimit(6, 3000)) return;
      const id = "text-" + Date.now() + Math.floor(Math.random() * 100);
      const newText: TextElement = {
        id,
        type: "text",
        x: coords.x - 100,
        y: coords.y - 25,
        width: 200,
        height: 50,
        text: "",
        color: activeColor === "#4b5563" ? "#1e293b" : activeColor,
        fontSize: 18,
        fontFamily: "sans",
        fontWeight: "normal",
        textAlign: "left",
        backgroundColor: "transparent",
        borderStyle: "none",
        zIndex: elements.length + 1,
        reactions: {},
      };
      saveElementLocallyAndSync(id, newText);
      pushToUndo({ type: "add", elementId: id, afterData: newText });
      setActiveTool("select");
      setSelectedId(id);
      return;
    }

    if (activeTool === "table") {
      if (!checkCreationRateLimit(6, 3000)) return;
      const id = "table-" + Date.now() + Math.floor(Math.random() * 100);
      const r = tableRows;
      const c = tableCols;
      const initialData = Array.from({ length: r }, () => Array(c).fill(""));
      const calculatedWidth = Math.max(260, c * 110);
      const calculatedHeight = Math.max(120, r * 44);

      const newTable: TableElement = {
        id,
        type: "table",
        x: Math.round(coords.x - calculatedWidth / 2),
        y: Math.round(coords.y - calculatedHeight / 2),
        width: calculatedWidth,
        height: calculatedHeight,
        rows: r,
        cols: c,
        data: initialData,
        hasHeaderRow: true,
        headerBgColor: "#f1f5f9",
        cellBgColor: "#ffffff",
        borderColor: "#cbd5e1",
        textColor: "#0f172a",
        fontSize: 14,
        zIndex: elements.length + 1,
        reactions: {},
      };
      saveElementLocallyAndSync(id, newTable);
      pushToUndo({ type: "add", elementId: id, afterData: newTable });
      setActiveTool("select");
      setSelectedId(id);
      setSelectedIds([id]);
      return;
    }

    if (activeTool === "audio") {
      setPendingVoiceCoords(coords);
      setIsVoiceModalOpen(true);
      return;
    }

    if (activeTool === "stamp") {
      setPendingStampCoords(coords);
      setIsStampModalOpen(true);
      return;
    }

    if (activeTool === "math") {
      if (!checkCreationRateLimit(6, 3000)) return;
      const id = "math-" + Date.now() + Math.floor(Math.random() * 100);
      const newMathBox: MathElement = {
        id,
        type: "math",
        x: coords.x - 120,
        y: coords.y - 30,
        width: 240,
        height: 60,
        text: "f(x) = x^2 + 2x + 1",
        color: "#1e1b4b",
        fontSize: 20,
        backgroundColor: "#e0e7ff",
        borderStyle: "solid",
        borderColor: "#6366f1",
        zIndex: elements.length + 1,
        reactions: {},
      };
      saveElementLocallyAndSync(id, newMathBox);
      pushToUndo({ type: "add", elementId: id, afterData: newMathBox });
      setActiveTool("select");
      setSelectedId(id);
      return;
    }

    // 5. Default selection click
    if (activeTool === "select") {
      // Clear selection if clicking on the empty background
      if (e.target === e.currentTarget) {
        setSelectedId(null);
        setSelectedIds([]);
        setDragSelectStart(coords);
        setDragSelectEnd(coords);
      }
    }
  };

  const handleMouseMove = (e: React.PointerEvent) => {
    updateCursorPosition(e.clientX, e.clientY);

    // Laser pointer movement tracking
    if (activeToolRef.current === "laser") {
      if (!canWriteRef.current) return;
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      const now = Date.now();
      const color = activeColorRef.current || "#ef4444";
      const newPt = { x: coords.x, y: coords.y, timestamp: now, color };
      localLaserPointsRef.current = [...localLaserPointsRef.current.filter((p) => now - p.timestamp < 1500), newPt];

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && now - lastStreamBroadcast.current > 20) {
        lastStreamBroadcast.current = now;
        wsRef.current.send(
          JSON.stringify({
            type: "laser_point",
            boardId,
            userId: currentUser.id,
            x: coords.x,
            y: coords.y,
            color,
            timestamp: now,
          })
        );
      }
    }

    // Update connector drawing state
    if (tempConnector) {
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      setTempConnector({
        ...tempConnector,
        currentPoint: coords,
      });
      return;
    }

    // 1. Panning canvas background
    if (isPanning) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setPanX((prev) => prev + dx);
      setPanY((prev) => prev + dy);
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // 1.5. Drag-select rectangle active
    if (dragSelectStart) {
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      setDragSelectEnd(coords);

      const minX = Math.min(dragSelectStart.x, coords.x);
      const maxX = Math.max(dragSelectStart.x, coords.x);
      const minY = Math.min(dragSelectStart.y, coords.y);
      const maxY = Math.max(dragSelectStart.y, coords.y);

      // Select elements inside bounds
      const newlySelected = elements
        .filter((el) => {
          if (el.type === "drawing") {
            // Select drawing if any of its points lie inside selection box
            return el.points.some(
              (pt) =>
                pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY,
            );
          } else {
            // Normal bounding box elements (sticky notes, shapes, texts, images)
            const bounded = el as any;
            const elWidth = bounded.width || 150;
            const elHeight = bounded.height || 150;
            return (
              bounded.x < maxX &&
              bounded.x + elWidth > minX &&
              bounded.y < maxY &&
              bounded.y + elHeight > minY
            );
          }
        })
        .map((el) => el.id);

      setSelectedIds(newlySelected);
      setSelectedId(newlySelected[0] || null);
      return;
    }

    // 2. Drawing freehand locally
    if (
      isDrawingRef.current &&
      (activeTool === "pencil" || activeTool === "highlighter")
    ) {
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      
      // Optimization: Only add point if it moved at least 2 canvas pixels away from the last point
      // This prevents jitter and reduces data size significantly
      const lastPoint = drawingPointsRef.current[drawingPointsRef.current.length - 1];
      if (lastPoint && !e.shiftKey) {
        const dist = Math.sqrt(Math.pow(coords.x - lastPoint.x, 2) + Math.pow(coords.y - lastPoint.y, 2));
        if (dist < 2) return;
      }

      let updated: Point[];

      if (e.shiftKey) {
        // Draw direct straight line from the first point to current freehand coords
        const start = drawingPointsRef.current[0] || coords;
        updated = [start, coords];
      } else {
        updated = [...drawingPointsRef.current, coords];
      }

      drawingPointsRef.current = updated;
      if (localDrawingPathRef.current) localDrawingPathRef.current.setAttribute("d", getSvgPathFromPoints(updated));

      // Broadcast active drawing path coordinates to other users over WebSocket for real-time collaboration
      const now = Date.now();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && now - lastStreamBroadcast.current > 40) {
        lastStreamBroadcast.current = now;
        wsRef.current.send(JSON.stringify({
          type: "drawing_stream",
          boardId,
          userId: currentUser.id,
          userName: currentUser.name,
          color: activeTool === "highlighter" ? `${activeColor}80` : activeColor,
          width: activeTool === "highlighter" ? strokeWidth * 2.5 : strokeWidth,
          points: updated,
          isHighlighter: activeTool === "highlighter"
        }));
      }
      return;
    }


    // 4. Moving selected elements
    if (isDragging && selectedIds.length > 0) {
      const dx = (e.clientX - dragStart.x) / zoom;
      const dy = (e.clientY - dragStart.y) / zoom;

      // Determine the reference element (first element in selection that is not a drawing)
      const refId = selectedIds[0];
      const refEl = elementsRef.current.find((el) => el.id === refId);
      const refStartPos = elementStartPositions[refId];

      let snapOffsetX = dx;
      let snapOffsetY = dy;
      let lineX: number | undefined = undefined;
      let lineY: number | undefined = undefined;

      if (refEl && refEl.type !== "drawing" && refStartPos) {
        // Unsnapped coordinate of reference element
        const targetX = refStartPos.x + dx;
        const targetY = refStartPos.y + dy;
        const refW = (refEl as any).width || 150;
        const refH = (refEl as any).height || 150;

        let finalX = targetX;
        let finalY = targetY;

        let xSnapped = false;
        let ySnapped = false;

        // 1. Smart Alignment Snapping with other elements
        const threshold = 8; // snap threshold in canvas pixels

        // Find other elements (not in current selection) to align with
        const otherEls = elementsRef.current.filter(
          (el) =>
            !selectedIds.includes(el.id) &&
            el.type !== "drawing" &&
            el.type !== "connector",
        );

        for (const other of otherEls) {
          const o = other as any;
          const oW = o.width || 150;
          const oH = o.height || 150;

          // X alignments (Left edge, Center, Right edge)
          const targetLeft = targetX;
          const targetCenter = targetX + refW / 2;
          const targetRight = targetX + refW;

          const oLeft = o.x;
          const oCenter = o.x + oW / 2;
          const oRight = o.x + oW;

          if (!xSnapped) {
            if (Math.abs(targetLeft - oLeft) < threshold) {
              finalX = oLeft;
              xSnapped = true;
              lineX = oLeft;
            } else if (Math.abs(targetCenter - oCenter) < threshold) {
              finalX = oCenter - refW / 2;
              xSnapped = true;
              lineX = oCenter;
            } else if (Math.abs(targetRight - oRight) < threshold) {
              finalX = oRight - refW;
              xSnapped = true;
              lineX = oRight;
            } else if (Math.abs(targetLeft - oRight) < threshold) {
              finalX = oRight;
              xSnapped = true;
              lineX = oRight;
            } else if (Math.abs(targetRight - oLeft) < threshold) {
              finalX = oLeft - refW;
              xSnapped = true;
              lineX = oLeft;
            }
          }

          // Y alignments (Top edge, Middle, Bottom edge)
          const targetTop = targetY;
          const targetMiddle = targetY + refH / 2;
          const targetBottom = targetY + refH;

          const oTop = o.y;
          const oMiddle = o.y + oH / 2;
          const oBottom = o.y + oH;

          if (!ySnapped) {
            if (Math.abs(targetTop - oTop) < threshold) {
              finalY = oTop;
              ySnapped = true;
              lineY = oTop;
            } else if (Math.abs(targetMiddle - oMiddle) < threshold) {
              finalY = oMiddle - refH / 2;
              ySnapped = true;
              lineY = oMiddle;
            } else if (Math.abs(targetBottom - oBottom) < threshold) {
              finalY = oBottom - refH;
              ySnapped = true;
              lineY = oBottom;
            } else if (Math.abs(targetTop - oBottom) < threshold) {
              finalY = oBottom;
              ySnapped = true;
              lineY = oBottom;
            } else if (Math.abs(targetBottom - oTop) < threshold) {
              finalY = oTop - refH;
              ySnapped = true;
              lineY = oTop;
            }
          }

          if (xSnapped && ySnapped) break;
        }

        // 2. Grid Snapping fallback (if not aligned to other elements and grid is active)
        if (gridMode !== "none") {
          if (!xSnapped) {
            const snappedX = Math.round(targetX / 20) * 20;
            if (Math.abs(snappedX - targetX) < 10) {
              finalX = snappedX;
              xSnapped = true;
            }
          }
          if (!ySnapped) {
            const snappedY = Math.round(targetY / 20) * 20;
            if (Math.abs(snappedY - targetY) < 10) {
              finalY = snappedY;
              ySnapped = true;
            }
          }
        }

        snapOffsetX = finalX - refStartPos.x;
        snapOffsetY = finalY - refStartPos.y;
      }

      if (lineX !== undefined || lineY !== undefined) {
        setSnapLines({ x: lineX, y: lineY });
      } else {
        setSnapLines(null);
      }

      // Update locally first for instantaneous rendering smoothness
      setElements((prev) =>
        prev.map((el) => {
          if (selectedIds.includes(el.id)) {
            const startPos = elementStartPositions[el.id];
            if (startPos) {
              if (el.type !== "drawing") {
                return {
                  ...el,
                  x: startPos.x + snapOffsetX,
                  y: startPos.y + snapOffsetY,
                };
              } else {
                return {
                  ...el,
                  points: startPos.points.map((p: any) => ({
                    x: p.x + snapOffsetX,
                    y: p.y + snapOffsetY,
                  })),
                };
              }
            }
          }
          return el;
        }),
      );
      return;
    }

    // 5. Resizing an element
    if (isResizing && selectedId) {
      const dx = (e.clientX - dragStart.x) / zoom;
      const dy = (e.clientY - dragStart.y) / zoom;

      setElements((prev) =>
        prev.map((el) => {
          if (el.id === selectedId && el.type !== "drawing") {
            if (el.type === "image") {
              const startW = elementStartSize.w;
              const startH = elementStartSize.h;
              const ratio = startW > 0 ? startH / startW : 1;
              const newW = Math.max(40, startW + dx);
              const newH = Math.max(40, newW * ratio);
              return {
                ...el,
                width: newW,
                height: newH,
              };
            }
            return {
              ...el,
              width: Math.max(60, elementStartSize.w + dx),
              height: Math.max(60, elementStartSize.h + dy),
            };
          }
          return el;
        }),
      );
      return;
    }
  };

  const handleMouseUp = async (e: React.PointerEvent) => {
    containerRectRef.current = null;
    setSnapLines(null);

    // Handle Connector tool release gesture
    if (tempConnector) {
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      const targetEl = elementsRef.current.find((el) => {
        if (el.id === tempConnector.fromId || el.type === "drawing" || el.type === "connector") return false;
        const bounded = el as any;
        const w = bounded.width || 150;
        const h = bounded.height || 150;
        return (
          coords.x >= bounded.x &&
          coords.x <= bounded.x + w &&
          coords.y >= bounded.y &&
          coords.y <= bounded.y + h
        );
      });

      const id = "connector-" + Date.now() + Math.floor(Math.random() * 100);
      let newConnector: ConnectorElement;

      if (targetEl) {
        // Find closest target socket
        let toSocket: "top" | "right" | "bottom" | "left" = "top";
        const bounded = targetEl as any;
        const w = bounded.width || 150;
        const h = bounded.height || 150;
        const relX = (coords.x - bounded.x) / w;
        const relY = (coords.y - bounded.y) / h;
        
        const distToLeft = relX;
        const distToRight = 1 - relX;
        const distToTop = relY;
        const distToBottom = 1 - relY;
        
        const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
        if (minDist === distToTop) toSocket = "top";
        else if (minDist === distToRight) toSocket = "right";
        else if (minDist === distToBottom) toSocket = "bottom";
        else toSocket = "left";

        newConnector = {
          id,
          type: "connector",
          fromId: tempConnector.fromId,
          toId: targetEl.id,
          fromSocket: tempConnector.fromSocket,
          toSocket,
          color: activeColor,
          zIndex: elements.length + 1,
        };
      } else {
        // Connect to the free-floating coordinate point
        newConnector = {
          id,
          type: "connector",
          fromId: tempConnector.fromId,
          fromSocket: tempConnector.fromSocket,
          endPoint: coords,
          color: activeColor,
          zIndex: elements.length + 1,
        };
      }

      try {
        await saveElementLocallyAndSync(id, newConnector);
        pushToUndo({ type: "add", elementId: id, afterData: newConnector });
        setActiveTool("select");
        setSelectedId(id);
      } catch (err) {
        console.error("Error saving connector:", err);
      }

      setTempConnector(null);
      return;
    }

    // 0. Finish drag selection box
    if (dragSelectStart) {
      setDragSelectStart(null);
      setDragSelectEnd(null);
      setIsDragging(false);
      setIsResizing(false);
      return;
    }

    // 1. Finish background panning
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    // 2. Finish local drawing and save stroke as a single document to Supabase
    if (activeTool === "pencil" || activeTool === "highlighter") {
      isDrawingRef.current = false;

      // Notify remote peers that the active stream has finished and is now being committed
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "drawing_stream_end",
          boardId,
          userId: currentUser.id
        }));
      }

      const points = drawingPointsRef.current;

      if (points.length >= 1) {
        // Calculate total path distance to filter out accidental microscopic clicks/jitter
        let totalLength = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i - 1].x;
          const dy = points[i].y - points[i - 1].y;
          totalLength += Math.sqrt(dx * dx + dy * dy);
        }

        // Discard unintentional micro scribbles (< 2px path length)
        if (points.length > 1 && totalLength < 2) {
          drawingPointsRef.current = [];
          if (localDrawingPathRef.current) localDrawingPathRef.current.setAttribute("d", "");
          return;
        }

        // Anti-spam stroke rate limit for students (max 12 strokes in 3 seconds)
        if (!isTeacherRef.current && !checkCreationRateLimit(12, 3000)) {
          drawingPointsRef.current = [];
          if (localDrawingPathRef.current) localDrawingPathRef.current.setAttribute("d", "");
          return;
        }

        // For a single point, duplicate it with a tiny offset so it renders as a beautiful round dot on canvas
        const finalPoints = points.length === 1
          ? [points[0], { x: points[0].x + 0.1, y: points[0].y + 0.1 }]
          : points;

        const id = "draw-" + Date.now() + Math.floor(Math.random() * 100);
        const isHighlighter = activeTool === "highlighter";
        const newStroke: DrawingElement = {
          id,
          type: "drawing",
          points: finalPoints,
          color: isHighlighter ? `${activeColor}80` : activeColor, // add alpha opacity for highlighter
          width: isHighlighter ? strokeWidth * 2.5 : strokeWidth,
          isHighlighter,
          zIndex: elements.length + 1,
        };

        try {
          await saveElementLocallyAndSync(id, newStroke);
          pushToUndo({ type: "add", elementId: id, afterData: newStroke });
        } catch (err) {
          console.error("Error saving sketch:", err);
        }
      }
      drawingPointsRef.current = [];
      if (localDrawingPathRef.current) localDrawingPathRef.current.setAttribute("d", "");
      return;
    }

    // 4. Update elements coordinates in Supabase on move end
    if (isDragging) {
      setIsDragging(false);
      
      if (selectedIds.length > 0) {
        const movedElements = elements.filter(
          (el) => selectedIds.includes(el.id),
        );

        await Promise.all(
          movedElements.map(async (el) => {
          const startPos = elementStartPositions[el.id];
          if (startPos) {
            if (el.type !== "drawing") {
              const boundedEl = el as any;
              const hasMoved =
                boundedEl.x !== startPos.x || boundedEl.y !== startPos.y;
              if (hasMoved) {
                pushToUndo({
                  type: "update",
                  elementId: el.id,
                  beforeData: {
                    x: startPos.x,
                    y: startPos.y,
                  },
                  afterData: {
                    x: boundedEl.x,
                    y: boundedEl.y,
                  },
                });
                try {
                  await saveElementLocallyAndSync(el.id, {
                    x: boundedEl.x,
                    y: boundedEl.y,
                  }, true);
                } catch (err) {
                  console.error("Error updating moved element coordinates:", err);
                }
              }
            } else {
              const drawingEl = el as any;
              const hasMoved =
                drawingEl.points.length > 0 &&
                drawingEl.points[0].x !== startPos.points[0].x;
              if (hasMoved) {
                pushToUndo({
                  type: "update",
                  elementId: el.id,
                  beforeData: {
                    points: startPos.points,
                  },
                  afterData: {
                    points: drawingEl.points,
                  },
                });
                try {
                  await saveElementLocallyAndSync(el.id, {
                    points: drawingEl.points,
                  }, true);
                } catch (err) {
                  console.error("Error updating moved drawing coordinates:", err);
                }
              }
            }
          }
        }),
      );
      }
      return;
    }

    // 5. Update size in Supabase on resize end
    if (isResizing) {
      setIsResizing(false);
      
      if (selectedId) {
        const el = elements.find((e) => e.id === selectedId);
        if (el && el.type !== "drawing" && el.type !== "connector") {
          const bounded = el as any;
          const hasResized =
            bounded.width !== elementStartSize.w || bounded.height !== elementStartSize.h;
          if (hasResized) {
            pushToUndo({
              type: "update",
              elementId: selectedId,
              beforeData: {
                width: elementStartSize.w,
                height: elementStartSize.h,
              },
              afterData: {
                width: bounded.width,
                height: bounded.height,
              },
            });
          }
          try {
            await saveElementLocallyAndSync(selectedId, {
              width: bounded.width,
              height: bounded.height,
            }, true);
          } catch (err) {
            console.error("Error updating resized element:", err);
          }
        }
      }
      return;
    }
  };

  // Delete an element
  const handleDeleteElement = React.useCallback((id: string) => {
    if (id.startsWith("pdf-page-")) {
      return; // PDF pages are not deletable!
    }
    const target = elementsRef.current.find((el) => el.id === id);
    if (target) {
      pushToUndo({ type: "delete", elementId: id, beforeData: target });
    }

    // Also delete any connectors attached to this element
    const attachedConnectors = elementsRef.current.filter(
      (el) => el.type === "connector" && ((el as any).fromId === id || (el as any).toId === id)
    );
    attachedConnectors.forEach((conn) => {
      pushToUndo({ type: "delete", elementId: conn.id, beforeData: conn });
      saveElementLocallyAndSync(conn.id, null, false, "delete").catch((err) =>
        console.error("Error deleting attached connector:", err)
      );
    });

    saveElementLocallyAndSync(id, null, false, 'delete')
      .then(() => {
        setSelectedId(prev => prev === id ? null : prev);
        setSelectedIds(prev => prev.filter(x => x !== id));
      })
      .catch((err) => console.error("Error deleting element:", err));
  }, [pushToUndo, saveElementLocallyAndSync, setSelectedId, setSelectedIds]);

  // Undo the last action from the local stack
  const handleUndo = async () => {
    if (undoStack.length === 0) return;

    const action = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setRedoStack((prev) => [...prev, action]);

    try {
      if (action.type === "add") {
        await saveElementLocallyAndSync(action.elementId, null, false, 'delete');
        if (selectedId === action.elementId) {
          setSelectedId(null);
        }
      } else if (action.type === "delete") {
        if (action.beforeData) {
          await saveElementLocallyAndSync(action.elementId, action.beforeData);
        }
      } else if (action.type === "update") {
        if (action.beforeData) {
          await saveElementLocallyAndSync(action.elementId, action.beforeData, true);
        }
      }
    } catch (err) {
      console.error("Error executing undo:", err);
    }
  };

  // Redo the last undone action
  const handleRedo = async () => {
    if (redoStack.length === 0) return;

    const action = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, prev.length - 1));
    setUndoStack((prev) => [...prev, action]);

    try {
      if (action.type === "add") {
        if (action.afterData) {
          await saveElementLocallyAndSync(action.elementId, action.afterData);
        }
      } else if (action.type === "delete") {
        await saveElementLocallyAndSync(action.elementId, null, false, 'delete');
        if (selectedId === action.elementId) {
          setSelectedId(null);
        }
      } else if (action.type === "update") {
        if (action.afterData) {
          await saveElementLocallyAndSync(action.elementId, action.afterData, true);
        }
      }
    } catch (err) {
      console.error("Error executing redo:", err);
    }
  };

  // Paste elements from clipboard with a slight offset
  const handlePaste = async () => {
    if (!canWrite || clipboardElements.length === 0) return;
    if (!checkCreationRateLimit(4, 2000)) return;

    let itemsToPaste = clipboardElements;
    if (!isTeacherRef.current && itemsToPaste.length > 10) {
      itemsToPaste = itemsToPaste.slice(0, 10);
      showSyncToast("Pasting capped at 10 items max per batch to prevent lag.", "warning", 4000);
    }
    
    const offset = 40;
    const maxZ = elements.length > 0 ? Math.max(...elements.map(e => e.zIndex || 0)) : 0;
    const newPasteIds: string[] = [];
    const pastedElements: BoardElement[] = [];

    const isSolo = activeUsersCount <= 1;

    if (isSolo) {
      const currentList = [...elementsRef.current];
      const updatedList = [...currentList];

      for (let i = 0; i < itemsToPaste.length; i++) {
        const el = itemsToPaste[i];
        const newId = `copy-${Math.random().toString(36).substring(2, 11)}`;
        
        const newEl = JSON.parse(JSON.stringify(el)) as BoardElement;
        newEl.id = newId;
        newEl.zIndex = maxZ + i + 1;
        newEl.updatedAt = Date.now();

        if ('x' in newEl && 'y' in newEl) {
          newEl.x += (offset / zoom);
          newEl.y += (offset / zoom);
        }
        
        if (newEl.type === 'drawing' && 'points' in newEl) {
          newEl.points = newEl.points.map((p: any) => ({ x: p.x + (offset / zoom), y: p.y + (offset / zoom) }));
        }

        updatedList.push(newEl);
        newPasteIds.push(newId);
        pastedElements.push(newEl);

        pendingSyncElements.current[newId] = { data: newEl, action: 'set' };
        pushToUndo({ type: "add", elementId: newId, afterData: newEl });
      }

      setElements(updatedList);
      scheduleBoardRecoveryCacheSave(boardId, updatedList);

      hasUnsavedChanges.current = true;
      setSyncStatus('saved-local');
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        flushPendingChanges();
      }, 3000);

      setSelectedIds(newPasteIds);
      setSelectedId(null);
      setClipboardElements(pastedElements);
    } else {
      setSyncStatus('saving-cloud');
      
      const currentList = [...elementsRef.current];
      const updatedList = [...currentList];

      for (let i = 0; i < itemsToPaste.length; i++) {
        const el = itemsToPaste[i];
        const newId = `copy-${Math.random().toString(36).substring(2, 11)}`;
        
        const newEl = JSON.parse(JSON.stringify(el)) as BoardElement;
        newEl.id = newId;
        newEl.zIndex = maxZ + i + 1;
        newEl.updatedAt = Date.now();
        if ('x' in newEl && 'y' in newEl) {
          newEl.x += (offset / zoom);
          newEl.y += (offset / zoom);
        }
        
        if (newEl.type === 'drawing' && 'points' in newEl) {
          newEl.points = newEl.points.map((p: any) => ({ x: p.x + (offset / zoom), y: p.y + (offset / zoom) }));
        }

        updatedList.push(newEl);
        newPasteIds.push(newId);
        pastedElements.push(newEl);
        pushToUndo({ type: "add", elementId: newId, afterData: newEl });

        queueElementMutation(boardId, newId, newEl, 'set');
      }

      setElements(updatedList);
      elementsRef.current = updatedList;

      try {
        if (!isSandboxEnvironment()) {
          await flushBoardCheckpoint(boardId, 'pasteElements');
        }
        setSyncStatus('synced');
        setSelectedIds(newPasteIds);
        setSelectedId(null);
        setClipboardElements(pastedElements);
      } catch (err: any) {
        console.error("Error pasting elements:", err);
        setSyncStatus('offline');
        showSyncToast("Paste failed: " + (err?.message || 'Error'), "error", 10000);
      }
    }
  };

  useEffect(() => {
    handlePasteRef.current = handlePaste;
  }, [handlePaste]);

  // Keyboard shortcut listeners (standard whiteboards experience!)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "INPUT"
      ) {
        return; // ignore when typing
      }

      const key = e.key.toLowerCase();
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        setFollowedUserId(null);
        setSelectedId(null);
        setSelectedIds([]);
        setIsShortcutsOpen(false);
        setIsClearModalOpen(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (!canWrite) {
          triggerReadOnlyAlert();
          return;
        }
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "y") {
        e.preventDefault();
        if (!canWrite) {
          triggerReadOnlyAlert();
          return;
        }
        handleRedo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === "c") {
        const toCopy = elements.filter(el => selectedIds.includes(el.id) || el.id === (selectedId || ''));
        if (toCopy.length > 0) {
          setClipboardElements(JSON.parse(JSON.stringify(toCopy)));
        }
        return;
      }

      if (key === "v" && !(e.ctrlKey || e.metaKey)) setActiveTool("select");
      else if (key === "h" && !(e.ctrlKey || e.metaKey)) setActiveTool("pan");
      else if (["p", "i", "k", "n", "s", "t", "m", "l", "e", "g", "u", "o"].includes(key) && !(e.ctrlKey || e.metaKey)) {
        if (!canWrite) {
          triggerReadOnlyAlert();
          return;
        }
        if (key === "p") setActiveTool("pencil");
        else if (key === "i") setActiveTool("highlighter");
        else if (key === "k") setActiveTool("laser");
        else if (key === "n") setActiveTool("sticky");
        else if (key === "s") setActiveTool("shape");
        else if (key === "g") setActiveTool("cartesian");
        else if (key === "t") setActiveTool("text");
        else if (key === "m") setActiveTool("math");
        else if (key === "l") setActiveTool("connector");
        else if (key === "e") setActiveTool("eraser");
        else if (key === "u") setActiveTool("audio");
        else if (key === "o") setActiveTool("stamp");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!canWrite) {
          triggerReadOnlyAlert();
          return;
        }
        const idsToDelete = selectedId ? [selectedId, ...selectedIds] : selectedIds;
        const uniqueIds = Array.from(new Set(idsToDelete));
        
        if (uniqueIds.length > 0) {
          uniqueIds.forEach((id) => handleDeleteElement(id));
          setSelectedIds([]);
          setSelectedId(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, selectedIds, elements, clipboardElements, canWrite, zoom, boardId, handleUndo, handleRedo]);

  // Click handler to select an element
  const handleSelectElement = React.useCallback((id: string, e: React.MouseEvent) => {
    if (!canWrite) {
      triggerReadOnlyAlert();
      return;
    }
    // Eraser tool clicks delete elements immediately
    if (activeTool === "eraser") {
      e.stopPropagation();
      if (!canWrite) {
        triggerReadOnlyAlert();
        return;
      }
      handleDeleteElement(id);
      return;
    }

    if (activeTool !== "select") {
      // Let events bubble up so drawing or other canvas tools function correctly on top of elements!
      return;
    }

    e.stopPropagation();

    const target = elementsRef.current.find((el) => el.id === id);
    if (!target) return;

    setSelectedIds((prevSelectedIds) => {
      let updatedSelectedIds = [...prevSelectedIds];
      if (e.shiftKey) {
        if (prevSelectedIds.includes(id)) {
          updatedSelectedIds = prevSelectedIds.filter((selected) => selected !== id);
        } else {
          updatedSelectedIds.push(id);
        }
      } else {
        if (!prevSelectedIds.includes(id)) {
          updatedSelectedIds = [id];
        }
      }

      if (canWrite) {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });

        // Store starting position for every element in selection
        const positions: Record<string, any> = {};
        elementsRef.current.forEach((el) => {
          if (updatedSelectedIds.includes(el.id)) {
            if ((el as any).locked) return;
            if (el.type !== "drawing") {
              const boundedEl = el as any;
              positions[el.id] = { x: boundedEl.x, y: boundedEl.y };
            } else {
              positions[el.id] = { points: [...el.points] };
            }
          }
        });
        setElementStartPositions(positions);
      }
      return updatedSelectedIds;
    });
    setSelectedId(id);
  }, [activeTool, canWrite, handleDeleteElement, setSelectedIds, setSelectedId, setIsDragging, setDragStart, setElementStartPositions]);

  // Update specific values of an element
  const handleUpdateElement = React.useCallback((id: string, updates: Partial<BoardElement>) => {
    if (!canWrite) return;
    const el = elementsRef.current.find((e) => e.id === id);
    if (el) {
      // Create a 'beforeData' object containing only the keys that are being updated
      const beforeData: any = {};
      Object.keys(updates).forEach((key) => {
        beforeData[key] =
          (el as any)[key] !== undefined ? (el as any)[key] : null;
      });
      pushToUndo({
        type: "update",
        elementId: id,
        beforeData,
        afterData: updates,
      });
    }

    saveElementLocallyAndSync(id, updates, true).catch((err) =>
      console.error("Error updating element:", err)
    );
  }, [pushToUndo, saveElementLocallyAndSync, canWrite]);

  // Color change handler that also updates selected element colors
  const handleColorChange = async (color: string) => {
    setActiveColor(color);
    const activeSelection =
      selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    if (activeSelection.length > 0) {
      if (!canWrite) {
        triggerReadOnlyAlert();
        return;
      }
      await Promise.all(
        activeSelection.map(async (id) => {
          try {
            const el = elements.find((e) => e.id === id);
            if (
              el &&
              el.type === "shape" &&
              (el.shapeType === "cartesian" ||
                el.shapeType === "advanced-cartesian" ||
                el.shapeType === "numberline" ||
                el.shapeType === "line")
            ) {
              await saveElementLocallyAndSync(id, { borderColor: color }, true);
            } else {
              await saveElementLocallyAndSync(id, { color }, true);
            }
          } catch (err) {
            console.error("Error updating selected element color:", err);
          }
        }),
      );
    }
  };

  // Stamp shape change handler that updates selected stamp element shapes
  const handleStampShapeChange = React.useCallback(async (stampShape: string) => {
    const activeSelection =
      selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
    if (activeSelection.length > 0) {
      if (!canWrite) {
        triggerReadOnlyAlert();
        return;
      }
      await Promise.all(
        activeSelection.map(async (id) => {
          try {
            const el = elements.find((e) => e.id === id);
            if (el && el.type === "stamp") {
              await saveElementLocallyAndSync(id, { stampShape: stampShape as any }, true);
            }
          } catch (err) {
            console.error("Error updating selected stamp shape:", err);
          }
        }),
      );
    }
  }, [selectedIds, selectedId, canWrite, triggerReadOnlyAlert, elements, saveElementLocallyAndSync]);

  // Clear all items on the board
  const handleClearBoard = async () => {
    const elementsToKeep = elements.filter(el => typeof el?.id === "string" && el.id.startsWith("pdf-page-"));
    const elementsToDelete = elements.filter(el => typeof el?.id === "string" && !el.id.startsWith("pdf-page-"));

    setElements(elementsToKeep);
    elementsRef.current = elementsToKeep;

    try {
      if (isSandboxEnvironment()) {
        saveSandboxLocalElements(boardId, elementsToKeep);
      } else {
        scheduleBoardRecoveryCacheSave(boardId, elementsToKeep);
      }
    } catch (e) {
      console.error(e);
    }
    setSelectedId(null);
    setSelectedIds([]);
    setUndoStack([]);
    setRedoStack([]);

    elementsToDelete.forEach((el) => {
      queueElementMutation(boardId, el.id, null, 'delete');
    });

    if (isSandboxEnvironment()) {
      hasUnsavedChanges.current = false;
      setSyncStatus('synced');
    } else {
      setSyncStatus('saving-cloud');
      try {
        await flushBoardCheckpoint(boardId, 'clearBoard');
        setSyncStatus('synced');
      } catch (err) {
        console.error("Error clearing whiteboard:", err);
        setSyncStatus('offline');
      }
    }
  };

  // Toggle student writing permission on the board (Teacher/CanManage Only)
  const handleToggleStudentsCanWrite = async () => {
    if (!canManage) return;
    try {
      await setDoc(
        doc(db, "whiteboards", boardId),
        {
          studentsCanWrite: !studentsCanWrite,
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Error toggling student writing permissions:", err);
    }
  };



  // Zoom handlers
  const handleZoomIn = () => {
    const container = containerRef.current;
    const currentZoom = zoomRef.current;
    const nextZoom = Math.min(3, currentZoom + 0.15);
    if (nextZoom === currentZoom) return;

    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const currentPanX = panXRef.current;
      const currentPanY = panYRef.current;

      const canvasCenterX = (centerX - currentPanX) / currentZoom;
      const canvasCenterY = (centerY - currentPanY) / currentZoom;

      const newPanX = centerX - canvasCenterX * nextZoom;
      const newPanY = centerY - canvasCenterY * nextZoom;

      setPanX(newPanX);
      setPanY(newPanY);
    }
    setZoom(nextZoom);
  };

  const handleZoomOut = () => {
    const container = containerRef.current;
    const currentZoom = zoomRef.current;
    const nextZoom = Math.max(0.15, currentZoom - 0.15);
    if (nextZoom === currentZoom) return;

    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const currentPanX = panXRef.current;
      const currentPanY = panYRef.current;

      const canvasCenterX = (centerX - currentPanX) / currentZoom;
      const canvasCenterY = (centerY - currentPanY) / currentZoom;

      const newPanX = centerX - canvasCenterX * nextZoom;
      const newPanY = centerY - canvasCenterY * nextZoom;

      setPanX(newPanX);
      setPanY(newPanY);
    }
    setZoom(nextZoom);
  };

  const handleZoomReset = () => {
    const container = containerRef.current;
    const currentZoom = zoomRef.current;
    const nextZoom = 1;
    if (nextZoom === currentZoom) return;

    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const currentPanX = panXRef.current;
      const currentPanY = panYRef.current;

      const canvasCenterX = (centerX - currentPanX) / currentZoom;
      const canvasCenterY = (centerY - currentPanY) / currentZoom;

      const newPanX = centerX - canvasCenterX * nextZoom;
      const newPanY = centerY - canvasCenterY * nextZoom;

      setPanX(newPanX);
      setPanY(newPanY);
    }
    setZoom(nextZoom);
  };

  // Create a secure one-time sharing token. A raw ?board= URL does not grant
  // access under the hardened Supabase policies and must never be copied as an
  // invitation.
  const copyBoardLink = async () => {
    if (!canManage) {
      showSyncToast("Only the board owner or an administrator can create sharing links.", "warning");
      return;
    }

    try {
      const shareRole = studentsCanWrite ? "editor" : "viewer";
      const { data, error } = await supabase.rpc("create_board_share_link", {
        p_board_id: boardId,
        p_role: shareRole,
        p_expires_at: null,
      });

      if (error) throw new Error(error.message);

      const payload = data as any;
      const rawToken = String(payload?.rawToken || payload?.raw_token || "");
      if (!rawToken) throw new Error("Supabase did not return a sharing token.");

      const link = `${window.location.origin}/?share=${encodeURIComponent(rawToken)}`;
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
      showSyncToast(
        `${shareRole === "editor" ? "Editable" : "View-only"} secure link copied.`,
        "success"
      );
    } catch (error) {
      console.error("Unable to create secure share link:", error);
      showSyncToast(
        `Could not create the share link: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    }
  };

  return (
    <div
      className="flex-1 h-screen relative flex flex-col bg-[#F3F4F6] overflow-hidden"
      id="whiteboard-workspace"
    >
      {!isHydrated && !isSandboxEnvironment() && (
        <div className="fixed inset-0 bg-slate-50/80 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="flex flex-col items-center space-y-3">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-xs text-slate-500 font-medium">Hydrating whiteboard canvas...</p>
          </div>
        </div>
      )}

      {/* Floating Island Header Controls */}
      <WhiteboardHeader
        isZenMode={isZenMode}
        isTopBarHidden={isTopBarHidden}
        setIsTopBarHidden={setIsTopBarHidden}
        onBackToDashboard={onBackToDashboard}
        boardName={boardName}
        boardId={boardId}
        syncStatus={syncStatus}
        wsConnected={wsConnected}
        wsLatency={wsLatency}
        flushPendingChanges={flushPendingChanges}
        showSyncToast={showSyncToast}
        undoStack={undoStack}
        redoStack={redoStack}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        currentUser={currentUser}
        socketCollaboratorsRef={socketCollaboratorsRef}
        activeCollaboratorIds={activeCollaboratorIds}
        followedUserId={followedUserId}
        setFollowedUserId={handleSetFollowedUser}
        isPresenterMode={isPresenterMode}
        setIsPresenterMode={setIsPresenterMode}
        wsRef={wsRef}
        isTeacher={isTeacher}
        canManage={canManage}
        studentsCanWrite={studentsCanWrite}
        handleToggleStudentsCanWrite={handleToggleStudentsCanWrite}
        isPdfBoard={isPdfBoard}
        handleDownloadPdfWithDrawings={handleDownloadPdfWithDrawings}
        isGeneratingPdf={isGeneratingPdf}
        handleExportImage={handleExportImage}
        copyBoardLink={copyBoardLink}
        copiedLink={copiedLink}
        isHeaderMenuOpen={isHeaderMenuOpen}
        setIsHeaderMenuOpen={setIsHeaderMenuOpen}
      />

      {/* Subtle Floating Toggle Button to Show Header when Hidden */}
      {isTopBarHidden && !isZenMode && (
        <button
          onClick={() => setIsTopBarHidden(false)}
          className="absolute top-3 right-3 z-30 bg-white/95 backdrop-blur-md hover:bg-white text-slate-700 hover:text-blue-600 border border-slate-200/90 shadow-md hover:shadow-lg rounded-2xl px-3 py-2 flex items-center space-x-1.5 text-xs font-bold cursor-pointer transition-all hover:scale-105 active:scale-95"
          title="Show Header Controls"
        >
          <Eye className="w-4 h-4 text-blue-600" />
          <span className="hidden sm:inline">Header</span>
        </button>
      )}

      {isZenMode && (
        <button
          onClick={handleToggleZenMode}
          className="fixed top-4 right-4 z-50 bg-slate-900/95 hover:bg-slate-800 text-white rounded-full px-4 py-2 flex items-center space-x-2 text-xs font-bold shadow-lg border border-slate-700 hover:scale-105 active:scale-95 transition-all cursor-pointer"
          title="Exit Full Screen Mode (Escape)"
        >
          <Minimize2 className="w-4 h-4 text-slate-300" />
          <span>Exit Full Screen</span>
        </button>
      )}

      {/* Floating vertical sidebar toolbar */}
      {(() => {
        const selectedElements = elements.filter(el => selectedIds.includes(el.id) || el.id === selectedId);
        const hasColorableSelection = selectedElements.length > 0 && selectedElements.some(el => {
          if (el.type === "image") return false;
          if (el.type === "shape") {
            const st = el.shapeType;
            if (st === "cartesian" || st === "advanced-cartesian" || st === "numberline") return false;
          }
          return true;
        });
        const selectedStamp = selectedElements.find(el => el.type === "stamp") as StampElement | undefined;
        const hasStampSelection = Boolean(selectedStamp);
        const selectedStampShape = selectedStamp?.stampShape || "rounded-rect";

        return (
          <Toolbar
            activeTool={activeTool}
            onChangeTool={(tool) => {
              if (!canWrite && tool !== "select" && tool !== "pan") {
                triggerReadOnlyAlert();
                return;
              }
              setActiveTool(tool);
            }}
            activeColor={activeColor}
            onChangeColor={handleColorChange}
            activeShape={activeShape}
            onChangeShape={setActiveShape}
            tableRows={tableRows}
            tableCols={tableCols}
            onChangeTableDimensions={(r, c) => {
              setTableRows(r);
              setTableCols(c);
            }}
            onClearBoard={() => {
              if (!canWrite) {
                triggerReadOnlyAlert();
                return;
              }
              setShowClearConfirm(true);
            }}
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomReset={handleZoomReset}
            strokeWidth={strokeWidth}
            onChangeStrokeWidth={setStrokeWidth}
            gridMode={gridMode}
            onChangeGridMode={setGridMode}
            hasSelection={selectedIds.length > 0 || selectedId !== null}
            hasColorableSelection={hasColorableSelection}
            hasStampSelection={hasStampSelection}
            selectedStampShape={selectedStampShape}
            onChangeStampShape={handleStampShapeChange}
            isPdfMode={isPdfBoard}
            isZenMode={isZenMode}
            onToggleZenMode={handleToggleZenMode}
            isTopBarHidden={isTopBarHidden}
            onOpenShortcuts={() => setIsShortcutsOpen(true)}
            onOpenClearModal={() => setIsClearModalOpen(true)}
            onToggleTimer={() => {
              if (!canWrite) {
                triggerReadOnlyAlert();
                return;
              }
              const nextOpen = !isTimerOpen;
              setIsTimerOpen(nextOpen);
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                  JSON.stringify({
                    type: "timer_sync",
                    boardId,
                    state: syncedTimerState,
                    isOpen: nextOpen,
                  })
                );
              }
            }}
            isTimerOpen={isTimerOpen}
          />
        );
      })()}

      {/* Main Interactive Interactive Zoomable & Pannable Canvas Container */}
      <div
        ref={containerRef}
        onPointerDown={handleMouseDown}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
        onPointerLeave={handleMouseUp}
        onPointerCancel={handleMouseUp}
        className="w-full h-full relative outline-none select-none touch-none"
        style={{
          touchAction: "none",
          cursor:
            activeTool === "pan"
              ? isPanning
                ? "grabbing"
                : "grab"
              : activeTool === "pencil"
                ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%232563eb' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 20h9'/><path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'/></svg>") 0 24, crosshair`
                : activeTool === "highlighter"
                  ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23ca8a04' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m15 5 4 4'/><path d='M19 17V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2Z'/></svg>") 0 24, crosshair`
                  : activeTool === "eraser"
                    ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23dc2626' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21Z'/><path d='M22 21H7'/></svg>") 0 24, pointer`
                    : activeTool === "text"
                      ? "text"
                      : activeTool === "sticky"
                        ? "cell"
                        : activeTool === "shape" || activeTool === "cartesian"
                          ? "crosshair"
                          : "default",
          // Grid dot, math grid, or plain background pattern that scales and translates correctly
          backgroundImage:
            isPdfBoard || gridMode === "none"
              ? "none"
              : gridMode === "math"
                ? `linear-gradient(to right, rgba(203, 213, 225, 0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(203, 213, 225, 0.45) 1px, transparent 1px)`
                : `radial-gradient(circle, #cbd5e1 1.5px, transparent 1.5px)`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${panX}px ${panY}px`,
          backgroundColor: isPdfBoard ? "#e2e8f0" : gridMode === "none" ? "#ffffff" : "#f8fafc",
        }}
      >
        {/* Render Layer of Infinite Board Elements (Shapes, Drawings, Connectors, cursors) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {/* 1. Interactive DOM elements Layer (Sticky notes, Shapes, Textboxes) */}
          <div className="absolute inset-0 pointer-events-none z-10">
            {sortedElements.map((el) => {
              if (el.type === "drawing") return null;
              
              const isSelected = selectedIds.includes(el.id);
              const isInteractive =
                (activeTool === "select" || activeTool === "eraser") && canWrite;

              return (
                <ElementWrapper
                  key={el.id}
                  el={el}
                  isSelected={isSelected}
                  isInteractive={isInteractive}
                  currentUser={currentUser}
                  zoom={zoom}
                  isDragging={isDragging}
                  isResizing={isResizing}
                  selectedIdsLength={selectedIds.length}
                  activeTool={activeTool}
                  canWrite={canWrite}
                  boardId={boardId}
                  onSelectElement={handleSelectElement}
                  onUpdateElement={handleUpdateElement}
                  onDeleteElement={handleDeleteElement}
                />
              );
            })}
          </div>

          {/* 1.5. Connection Sockets Handles Overlay (shown when Connector Tool is active) */}
          {activeTool === "connector" && canWrite && (
            <div className="absolute inset-0 pointer-events-none z-30">
              {elements
                .filter(el => el.type !== "drawing" && el.type !== "connector")
                .map(el => {
                  const bounded = el as any;
                  const w = bounded.width || 150;
                  const h = bounded.height || 150;
                  
                  const sockets: ("top" | "right" | "bottom" | "left")[] = ["top", "right", "bottom", "left"];
                  
                  return (
                    <div
                      key={`sockets-${el.id}`}
                      className="absolute pointer-events-none"
                      style={{
                        left: bounded.x,
                        top: bounded.y,
                        width: w,
                        height: h,
                      }}
                    >
                      {sockets.map(s => {
                        let style: React.CSSProperties = {};
                        switch (s) {
                          case "top": style = { top: -7, left: "50%", transform: "translateX(-50%)" }; break;
                          case "right": style = { top: "50%", right: -7, transform: "translateY(-50%)" }; break;
                          case "bottom": style = { bottom: -7, left: "50%", transform: "translateX(-50%)" }; break;
                          case "left": style = { top: "50%", left: -7, transform: "translateY(-50%)" }; break;
                        }
                        
                        return (
                          <div
                            key={s}
                            className="absolute w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full shadow-md pointer-events-auto cursor-crosshair transition-all hover:scale-125 active:bg-blue-600"
                            style={style}
                            title={`Drag from ${s} connector`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              const coords = screenToCanvasCoords(e.clientX, e.clientY);
                              setTempConnector({
                                fromId: el.id,
                                fromSocket: s,
                                startPoint: getElementSocketCoords(el, s),
                                currentPoint: coords
                              });
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}

          {/* Render remote collaborator selection borders */}
          <RemoteSelectionsLayer
            elements={elements}
            remoteSelections={remoteSelections}
            currentUser={currentUser}
          />

          {/* Drag Selection Box Overlay */}
          {dragSelectStart && dragSelectEnd && (
            <div
              className="absolute border border-blue-500 bg-blue-500/10 rounded-sm pointer-events-none z-50"
              style={{
                left: Math.min(dragSelectStart.x, dragSelectEnd.x),
                top: Math.min(dragSelectStart.y, dragSelectEnd.y),
                width: Math.abs(dragSelectStart.x - dragSelectEnd.x),
                height: Math.abs(dragSelectStart.y - dragSelectEnd.y),
              }}
            />
          )}

          {/* 2. Global Svg Vector Overlay (Connector Lines, Drawings, Sketches) */}
          <svg
            width="100%"
            height="100%"
            className="absolute inset-0 overflow-visible pointer-events-none z-20"
          >
            {/* Render saved drawings */}
            {elements
              .filter((el) => el.type === "drawing")
              .map((el: any) => {
                const isSelected = selectedIds.includes(el.id);
                const isInteractive =
                  (activeTool === "select" || activeTool === "eraser") && canWrite;
                return (
                  <DrawingItem
                    key={el.id}
                    el={el}
                    isSelected={isSelected}
                    isInteractive={isInteractive}
                    activeTool={activeTool}
                    handleSelectElement={handleSelectElement}
                  />
                );
              })}
            {/* Render current local drawing imperatively */}
            <path
              ref={localDrawingPathRef}
              d=""
              fill="none"
              stroke={
                activeTool === "highlighter"
                  ? `${activeColor}80`
                  : activeColor
              }
              strokeWidth={
                activeTool === "highlighter" ? strokeWidth * 2.5 : strokeWidth
              }
              strokeLinecap="round"
              strokeLinejoin="round"
              className={
                activeTool === "highlighter"
                  ? "mix-blend-multiply"
                  : "drop-shadow-sm"
              }
            />
            {/* Render remote active drawing streams */}
            <RemoteDrawingStreamsLayer streamsRef={remoteDrawingStreamsRef} dirtyRef={remoteDrawingStreamsDirtyRef} />

            {/* Snap Alignment Guides */}
            {snapLines && snapLines.x !== undefined && (
              <line
                x1={snapLines.x}
                y1={-50000}
                x2={snapLines.x}
                y2={50000}
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
            )}
            {snapLines && snapLines.y !== undefined && (
              <line
                x1={-50000}
                y1={snapLines.y}
                x2={50000}
                y2={snapLines.y}
                stroke="#6366f1"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
            )}

            {/* Render Saved Connector Lines */}
            {elements
              .filter((el) => el.type === "connector")
              .map((el) => {
                const conn = el as ConnectorElement;
                const fromEl = elements.find((e) => e.id === conn.fromId);
                const toEl = conn.toId ? elements.find((e) => e.id === conn.toId) : null;
                
                if (!fromEl) return null;
                
                const start = getElementSocketCoords(fromEl, conn.fromSocket);
                const end = toEl ? getElementSocketCoords(toEl, conn.toSocket || "top") : (conn.endPoint || start);
                
                const pathD = getConnectorPath(start, end, conn.fromSocket, toEl ? conn.toSocket : undefined);
                const isSelected = selectedIds.includes(conn.id) || selectedId === conn.id;
                
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const angle = Math.atan2(dy, dx);
                
                const arrowLength = 12;
                const arrowAngle = Math.PI / 6;
                const arrowTip = end;
                const arrowLeftX = end.x - arrowLength * Math.cos(angle - arrowAngle);
                const arrowLeftY = end.y - arrowLength * Math.sin(angle - arrowAngle);
                const arrowRightX = end.x - arrowLength * Math.cos(angle + arrowAngle);
                const arrowRightY = end.y - arrowLength * Math.sin(angle + arrowAngle);
                
                const color = conn.color || "#4b5563";
                
                return (
                  <g key={conn.id} className="pointer-events-none">
                    {/* Invisible thicker selection target path */}
                    {activeTool === "select" && canWrite && (
                      <path
                        d={pathD}
                        stroke="transparent"
                        strokeWidth="16"
                        fill="none"
                        className="pointer-events-auto cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectElement(conn.id, e);
                        }}
                      />
                    )}
                    
                    {/* Selected highlight path */}
                    {isSelected && (
                      <path
                        d={pathD}
                        stroke="#3b82f6"
                        strokeWidth="5"
                        strokeLinecap="round"
                        fill="none"
                        opacity="0.3"
                      />
                    )}
                    
                    {/* Main visible path */}
                    <path
                      d={pathD}
                      stroke={color}
                      strokeWidth={isSelected ? "3.5" : "2.5"}
                      strokeLinecap="round"
                      fill="none"
                    />
                    
                    {/* Arrowhead polygon */}
                    <polygon
                      points={`${arrowTip.x},${arrowTip.y} ${arrowLeftX},${arrowLeftY} ${arrowRightX},${arrowRightY}`}
                      fill={color}
                    />
                  </g>
                );
              })}

            {/* Render temporary active connector line */}
            {tempConnector && (
              <g>
                <path
                  d={getConnectorPath(tempConnector.startPoint, tempConnector.currentPoint, tempConnector.fromSocket)}
                  stroke="#3b82f6"
                  strokeWidth="3"
                  strokeDasharray="4 4"
                  fill="none"
                />
                <circle
                  cx={tempConnector.currentPoint.x}
                  cy={tempConnector.currentPoint.y}
                  r="5"
                  fill="#3b82f6"
                />
              </g>
            )}
          </svg>

          {/* 3. Real-Time Collaborative Cursors Tracker Overlay */}
          <LiveCursors
            boardId={boardId}
            currentUser={currentUser}
            zoom={zoom}
            socketCollaboratorsRef={wsConnected ? socketCollaboratorsRef : undefined}
            followedUserId={followedUserId}
            onFollowUser={handleSetFollowedUser}
          />

        </div>

        {/* New High Performance Laser Pointer Canvas Layer outside of transformed container */}
        <canvas
          ref={laserCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 25 }}
        />
      </div>



      {/* Read-Only Mode Floating Notice Banner */}
      <ReadOnlyAlertBanner show={showReadOnlyAlert} />

      {/* Offline Sync Floating Toast Notice */}
      <SyncNotificationToast
        notification={syncNotification}
        onDismiss={() => setSyncNotification((prev) => ({ ...prev, visible: false }))}
      />

      {/* Floating Follow Indicator Banner */}
      <FollowIndicatorBanner
        followedUserId={followedUserId}
        collaborators={socketCollaboratorsRef.current}
        onStopFollow={() => setFollowedUserId(null)}
      />

      {/* Minimap Navigation Control */}
      {!isZenMode && (
        <div className="fixed bottom-16 sm:bottom-6 right-3 sm:right-6 z-30 flex flex-col items-end space-y-2">
          <Minimap
            elements={elements}
            panX={panX}
            panY={panY}
            zoom={zoom}
            containerWidth={containerDimensions.width}
            containerHeight={containerDimensions.height}
            onPanTo={(newPanX, newPanY) => {
              setPanX(newPanX);
              setPanY(newPanY);
            }}
          />
        </div>
      )}

      {/* Presenter Mode Live Indicator Border */}
      {isPresenterMode && (
        <div className="fixed inset-0 border-4 border-purple-500/80 pointer-events-none z-30 shadow-[inset_0_0_24px_rgba(168,85,247,0.35)] animate-pulse" />
      )}

      {/* Floating Workspace Sprint Timer & Stopwatch Widget */}
      <WorkspaceTimer
        isOpen={isTimerOpen}
        onClose={() => {
          if (!canWrite) return;
          setIsTimerOpen(false);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "timer_sync",
                boardId,
                state: syncedTimerState,
                isOpen: false,
              })
            );
          }
        }}
        onTimerSync={handleTimerSync}
        syncedState={syncedTimerState}
        isReadOnly={!canWrite}
      />

      {/* Helper Modals */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      <ClearCanvasModal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirm={handleClearBoard}
        elementCount={elements.length}
      />

      {/* Kami Page Navigation Bar for PDF boards */}
      {isPdfBoard && pdfPages.length > 0 && (
        <PdfPageNavigation
          pdfPages={pdfPages}
          currentPageIndex={activePdfPageIndex}
          onJumpToPage={handleJumpToPdfPage}
          onInsertBlankPage={handleInsertBlankPdfPage}
          onExportPdf={handleDownloadPdfWithDrawings}
          isExporting={isGeneratingPdf}
        />
      )}

      {/* Voice Note Recording Modal */}
      <VoiceRecordModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onSaveAudio={handleSaveVoiceNote}
      />

      {/* Stamp & Signature Picker Modal */}
      <StampPickerModal
        isOpen={isStampModalOpen}
        onClose={() => setIsStampModalOpen(false)}
        onSelectStamp={handleSaveStamp}
      />
    </div>
  );
}
