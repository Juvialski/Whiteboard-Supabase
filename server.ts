import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import { access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import http from "http";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_KEY = (
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ""
).trim();
const APP_ORIGINS = new Set(
  (process.env.APP_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function parsePositiveInt(val: string | undefined, fallback: number, min = 1, max = 500): number {
  const parsed = Number(val);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.trunc(parsed) : fallback;
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
const rooms = new Map<string, Set<WebSocket>>();
const activePresenters = new Map<string, { userId: string; name: string }>();

interface IpConnectionStats {
  unauthenticated: number;
  authenticated: number;
}
const ipConnectionStats = new Map<string, IpConnectionStats>();
let isShuttingDown = false;

const SHAPES = new Set([
  "any", "rounded-rect", "circle", "star", "badge", "diamond", "banner",
  "hexagon", "ribbon", "heart", "shield", "crest",
]);
const BOARD_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIEWER_EVENTS = new Set(["cursor", "laser_point", "element_focus", "emoji_reaction", "ping"]);
const WRITER_EVENTS = new Set([
  ...VIEWER_EVENTS,
  "drawing_stream", "drawing_stream_end", "element_update", "timer_sync",
  "request_follow", "stop_follow", "board_manifest_changed", "board_settings_changed",
  "member_permission_changed",
]);
const EPHEMERAL_EVENTS = new Set(["cursor", "laser_point", "drawing_stream", "element_focus", "emoji_reaction"]);

const MAX_ROOM_CLIENTS = parsePositiveInt(process.env.MAX_ROOM_CLIENTS, 40, 1, 200);
const MAX_CONNECTIONS_PER_IP = parsePositiveInt(process.env.MAX_CONNECTIONS_PER_IP, 30, 1, 200);
const MAX_PREAUTH_CONNECTIONS_PER_IP = parsePositiveInt(process.env.MAX_PREAUTH_CONNECTIONS_PER_IP, 10, 1, 50);
const MAX_USER_CONNECTIONS_PER_ROOM = parsePositiveInt(process.env.MAX_USER_CONNECTIONS_PER_ROOM, 4, 1, 16);
const BACKPRESSURE_LIMIT = 512 * 1024;

type SocketPermission = "viewer" | "editor" | "owner" | "admin";
interface SocketContext {
  authenticated: boolean;
  authenticating: boolean;
  userId: string | null;
  boardId: string | null;
  permission: SocketPermission | null;
  canWrite: boolean;
  canManage: boolean;
  accessToken: string | null;
  lastAuthorizationCheck: number;
  authorizationRefresh: Promise<boolean> | null;
  remoteKey: string;
  released: boolean;
  isAlive: boolean;
  authTimer: ReturnType<typeof setTimeout> | null;
  rateWindows: Map<string, { startedAt: number; count: number }>;
}
const socketContexts = new WeakMap<WebSocket, SocketContext>();

interface CachedTokenUser {
  user: any;
  expiresAt: number;
}
const verifiedTokenCache = new Map<string, CachedTokenUser>();
const authAttemptsByIp = new Map<string, { startedAt: number; count: number }>();

interface CachedBoardManifest {
  revision: number;
  changedShardIds: string[];
  deletedShardIds: string[];
  totalElements: number;
  updatedAt: number;
  cachedAt: number;
}
const boardManifestCache = new Map<string, CachedBoardManifest>();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload?.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
  } catch {
    // fallback
  }
  return null;
}

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const current = authAttemptsByIp.get(ip);
  const entry = !current || now - current.startedAt >= 10_000 ? { startedAt: now, count: 0 } : current;
  entry.count += 1;
  authAttemptsByIp.set(ip, entry);
  return entry.count <= 30;
}

async function verifyTokenCached(
  verifier: any,
  accessToken: string
): Promise<{ user: any; error: any }> {
  const tokenHash = hashToken(accessToken);
  const now = Date.now();
  const cached = verifiedTokenCache.get(tokenHash);
  if (cached && cached.expiresAt > now) {
    return { user: cached.user, error: null };
  }

  const { data: userData, error: userError } = await verifier.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    verifiedTokenCache.delete(tokenHash);
    return { user: null, error: userError };
  }

  const exp = parseJwtExp(accessToken);
  const maxTtlMs = 60_000;
  const expiresAt = exp ? Math.min(exp, now + maxTtlMs) : now + maxTtlMs;
  if (expiresAt > now) {
    verifiedTokenCache.set(tokenHash, { user: userData.user, expiresAt });
  }

  return { user: userData.user, error: null };
}

