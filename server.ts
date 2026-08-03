import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import fsUtils from "fs";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Simple file logger
const logFile = path.join(process.cwd(), 'app-events.log');
function logToFile(level: string, message: string, data: any = null) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (data) {
    try {
      logLine += ' ' + (typeof data === 'object' ? JSON.stringify(data) : String(data));
    } catch (e) {
      logLine += ' [unserializable data]';
    }
  }
  logLine += '\n';
  
  // Also log to console
  if (level === 'error') console.error(logLine.trim());
  else console.log(logLine.trim());

  try {
    fsUtils.appendFileSync(logFile, logLine);
  } catch (e) {
    console.error("Failed to write to log file:", e);
  }
}

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const rooms = new Map<string, Set<WebSocket>>();




// Set up body parser with large limit for pasting images / elements
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Log API (client can send logs here)
app.post("/api/log", (req, res) => {
  if (!req.body) {
    return res.json({ success: false, error: "No body" });
  }
  const { level, message, data } = req.body;
  logToFile(level || 'info', message || 'No message', data);
  res.json({ success: true });
});

// View logs API
app.get("/api/logs", (req, res) => {
  try {
    if (fsUtils.existsSync(logFile)) {
      const content = fsUtils.readFileSync(logFile, 'utf8');
      res.type('text/plain').send(content);
    } else {
      res.type('text/plain').send("No logs yet.");
    }
  } catch (e) {
    res.status(500).send("Error reading logs: " + e.message);
  }
});

// AI Stamp Generation API
app.post("/api/ai/stamp", async (req, res) => {
  try {
    const { prompt, preferredShape, count } = req.body;
    // Check user provided API key from body or header
    const userApiKey = req.body.apiKey || (req.headers["x-gemini-api-key"] as string);

    if (!userApiKey || !userApiKey.trim()) {
      return res.status(400).json({
        success: false,
        error: "API key required",
        message: "AI Stamp Generation requires your Google AI Studio API key.",
        apiKeyUrl: "https://aistudio.google.com/app/apikey"
      });
    }

    const ai = new GoogleGenAI({
      apiKey: userApiKey.trim(),
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });

    const numStamps = Math.min(Math.max(Number(count) || 4, 1), 6);
    const shapeConstraint = preferredShape && preferredShape !== "any" 
      ? `Preferred shape for all stamps is "${preferredShape}".` 
      : `Vary shapes across: "rounded-rect", "circle", "star", "badge", "diamond", "banner", "hexagon", "ribbon", "heart", "shield", "crest".`;

    const systemInstruction = `You are a creative educational and classroom feedback stamp generator.
Given a user prompt or topic, generate ${numStamps} unique, visually distinct stamp design concepts.
For each stamp, provide:
1. "label": Punchy 1-3 word text (e.g., "Space Ace", "Quantum Math", "Top Effort", "Lab Approved").
2. "emoji": Single, highly relevant emoji (e.g., "🚀", "⚛️", "🌟", "🏆", "🧠").
3. "color": Pastel hex color (e.g., "#bfdbfe", "#fbcfe8", "#bbf7d0", "#e9d5ff", "#fef08a", "#99f6e4", "#fed7aa", "#fecaca").
4. "shape": One of "rounded-rect", "circle", "star", "badge", "diamond", "banner", "hexagon", "ribbon", "heart", "shield", "crest".
5. "description": Short 1-sentence tip on when to award this stamp.

${shapeConstraint}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt || "Educational praise and feedback stamps for students",
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              emoji: { type: Type.STRING },
              color: { type: Type.STRING },
              shape: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["label", "emoji", "color", "shape"]
          }
        }
      }
    });

    const jsonText = response.text || "[]";
    const stamps = JSON.parse(jsonText);

    return res.json({
      success: true,
      stamps
    });
  } catch (err: any) {
    console.error("AI Stamp Generation Error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to generate stamps",
      message: err.message || "An error occurred while generating stamps with Gemini API.",
      apiKeyUrl: "https://aistudio.google.com/app/apikey"
    });
  }
});



// Vite middleware for development or Static assets for production
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Handle WebSocket Connection Upgrades on same port 3000
  server.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith("/ws")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  // Handle room-based events
  wss.on("connection", (ws: WebSocket) => {
    let currentBoardId: string | null = null;
    let currentUserId: string | null = null;

    ws.on("message", (messageStr: string) => {
      try {
        const msg = JSON.parse(messageStr);
        if (msg.type === "join") {
          currentBoardId = msg.boardId;
          currentUserId = msg.userId;
          if (currentBoardId) {
            if (!rooms.has(currentBoardId)) {
              rooms.set(currentBoardId, new Set());
            }
            rooms.get(currentBoardId)!.add(ws);
          }
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", id: msg.id }));
        } else if (
          msg.type === "cursor" ||
          msg.type === "drawing_stream" ||
          msg.type === "drawing_stream_end" ||
          msg.type === "element_update" ||
          msg.type === "element_focus" ||
          msg.type === "laser_point" ||
          msg.type === "timer_sync" ||
          msg.type === "request_follow" ||
          msg.type === "stop_follow" ||
          msg.type === "board_manifest_changed"
        ) {
          const boardId = msg.boardId || currentBoardId;
          if (boardId && rooms.has(boardId)) {
            const clients = rooms.get(boardId)!;
            const payload = JSON.stringify(msg);
            clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(payload);
              }
            });
          }
        }
      } catch (err) {
        console.error("WS message error:", err);
      }
    });

    ws.on("close", () => {
      if (currentBoardId && rooms.has(currentBoardId)) {
        const clients = rooms.get(currentBoardId)!;
        clients.delete(ws);
        if (clients.size === 0) {
          rooms.delete(currentBoardId);
        }
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
