import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import path from "path";
import { getDb } from "./db.js";
import animeRouter from "./routes/anime.js";
import syncRouter from "./routes/sync.js";
import episodesRouter from "./routes/episodes.js";
import settingsRouter from "./routes/settings.js";
import trackerRouter from "./routes/tracker.js";
import trackerImportRouter from "./routes/tracker-import.js";
import filesRouter from "./routes/files.js";
import playbackRouter from "./routes/playback.js";
import torrentsRouter from "./routes/torrents.js";
import browseRouter from "./routes/browse.js";

const IS_PROD = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.SERVER_PORT ?? "3000", 10);

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000", "file://"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  },
});

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin.startsWith("http://localhost") || origin === "file://") {
      cb(null, true);
    } else {
      cb(new Error("Not allowed by CORS"));
    }
  },
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  (req as express.Request & { io: SocketIOServer }).io = io;
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
});

// Proxy image — serves from disk cache, falls back to remote
app.get("/api/proxy-image", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) { res.status(400).json({ error: "url required" }); return; }
  try {
    const url = new URL(imageUrl);
    const allowed = ["s4.anilist.co", "cdn.myanimelist.net", "img.anisearch.com"];
    if (!allowed.some(h => url.hostname.endsWith(h))) {
      res.status(403).json({ error: "Host not allowed" }); return;
    }
    const response = await fetch(imageUrl);
    if (!response.ok) { res.status(response.status).send("Upstream error"); return; }
    const ct = response.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.use("/api/anime", animeRouter);
app.use("/api/sync", syncRouter);
app.use("/api/anime/:animeId/episodes", episodesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/tracker", trackerRouter);
app.use("/api/tracker", trackerImportRouter);
app.use("/api/files", filesRouter);
app.use("/api/playback", playbackRouter);
app.use("/api/torrents", torrentsRouter);
app.use("/api/browse", browseRouter);

app.use("/api/*", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

if (IS_PROD) {
  const distPath = path.join(__dirname, "..", "renderer");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

io.on("connection", (socket) => {
  console.log("[socket] Client connected:", socket.id);
  socket.on("disconnect", () => console.log("[socket] Client disconnected:", socket.id));
  socket.on("subscribe:anime", (id: number) => socket.join(`anime:${id}`));
  socket.on("unsubscribe:anime", (id: number) => socket.leave(`anime:${id}`));
});

try { getDb(); } catch (err) {
  console.error("[server] DB init failed:", err);
  process.exit(1);
}

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] AniTrack running on http://127.0.0.1:${PORT}`);
});

declare global {
  namespace Express {
    interface Request { io: SocketIOServer; }
  }
}

export { io };