function safeErrorLabel(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(token|authorization|apikey|secret|password|cookie|session)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://*.supabase.co",
        "media-src 'self' data: blob: https://*.supabase.co",
        "connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com wss://*.supabase.co wss: ws:",
        "worker-src 'self' blob:",
      ].join("; "),
    );
  }
  next();
}
app.use(securityHeaders);

interface RateEntry { startedAt: number; count: number }
function rateLimit(options: { windowMs: number; max: number }) {
  const entries = new Map<string, RateEntry>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) if (now - entry.startedAt > options.windowMs * 2) entries.delete(key);
  }, Math.max(30_000, options.windowMs));
  cleanup.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const current = entries.get(key);
    const entry = !current || now - current.startedAt >= options.windowMs
      ? { startedAt: now, count: 0 }
      : current;
    entry.count += 1;
    entries.set(key, entry);
    if (entry.count > options.max) {
      res.setHeader("Retry-After", String(Math.ceil((options.windowMs - (now - entry.startedAt)) / 1000)));
      res.status(429).json({ success: false, error: "Too many requests" });
      return;
    }
    next();
  };
}
const generalApiLimiter = rateLimit({ windowMs: 60_000, max: 120 });
const aiLimiter = rateLimit({ windowMs: 60_000, max: 10 });

app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));
app.head("/healthz", (_req, res) => res.sendStatus(200));
app.use("/api", generalApiLimiter);

app.post("/api/ai/stamp", aiLimiter, express.json({ limit: "32kb", strict: true }), async (req, res) => {
  try {
    const rawPrompt = req.body?.prompt;
    const rawShape = req.body?.preferredShape;
    const rawCount = req.body?.count;
    const rawApiKey = req.body?.apiKey ?? req.headers["x-gemini-api-key"];
    const allowedKeys = new Set(["prompt", "preferredShape", "count", "apiKey"]);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some((key) => !allowedKeys.has(key))) {
      return res.status(400).json({ success: false, error: "Invalid request body" });
    }
    if (rawPrompt !== undefined && typeof rawPrompt !== "string") return res.status(400).json({ success: false, error: "Invalid prompt" });
    const prompt = (rawPrompt || "Educational praise and feedback stamps for students").trim();
    if (!prompt || prompt.length > 500) return res.status(400).json({ success: false, error: "Prompt must contain between 1 and 500 characters" });
    const preferredShape = typeof rawShape === "string" ? rawShape : "any";
    if (!SHAPES.has(preferredShape)) return res.status(400).json({ success: false, error: "Invalid preferred shape" });
    const parsedCount = Number(rawCount ?? 4);
    if (!Number.isFinite(parsedCount) || parsedCount < 1 || parsedCount > 6) return res.status(400).json({ success: false, error: "Stamp count must be between 1 and 6" });
    const numStamps = Math.trunc(parsedCount);
    if (typeof rawApiKey !== "string" || !rawApiKey.trim() || rawApiKey.length > 512) {
      return res.status(400).json({ success: false, error: "API key required", message: "AI Stamp Generation requires your Google AI Studio API key." });
    }

    const ai = new GoogleGenAI({ apiKey: rawApiKey.trim(), httpOptions: { headers: { "User-Agent": "whiteboard-free-tier" } } });
    const shapeConstraint = preferredShape !== "any"
      ? `Preferred shape for all stamps is "${preferredShape}".`
      : `Vary shapes across: "rounded-rect", "circle", "star", "badge", "diamond", "banner", "hexagon", "ribbon", "heart", "shield", "crest".`;
    const systemInstruction = `You are a creative educational and classroom feedback stamp generator.
Generate ${numStamps} unique stamp concepts. Return label, one emoji, pastel hex color, an allowed shape, and a short description. ${shapeConstraint}`;
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING }, emoji: { type: Type.STRING }, color: { type: Type.STRING },
              shape: { type: Type.STRING }, description: { type: Type.STRING },
            },
            required: ["label", "emoji", "color", "shape"],
          },
        },
      },
    });
    const stamps = JSON.parse(response.text || "[]");
    return res.json({ success: true, stamps });
  } catch (error: unknown) {
    console.error("AI Stamp Generation Error:", safeErrorLabel(error));
    return res.status(500).json({ success: false, error: "Failed to generate stamps", message: "The Gemini request failed. Check your API key and try again." });
  }
});
app.use("/api", (_req, res) => res.status(404).json({ success: false, error: "API route not found" }));
app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api/")) {
    next(error);
    return;
  }
  const status = error?.type === "entity.too.large" ? 413 : 400;
  res.status(status).json({
    success: false,
    error: status === 413 ? "Request body is too large" : "Malformed request body",
  });
});

function originAllowed(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return !IS_PRODUCTION;
  if (APP_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = request.headers.host;
    if (host && parsed.host === host) return true;
    return !IS_PRODUCTION && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function remoteKeyForRequest(request: http.IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;
  const forwardedParts = typeof raw === 'string'
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  return forwardedParts[forwardedParts.length - 1] || request.socket.remoteAddress || 'unknown';
}

function releaseSocket(ws: WebSocket): void {
  const context = socketContexts.get(ws);
  if (!context || context.released) return;
  context.released = true;
  const boardId = context.boardId;
  if (boardId) {
    const clients = rooms.get(boardId);
    clients?.delete(ws);

    const presenter = activePresenters.get(boardId);
    if (presenter && presenter.userId === context.userId) {
      const userStillPresent = Array.from(clients || []).some(
        (client) => socketContexts.get(client)?.userId === context.userId,
      );
      if (!userStillPresent) {
        activePresenters.delete(boardId);
        if (clients && clients.size > 0) {
          const stopPayload = JSON.stringify({
            type: "stop_follow",
            boardId,
            teacherId: context.userId,
          });
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) client.send(stopPayload);
          }
        }
      }
    }

    if (clients?.size === 0) {
      rooms.delete(boardId);
      activePresenters.delete(boardId);
    } else if (context.userId && clients) {
      const userStillPresent = Array.from(clients).some(
        (client) => socketContexts.get(client)?.userId === context.userId,
      );
      if (!userStillPresent) {
        const payload = JSON.stringify({
          type: "collaborator_left",
          boardId,
          userId: context.userId,
        });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
      }
    }
  }

  const stats = ipConnectionStats.get(context.remoteKey);
  if (stats) {
    if (context.authenticated) {
      stats.authenticated = Math.max(0, stats.authenticated - 1);
    } else {
      stats.unauthenticated = Math.max(0, stats.unauthenticated - 1);
    }
    if (stats.unauthenticated === 0 && stats.authenticated === 0) {
      ipConnectionStats.delete(context.remoteKey);
    }
  }
}

function closePolicy(ws: WebSocket, reason: string): void {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1008, reason.slice(0, 100));
}

function isFiniteNumber(value: unknown, min = -10_000_000, max = 10_000_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function cleanText(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : fallback;
}
function cleanColor(value: unknown): string {
  const color = cleanText(value, 32, "#3b82f6");
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#3b82f6";
}
function pointsValid(points: unknown, max = 1200): boolean {
  return Array.isArray(points) && points.length <= max && points.every((point) => point && typeof point === "object" && isFiniteNumber((point as any).x) && isFiniteNumber((point as any).y));
}
function payloadSize(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.MAX_SAFE_INTEGER; }
}
function containsForbiddenObjectKey(value: unknown, depth = 0): boolean {
  if (depth > 24) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenObjectKey(item, depth + 1));
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) return true;
    if (containsForbiddenObjectKey(item, depth + 1)) return true;
  }
  return false;
}
function relayElementDataValid(value: unknown, elementId: string, isMerge: boolean): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const allowedTypes = new Set(["sticky", "shape", "text", "drawing", "image", "connector", "audio", "stamp", "math", "table"]);

  if (data.id !== undefined && data.id !== elementId) return false;
  if (!isMerge) {
    if (typeof data.type !== "string" || !allowedTypes.has(data.type)) return false;
  } else if (data.type !== undefined && (typeof data.type !== "string" || !allowedTypes.has(data.type))) {
    return false;
  }

  for (const field of ["x", "y", "width", "height", "zIndex", "fontSize", "duration", "strokeWidth"]) {
    if (data[field] !== undefined && !isFiniteNumber(data[field])) return false;
  }
  for (const field of ["assetId", "signatureAssetId", "fromId", "toId"]) {
    if (data[field] !== undefined && (typeof data[field] !== "string" || (data[field] as string).length > 160)) return false;
  }
  if (typeof data.text === "string" && data.text.length > 100_000) return false;
  if (typeof data.label === "string" && data.label.length > 10_000) return false;

  if (data.points !== undefined && !pointsValid(data.points, 3_000)) return false;
  if (data.type === "drawing" && data.width !== undefined && !isFiniteNumber(data.width, 0.1, 200)) return false;

  if (data.rows !== undefined && (typeof data.rows !== "number" || !Number.isInteger(data.rows) || !isFiniteNumber(data.rows, 1, 200))) return false;
  if (data.cols !== undefined && (typeof data.cols !== "number" || !Number.isInteger(data.cols) || !isFiniteNumber(data.cols, 1, 200))) return false;
  if (data.data !== undefined) {
    if (!Array.isArray(data.data) || data.data.length > 200 ||
        !data.data.every((row) => Array.isArray(row) && row.length <= 200 && row.every((cell) => typeof cell === "string" && cell.length <= 100_000))) {
      return false;
    }
  }
  return true;
}

type SanitizedTimerState = {
  isRunning: boolean;
  mode: "timer" | "stopwatch";
  remainingSeconds: number;
  totalSeconds: number;
  startedAt: number | null;
};

function sanitizeTimerState(value: unknown): SanitizedTimerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (typeof state.isRunning !== "boolean") return null;
  if (state.mode !== "timer" && state.mode !== "stopwatch") return null;
  const maxSeconds = 7 * 24 * 60 * 60;
  if (!isFiniteNumber(state.remainingSeconds, 0, maxSeconds) || !isFiniteNumber(state.totalSeconds, 0, maxSeconds)) return null;
  const startedAt = state.startedAt === null || state.startedAt === undefined
    ? null
    : isFiniteNumber(state.startedAt, 0, Date.now() + 5 * 60_000)
      ? state.startedAt
      : undefined;
  if (startedAt === undefined) return null;
  return {
    isRunning: state.isRunning,
    mode: state.mode,
    remainingSeconds: state.remainingSeconds,
    totalSeconds: state.totalSeconds,
    startedAt,
  };
}

function consumeSocketRate(context: SocketContext, type: string): boolean {
  const limits: Record<string, number> = {
    cursor: 300, laser_point: 600, drawing_stream: 300, element_focus: 30,
    element_update: 120, drawing_stream_end: 60, board_manifest_changed: 12,
    timer_sync: 15, request_follow: 10, stop_follow: 10, board_settings_changed: 6,
    member_permission_changed: 20, emoji_reaction: 30, ping: 10,
  };
  const max = limits[type] ?? 30;
  const now = Date.now();
  const current = context.rateWindows.get(type);
  const entry = !current || now - current.startedAt >= 10_000 ? { startedAt: now, count: 0 } : current;
  entry.count += 1;
  context.rateWindows.set(type, entry);
  return entry.count <= max;
}

function sanitizeRelayMessage(message: any, context: SocketContext): Record<string, unknown> | null {
  const type = cleanText(message?.type, 40);
  if (!type || !consumeSocketRate(context, type)) return null;
  if (type === "ping") return { type, id: isFiniteNumber(message.id, 0, Number.MAX_SAFE_INTEGER) ? message.id : Date.now() };

  const allowed = context.canWrite ? WRITER_EVENTS : VIEWER_EVENTS;
  if (!allowed.has(type)) return null;
  if ((type === "board_settings_changed" || type === "member_permission_changed") && !context.canManage) return null;
  if ((type === "request_follow" || type === "stop_follow") && !context.canManage && context.permission !== "owner" && context.permission !== "admin") return null;
  const common = { type, boardId: context.boardId, userId: context.userId, lastActive: Date.now() };

  switch (type) {
    case "cursor": {
      const x = isFiniteNumber(message.x) ? message.x : 0;
      const y = isFiniteNumber(message.y) ? message.y : 0;
      const panX = isFiniteNumber(message.panX) ? message.panX : 0;
      const panY = isFiniteNumber(message.panY) ? message.panY : 0;
      const zoom = isFiniteNumber(message.zoom, 0.05, 20) ? message.zoom : 1;
      const viewCenterX = isFiniteNumber(message.viewCenterX) ? message.viewCenterX : undefined;
      const viewCenterY = isFiniteNumber(message.viewCenterY) ? message.viewCenterY : undefined;
      return {
        ...common,
        x,
        y,
        panX,
        panY,
        zoom,
        viewCenterX,
        viewCenterY,
        name: cleanText(message.name, 60, "Collaborator"),
        color: cleanColor(message.color),
        role: context.permission === "owner" || context.canManage ? "teacher" : "student",
      };
    }
    case "laser_point":
      if (!isFiniteNumber(message.x) || !isFiniteNumber(message.y)) return null;
      return { ...common, x: message.x, y: message.y, timestamp: Date.now(), color: cleanColor(message.color) };
    case "element_focus":
      if (!Array.isArray(message.selectedIds) || message.selectedIds.length > 100 || !message.selectedIds.every((id: unknown) => typeof id === "string" && id.length <= 128)) return null;
      return { ...common, userName: cleanText(message.userName, 60, "Collaborator"), color: cleanColor(message.color), selectedIds: message.selectedIds };
    case "emoji_reaction":
      if (typeof message.emoji !== "string" || message.emoji.length < 1 || message.emoji.length > 16) return null;
      return {
        ...common,
        id: cleanText(message.id, 64, `reaction-${Date.now()}`),
        emoji: cleanText(message.emoji, 16),
        userName: cleanText(message.userName, 60, "Collaborator"),
        color: cleanColor(message.color),
        timestamp: isFiniteNumber(message.timestamp, 0, Number.MAX_SAFE_INTEGER) ? message.timestamp : Date.now(),
      };
    case "drawing_stream":
      if (!pointsValid(message.points) || !isFiniteNumber(message.width, 0.1, 200)) return null;
      return { ...common, points: message.points, color: cleanColor(message.color), width: message.width, isHighlighter: message.isHighlighter === true };
    case "drawing_stream_end":
      return common;
    case "element_update": {
      if (typeof message.elementId !== "string" || message.elementId.length < 1 || message.elementId.length > 128) return null;
      if (!new Set(["set", "delete"]).has(message.actionType)) return null;
      if (message.actionType !== "delete" && (!message.elementData || typeof message.elementData !== "object" || Array.isArray(message.elementData))) return null;
      if (payloadSize(message.elementData) > 64 * 1024 || containsForbiddenObjectKey(message.elementData)) return null;
      if (message.actionType !== "delete" && !relayElementDataValid(message.elementData, message.elementId, message.isMerge === true)) return null;
      return { ...common, elementId: message.elementId, elementData: message.actionType === "delete" ? undefined : message.elementData, actionType: message.actionType, isMerge: message.isMerge === true };
    }
    case "timer_sync": {
      if (payloadSize(message.state) > 8 * 1024) return null;
      const state = message.state == null
        ? { isRunning: false, mode: "timer" as const, remainingSeconds: 300, totalSeconds: 300, startedAt: null }
        : sanitizeTimerState(message.state);
      if (!state) return null;
      return { ...common, state, isOpen: message.isOpen === true };
    }
    case "request_follow":
      return {
        ...common,
        teacherId: context.userId,
        teacherName: cleanText(message.teacherName, 60, "Teacher"),
        panX: isFiniteNumber(message.panX) ? message.panX : undefined,
        panY: isFiniteNumber(message.panY) ? message.panY : undefined,
        zoom: isFiniteNumber(message.zoom, 0.05, 20) ? message.zoom : undefined,
        viewCenterX: isFiniteNumber(message.viewCenterX) ? message.viewCenterX : undefined,
        viewCenterY: isFiniteNumber(message.viewCenterY) ? message.viewCenterY : undefined,
      };
    case "stop_follow":
      return { ...common, teacherId: context.userId };
    case "board_settings_changed":
      if (typeof message.studentsCanWrite !== "boolean") return null;
      return {
        ...common,
        studentsCanWrite: message.studentsCanWrite,
        updatedAt: isFiniteNumber(message.updatedAt, 0, Number.MAX_SAFE_INTEGER) ? message.updatedAt : Date.now(),
      };
    case "member_permission_changed": {
      const targetUserId = cleanText(message.targetUserId, 64);
      if (!USER_ID_PATTERN.test(targetUserId)) return null;
      return { ...common, targetUserId };
    }
    case "board_manifest_changed": {
      if (!isFiniteNumber(message.revision, 0, Number.MAX_SAFE_INTEGER)) return null;
      const normalizeShardIds = (value: unknown): string[] | null => {
        if (!Array.isArray(value) || value.length > 16) return null;
        const normalized = Array.from(new Set(
          value.filter((item): item is string => typeof item === "string" && /^shard_([0-9]|1[0-5])$/.test(item)),
        ));
        return normalized.length === value.length ? normalized : null;
      };
      const changedShardIds = normalizeShardIds(message.changedShardIds);
      const deletedShardIds = normalizeShardIds(message.deletedShardIds);
      if (!changedShardIds || !deletedShardIds) return null;
      return {
        ...common,
        revision: message.revision,
        changedShardIds,
        deletedShardIds,
        totalElements: isFiniteNumber(message.totalElements, 0, 1_000_000) ? message.totalElements : 0,
        updatedAt: isFiniteNumber(message.updatedAt, 0, Number.MAX_SAFE_INTEGER) ? message.updatedAt : Date.now(),
      };
    }
    default:
      return null;
  }
}

async function authenticateSocket(ws: WebSocket, message: any, context: SocketContext): Promise<void> {
  if (context.authenticating) return;
  if (message?.type !== "authenticate" || typeof message.accessToken !== "string" || message.accessToken.length > 8192 || typeof message.boardId !== "string" || !BOARD_ID_PATTERN.test(message.boardId)) {
    closePolicy(ws, "Authentication required");
    return;
  }
  if (!checkAuthRateLimit(context.remoteKey)) {
    closePolicy(ws, "Auth rate limit exceeded");
    return;
  }

  context.authenticating = true;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    ws.send(JSON.stringify({ type: "auth_error", error: "Realtime server is not configured." }));
    closePolicy(ws, "Server not configured");
    return;
  }

  const verifier = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { user, error: userError } = await verifyTokenCached(verifier, message.accessToken);
  if (userError || !user) {
    ws.send(JSON.stringify({ type: "auth_error", error: "Session verification failed." }));
    closePolicy(ws, "Authentication failed");
    return;
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${message.accessToken}` } },
  });
  const { data: accessData, error: accessError } = await userClient.rpc("get_board_access", { p_board_id: message.boardId });
  const access = accessData as { permission?: SocketPermission; canWrite?: boolean; canManage?: boolean } | null;
  const permission = access?.permission;
  const canWrite = access?.canWrite === true;
  const canManage = access?.canManage === true;
  if (accessError || !permission || !new Set(["viewer", "editor", "owner", "admin"]).has(permission)) {
    ws.send(JSON.stringify({ type: "auth_error", error: "Board access denied." }));
    closePolicy(ws, "Board access denied");
    return;
  }

  const clients = rooms.get(message.boardId) || new Set<WebSocket>();
  if (clients.size >= MAX_ROOM_CLIENTS) {
    closePolicy(ws, "Board room is full");
    return;
  }
  const sameUserConnections = Array.from(clients).filter((client) => socketContexts.get(client)?.userId === user.id).length;
  if (sameUserConnections >= MAX_USER_CONNECTIONS_PER_ROOM) {
    closePolicy(ws, "Too many sessions for this board");
    return;
  }

  // Update IP connection stats from unauthenticated to authenticated
  const stats = ipConnectionStats.get(context.remoteKey);
  if (stats) {
    stats.unauthenticated = Math.max(0, stats.unauthenticated - 1);
    stats.authenticated += 1;
  }

  context.authenticating = false;
  context.authenticated = true;
  context.userId = user.id;
  context.boardId = message.boardId;
  context.permission = permission;
  context.canWrite = canWrite;
  context.canManage = canManage;
  context.accessToken = message.accessToken;
  context.lastAuthorizationCheck = Date.now();
  if (context.authTimer) clearTimeout(context.authTimer);
  context.authTimer = null;
  const existingClients = Array.from(clients);
  clients.add(ws);
  rooms.set(message.boardId, clients);
  ws.send(JSON.stringify({ type: "authenticated", boardId: message.boardId, permission, canWrite, canManage }));

  const activePresenter = activePresenters.get(message.boardId);
  if (activePresenter && activePresenter.userId !== user.id) {
    ws.send(JSON.stringify({
      type: "request_follow",
      boardId: message.boardId,
      teacherId: activePresenter.userId,
      teacherName: activePresenter.name,
    }));
  }

  const probe = JSON.stringify({
    type: "collaborator_probe",
    boardId: message.boardId,
    userId: user.id,
  });
  for (const client of existingClients) {
    if (client.readyState === WebSocket.OPEN) client.send(probe);
  }
}

async function loadAuthoritativeManifest(
  ws: WebSocket,
  context: SocketContext,
  requestedRevision: number,
): Promise<Record<string, unknown> | null> {
  if (!context.accessToken || !context.boardId) return null;
  const userClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${context.accessToken}` } },
  });
  const { data, error } = await userClient
    .from("boards")
    .select("current_revision,changed_shard_ids,deleted_shard_ids,total_elements,updated_at")
    .eq("id", context.boardId)
    .maybeSingle();
  if (error || !data) {
    closePolicy(ws, "Board access expired");
    return null;
  }
  const revision = Number(data.current_revision || 0);
  if (!Number.isFinite(revision) || revision !== requestedRevision) return null;
  const normalize = (value: unknown): string[] => Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && /^shard_([0-9]|1[0-5])$/.test(item))))
    : [];
  return {
    revision,
    changedShardIds: normalize(data.changed_shard_ids),
    deletedShardIds: normalize(data.deleted_shard_ids),
    totalElements: Math.max(0, Number(data.total_elements || 0)),
    updatedAt: Math.max(0, Number(data.updated_at || Date.now())),
  };
}

async function getOrVerifyManifest(
  ws: WebSocket,
  context: SocketContext,
  requestedRevision: number
): Promise<Record<string, unknown> | null> {
  const boardId = context.boardId;
  if (!boardId) return null;

  const now = Date.now();
  const cached = boardManifestCache.get(boardId);

  // A cached manifest is authoritative only for the exact revision that was
  // previously read from the database. Never promote client-reported shard
  // metadata for a new revision: an authenticated client could otherwise send
  // a forged sequential revision and make peers hydrate the wrong shards.
  if (
    cached &&
    cached.revision === requestedRevision &&
    now - cached.cachedAt < 5 * 60_000
  ) {
    return {
      revision: cached.revision,
      changedShardIds: cached.changedShardIds,
      deletedShardIds: cached.deletedShardIds,
      totalElements: cached.totalElements,
      updatedAt: cached.updatedAt,
    };
  }

  // New revisions, gaps, restarts, and stale entries must be verified against
  // the authoritative board row.
  const authoritative = await loadAuthoritativeManifest(ws, context, requestedRevision);
  if (authoritative) {
    boardManifestCache.set(boardId, {
      revision: Number(authoritative.revision),
      changedShardIds: authoritative.changedShardIds as string[],
      deletedShardIds: authoritative.deletedShardIds as string[],
      totalElements: Number(authoritative.totalElements),
      updatedAt: Number(authoritative.updatedAt),
      cachedAt: now,
    });
  }
  return authoritative;
}

async function refreshSocketAuthorization(ws: WebSocket, context: SocketContext, maxAgeMs: number): Promise<boolean> {
  if (!context.accessToken || !context.boardId || !SUPABASE_URL || !SUPABASE_KEY) return false;
  if (Date.now() - context.lastAuthorizationCheck < maxAgeMs) return true;
  if (context.authorizationRefresh) return context.authorizationRefresh;

  context.authorizationRefresh = (async () => {
    const userClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${context.accessToken}` } },
    });
    const { data, error } = await userClient.rpc("get_board_access", { p_board_id: context.boardId });
    const access = data as { permission?: SocketPermission; canWrite?: boolean; canManage?: boolean } | null;
    if (error || !access?.permission || !new Set(["viewer", "editor", "owner", "admin"]).has(access.permission)) {
      closePolicy(ws, "Board access expired");
      return false;
    }
    const nextPermission = access.permission;
    const nextCanWrite = access.canWrite === true;
    const nextCanManage = access.canManage === true;
    const changed = context.permission !== nextPermission || context.canWrite !== nextCanWrite || context.canManage !== nextCanManage;
    context.permission = nextPermission;
    context.canWrite = nextCanWrite;
    context.canManage = nextCanManage;
    context.lastAuthorizationCheck = Date.now();
    if (changed && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "permission_updated",
        boardId: context.boardId,
        permission: nextPermission,
        canWrite: nextCanWrite,
        canManage: nextCanManage,
      }));
    }
    return true;
  })();

  try {
    return await context.authorizationRefresh;
  } finally {
    context.authorizationRefresh = null;
  }
}

function configureWebSockets(): void {
  server.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try { pathname = new URL(request.url || "/", "http://localhost").pathname; } catch { socket.destroy(); return; }
    if (pathname !== "/ws" || !originAllowed(request)) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (ws: WebSocket, request: http.IncomingMessage) => {
    const remoteKey = remoteKeyForRequest(request);
    const stats = ipConnectionStats.get(remoteKey) || { unauthenticated: 0, authenticated: 0 };
    const context: SocketContext = {
      authenticated: false, authenticating: false, userId: null, boardId: null, permission: null, canWrite: false, canManage: false,
      accessToken: null, lastAuthorizationCheck: 0, authorizationRefresh: null, remoteKey, released: false,
      isAlive: true, authTimer: null, rateWindows: new Map(),
    };
    socketContexts.set(ws, context);

    if (stats.unauthenticated >= MAX_PREAUTH_CONNECTIONS_PER_IP || (stats.unauthenticated + stats.authenticated) >= MAX_CONNECTIONS_PER_IP) {
      context.released = true;
      closePolicy(ws, "Too many connections");
      return;
    }
    stats.unauthenticated += 1;
    ipConnectionStats.set(remoteKey, stats);
    context.authTimer = setTimeout(() => closePolicy(ws, "Authentication timeout"), 5_000);

    ws.on("pong", () => { context.isAlive = true; });
    ws.on("message", (raw: RawData) => {
      void (async () => {
        try {
          const text = raw.toString();
          if (Buffer.byteLength(text, "utf8") > 128 * 1024) return closePolicy(ws, "Payload too large");
          const message = JSON.parse(text);
          if (!context.authenticated) return await authenticateSocket(ws, message, context);
          const messageType = cleanText(message?.type, 40);
          const authorizationMaxAge = messageType === 'board_manifest_changed' ? 30_000 : 60_000;
          if (!(await refreshSocketAuthorization(ws, context, authorizationMaxAge))) return;
          let payload = sanitizeRelayMessage(message, context);
          if (!payload) return;
          if (payload.type === "board_manifest_changed") {
            const authoritative = await getOrVerifyManifest(ws, context, Number(payload.revision));
            if (!authoritative) return;
            payload = { ...payload, ...authoritative };
          }
          if (payload.type === "ping") {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "pong", id: payload.id }));
            return;
          }
          const clients = context.boardId ? rooms.get(context.boardId) : null;
          if (!clients) return;

          if (payload.type === "board_settings_changed") {
            await Promise.all(Array.from(clients).map(async (client) => {
              if (client === ws || client.readyState !== WebSocket.OPEN) return;
              const peerContext = socketContexts.get(client);
              if (!peerContext?.authenticated) return;
              try {
                await refreshSocketAuthorization(client, peerContext, 0);
              } catch (error) {
                console.error("Peer authorization refresh failed:", safeErrorLabel(error));
                closePolicy(client, "Authorization refresh failed");
              }
            }));
          }

          if (payload.type === "member_permission_changed") {
            const targetUserId = String(payload.targetUserId || "");
            await Promise.all(Array.from(clients).map(async (client) => {
              if (client === ws || client.readyState !== WebSocket.OPEN) return;
              const peerContext = socketContexts.get(client);
              if (!peerContext?.authenticated || peerContext.userId !== targetUserId) return;
              try {
                await refreshSocketAuthorization(client, peerContext, 0);
              } catch (error) {
                console.error("Member authorization refresh failed:", safeErrorLabel(error));
                closePolicy(client, "Authorization refresh failed");
              }
            }));
          }

          if (payload.type === "request_follow" && context.boardId) {
            activePresenters.set(context.boardId, {
              userId: context.userId!,
              name: String(payload.teacherName || "Teacher"),
            });
          } else if (payload.type === "stop_follow" && context.boardId) {
            activePresenters.delete(context.boardId);
          }

          const encoded = JSON.stringify(payload);
          for (const client of clients) {
            if (client === ws || client.readyState !== WebSocket.OPEN) continue;
            if (client.bufferedAmount > BACKPRESSURE_LIMIT && EPHEMERAL_EVENTS.has(String(payload.type))) continue;
            if (client.bufferedAmount > BACKPRESSURE_LIMIT * 4) { client.terminate(); continue; }
            client.send(encoded);
          }
        } catch (error: unknown) {
          console.error("WS message rejected:", safeErrorLabel(error));
        }
      })();
    });
    ws.on("close", () => releaseSocket(ws));
    ws.on("error", (error) => { console.error("WebSocket error:", safeErrorLabel(error)); releaseSocket(ws); });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [hash, entry] of verifiedTokenCache) {
      if (now >= entry.expiresAt) verifiedTokenCache.delete(hash);
    }
    for (const [ip, entry] of authAttemptsByIp) {
      if (now - entry.startedAt >= 20_000) authAttemptsByIp.delete(ip);
    }
    for (const [boardId, manifest] of boardManifestCache) {
      if (now - manifest.cachedAt >= 5 * 60_000) boardManifestCache.delete(boardId);
    }

    for (const client of wss.clients) {
      const context = socketContexts.get(client);
      if (!context) continue;
      if (!context.isAlive) { client.terminate(); releaseSocket(client); continue; }
      context.isAlive = false;
      client.ping();
      if (context.authenticated) {
        void refreshSocketAuthorization(client, context, 5 * 60_000).catch((error) => {
          console.error("WS authorization refresh failed:", safeErrorLabel(error));
          closePolicy(client, "Authorization refresh failed");
        });
      }
    }
  }, 30_000);
  heartbeat.unref();
}

async function configureFrontend(): Promise<void> {
  if (!IS_PRODUCTION) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
    return;
  }
  const distPath = path.join(process.cwd(), "dist");
  const indexPath = path.join(distPath, "index.html");
  try { await access(indexPath, fsConstants.R_OK); }
  catch { throw new Error(`Production build not found at ${indexPath}. Run the Vite build before starting the server.`); }
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path === "/ws" || req.path.startsWith("/api/") || req.path === "/healthz") return res.sendStatus(404);
    return res.sendFile(indexPath);
  });
}

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down cleanly.`);
  const forceExitTimer = setTimeout(() => { console.error("Graceful shutdown timed out; forcing exit."); process.exit(1); }, 8_000);
  forceExitTimer.unref();
  for (const client of wss.clients) { try { client.close(1001, "Server shutting down"); } catch { client.terminate(); } }
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  clearTimeout(forceExitTimer);
  process.exit(0);
}

async function startServer(): Promise<void> {
  await configureFrontend();
  configureWebSockets();
  server.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://0.0.0.0:${PORT}`));
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", safeErrorLabel(reason)));
process.on("uncaughtException", (error) => { console.error("Uncaught exception:", safeErrorLabel(error)); void shutdown("uncaughtException"); });
startServer().catch((error: unknown) => { console.error("Failed to start server:", safeErrorLabel(error)); process.exitCode = 1; });
