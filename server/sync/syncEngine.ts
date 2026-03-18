/**
 * SyncEngine — server-side sync logic for AniTrack
 *
 * Architecture mirrors Syncplay exactly:
 * - Connects directly to MPV via IPC socket (push-based via observe_property)
 * - Connects directly to the hub via socket.io
 * - All sync decisions happen here, in the server process
 * - React UI is just a viewer — no sync logic in the frontend
 *
 * Data flow:
 *   MPV (observe_property) → SyncEngine → hub (state event)
 *   hub (state event) → SyncEngine → MPV (seek/pause via IPC)
 */

import { io as ioClient, Socket } from "socket.io-client";
import net from "net";
import path from "path";
import os from "os";

// ─── Constants (mirrors Syncplay) ─────────────────────────────────────────────

const SEEK_THRESHOLD = 1.0;         // s — diff must exceed this to trigger a seek
const REWIND_THRESHOLD = 4.0;       // s — we are this far ahead → hard rewind
const SLOWDOWN_THRESHOLD = 1.5;     // s — we are this far ahead → slow down
const SLOWDOWN_RESET = 0.1;         // s — back in sync threshold
const SLOWDOWN_RATE = 0.95;         // playback rate when slowing down
const HEARTBEAT_INTERVAL = 2000;    // ms — send position to hub every 2s
const RECONNECT_DELAY = 2000;       // ms — wait before reconnecting MPV

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerState {
  position: number;
  paused: boolean;
  updatedAt: number; // Date.now()
}

interface GlobalState {
  position: number;
  paused: boolean;
  updatedAt: number; // Date.now()
  setBy: string | null;
}

// ─── SyncEngine ───────────────────────────────────────────────────────────────

export class SyncEngine {
  // MPV IPC
  private mpvSocket: net.Socket | null = null;
  private mpvBuffer = "";
  private mpvRequestId = 1;
  private mpvPending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private mpvConnected = false;
  private mpvReconnectTimer: NodeJS.Timeout | null = null;

  // Hub socket
  private hubSocket: Socket | null = null;
  private hubConnected = false;

  // State
  private player: PlayerState = { position: 0, paused: true, updatedAt: 0 };
  private global: GlobalState = { position: 0, paused: true, updatedAt: 0, setBy: null };
  private lastSentState: { position: number; paused: boolean } | null = null;
  private ignoring = 0; // clientIgnoringOnTheFly counter
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private speedSlowed = false;

  // Config
  private username = "Guest";
  private roomId = "";
  private hubUrl = "https://anitrack-hub.onrender.com";
  private active = false;

  // Status callback for UI
  private onStatus: ((status: SyncStatus) => void) | null = null;

  constructor() {}

  // ── Public API ──────────────────────────────────────────────────────────────

  join(username: string, roomId: string, hubUrl: string, onStatus?: (s: SyncStatus) => void) {
    this.username = username;
    this.roomId = roomId;
    this.hubUrl = hubUrl;
    this.onStatus = onStatus || null;
    this.active = true;

    this._connectMpv();
    this._connectHub();
    this._startHeartbeat();

    console.log(`[sync] Joined room "${roomId}" as "${username}"`);
  }

  leave() {
    this.active = false;
    this._stopHeartbeat();
    this.hubSocket?.emit("leave-room", { roomId: this.roomId, username: this.username });
    this.hubSocket?.disconnect();
    this.hubSocket = null;
    this.mpvSocket?.destroy();
    this.mpvSocket = null;
    if (this.mpvReconnectTimer) clearTimeout(this.mpvReconnectTimer);
    console.log(`[sync] Left room "${this.roomId}"`);
  }

  isActive(): boolean { return this.active; }
  isMpvConnected(): boolean { return this.mpvConnected; }
  isHubConnected(): boolean { return this.hubConnected; }

  getRoomId(): string { return this.roomId; }
  getUsername(): string { return this.username; }

  getStatus(): SyncStatus {
    const globalPos = this._extrapolateGlobal();
    const playerPos = this._extrapolatePlayer();
    const diff = Math.abs(playerPos - globalPos);
    return {
      active: this.active,
      mpvConnected: this.mpvConnected,
      hubConnected: this.hubConnected,
      playerPosition: playerPos,
      playerPaused: this.player.paused,
      globalPosition: globalPos,
      globalPaused: this.global.paused,
      drift: diff,
      synced: diff < 2,
    };
  }

  // ── MPV connection ──────────────────────────────────────────────────────────

  private _getMpvSocketPath(): string {
    if (process.platform === "win32") return "\\\\.\\pipe\\anitrack-mpv-sync";
    return path.join(os.tmpdir(), "anitrack-mpv.sock");
  }

  private _connectMpv() {
    if (!this.active) return;

    const sock = net.createConnection(this._getMpvSocketPath());
    this.mpvSocket = sock;

    sock.on("connect", () => {
      this.mpvConnected = true;
      console.log("[sync] MPV connected");
      // Observe pause and time-pos — push events, no polling needed
      this._mpvSendRaw({ command: ["observe_property", 1, "time-pos"] });
      this._mpvSendRaw({ command: ["observe_property", 2, "pause"] });
      this._emitStatus();
    });

    sock.on("data", (data) => {
      this.mpvBuffer += data.toString();
      const lines = this.mpvBuffer.split("\n");
      this.mpvBuffer = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (t) this._handleMpvLine(t);
      }
    });

    sock.on("error", () => {
      this.mpvConnected = false;
      this._emitStatus();
    });

    sock.on("close", () => {
      this.mpvConnected = false;
      this.mpvSocket = null;
      this._emitStatus();
      // Reconnect after delay
      if (this.active) {
        this.mpvReconnectTimer = setTimeout(() => this._connectMpv(), RECONNECT_DELAY);
      }
    });
  }

  private _handleMpvLine(line: string) {
    try {
      const msg = JSON.parse(line);

      // Command response
      if (msg.request_id !== undefined && this.mpvPending.has(msg.request_id)) {
        const { resolve, reject } = this.mpvPending.get(msg.request_id)!;
        this.mpvPending.delete(msg.request_id);
        msg.error === "success" ? resolve(msg.data) : reject(new Error(msg.error));
        return;
      }

      // Property change — this is the core push event from MPV
      if (msg.event === "property-change") {
        const now = Date.now();
        if (msg.name === "time-pos" && msg.data !== null && msg.data !== undefined) {
          this.player.position = msg.data;
          this.player.updatedAt = now;
          // Send state to hub on position update (throttled by heartbeat)
        }
        if (msg.name === "pause" && msg.data !== null && msg.data !== undefined) {
          const wasPaused = this.player.paused;
          this.player.paused = msg.data;
          this.player.updatedAt = now;

          // User changed pause state — send immediately
          if (wasPaused !== msg.data) {
            console.log(`[sync] MPV ${msg.data ? "paused" : "unpaused"} at ${this.player.position.toFixed(1)}s`);
            this._sendStateToHub(false);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  private _mpvSendRaw(obj: object) {
    if (!this.mpvSocket || !this.mpvConnected) return;
    try {
      this.mpvSocket.write(JSON.stringify(obj) + "\n");
    } catch {}
  }

  private _mpvCommand(args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.mpvRequestId++;
      this.mpvPending.set(id, { resolve, reject });
      this._mpvSendRaw({ command: args, request_id: id });
      setTimeout(() => {
        if (this.mpvPending.has(id)) {
          this.mpvPending.delete(id);
          reject(new Error("MPV command timeout"));
        }
      }, 2000);
    });
  }

  private async _mpvSeek(seconds: number) {
    try {
      await this._mpvCommand(["set_property", "time-pos", seconds]);
      this.player.position = seconds;
      this.player.updatedAt = Date.now();
    } catch (e) {
      console.error("[sync] MPV seek failed:", e);
    }
  }

  private async _mpvSetPaused(paused: boolean) {
    try {
      await this._mpvCommand(["set_property", "pause", paused]);
      this.player.paused = paused;
      this.player.updatedAt = Date.now();
    } catch (e) {
      console.error("[sync] MPV setPaused failed:", e);
    }
  }

  private async _mpvSetSpeed(rate: number) {
    try {
      await this._mpvCommand(["set_property", "speed", rate]);
    } catch {}
  }

  // ── Hub connection ──────────────────────────────────────────────────────────

  private _connectHub() {
    if (!this.active) return;

    const socket = ioClient(this.hubUrl, {
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
    });

    this.hubSocket = socket;

    socket.on("connect", () => {
      this.hubConnected = true;
      socket.emit("join-room", this.roomId, this.username);
      console.log(`[sync] Hub connected, joined room "${this.roomId}"`);
      this._emitStatus();
    });

    socket.on("disconnect", () => {
      this.hubConnected = false;
      this._emitStatus();
    });

    // ── Core: receive state from another user ────────────────────────────────
    socket.on("state", ({ position, paused, doSeek, setBy, ignoringOnTheFly }: any) => {
      // Handle ignoringOnTheFly — mirrors Syncplay protocol exactly
      if (ignoringOnTheFly) {
        if (ignoringOnTheFly.server !== undefined) {
          // Server acknowledged our ignore request — clear our counter
          this.ignoring = 0;
        }
        if (ignoringOnTheFly.client !== undefined) {
          // Other client wants us to ignore N of their reports
          // We don't need to do anything — just apply normally
        }
      }

      // If we're ignoring (we just sent a seek/pause), skip this update
      if (this.ignoring > 0) {
        this.ignoring--;
        return;
      }

      // Update global state
      const now = Date.now();
      const messageAge = 0.05; // ~50ms network delay
      const adjustedPosition = paused ? position : position + messageAge;

      const wasPaused = this.global.paused;
      this.global.position = adjustedPosition;
      this.global.paused = paused;
      this.global.updatedAt = now;
      this.global.setBy = setBy;

      // Apply to player
      this._applyGlobalState(adjustedPosition, paused, doSeek, setBy, wasPaused);
    });

    socket.on("message", ({ text, system }: any) => {
      if (system && text?.includes("left the room") && this.mpvConnected) {
        console.log("[sync] User left, pausing");
        this._mpvSetPaused(true);
      }
    });
  }

  // ── Sync logic (mirrors Syncplay _changePlayerStateAccordingToGlobalState) ──

  private _applyGlobalState(position: number, paused: boolean, doSeek: boolean, setBy: string | null, wasPaused: boolean) {
    if (!this.mpvConnected) return;

    const playerPos = this._extrapolatePlayer();
    const diff = playerPos - position; // positive = we are ahead
    const pauseChanged = paused !== wasPaused || paused !== this.player.paused;

    // Explicit seek from another user
    if (doSeek && setBy && setBy !== this.username) {
      console.log(`[sync] Remote seek by ${setBy} to ${position.toFixed(1)}s`);
      this.ignoring = 1; // suppress our next echo
      this._mpvSeek(position);
      return;
    }

    // We are way too far ahead — hard rewind
    if (diff > REWIND_THRESHOLD) {
      console.log(`[sync] Rewind: ${diff.toFixed(1)}s ahead`);
      this.ignoring = 1;
      this._mpvSeek(position);
      return;
    }

    // We are slightly ahead — slow down to drift back
    if (!paused && diff > SLOWDOWN_THRESHOLD && !this.speedSlowed) {
      console.log(`[sync] Slowing down: ${diff.toFixed(1)}s ahead`);
      this.speedSlowed = true;
      this._mpvSetSpeed(SLOWDOWN_RATE);
    } else if (Math.abs(diff) < SLOWDOWN_RESET && this.speedSlowed) {
      console.log("[sync] Back in sync, restoring speed");
      this.speedSlowed = false;
      this._mpvSetSpeed(1.0);
    }

    // Pause/unpause changed
    if (pauseChanged) {
      console.log(`[sync] Remote ${paused ? "pause" : "play"} by ${setBy}`);
      this.ignoring = 1;
      this._mpvSetPaused(paused);
    }
  }

  // ── State sending ────────────────────────────────────────────────────────────

  private _sendStateToHub(isHeartbeat: boolean) {
    if (!this.hubSocket?.connected || !this.active) return;

    const position = this._extrapolatePlayer();
    const paused = this.player.paused;

    // Determine if this is a seek
    // Seeked = player position differs from both previous player position AND global position
    const prevPos = this.lastSentState?.position ?? position;
    const globalPos = this._extrapolateGlobal();
    const playerDiff = Math.abs(prevPos - position);
    const globalDiff = Math.abs(globalPos - position);
    const doSeek = !isHeartbeat && playerDiff > SEEK_THRESHOLD && globalDiff > SEEK_THRESHOLD;

    if (doSeek) this.ignoring = 1; // suppress echo of our own seek

    const payload: any = {
      roomId: this.roomId,
      position,
      paused,
      doSeek,
      setBy: this.username,
    };

    if (this.ignoring > 0) {
      payload.ignoringOnTheFly = { client: this.ignoring };
    }

    this.hubSocket.emit("state", payload);
    this.lastSentState = { position, paused };
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  private _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.hubConnected && this.mpvConnected) {
        this._sendStateToHub(true);
      }
    }, HEARTBEAT_INTERVAL);
  }

  private _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Position extrapolation ────────────────────────────────────────────────────

  private _extrapolatePlayer(): number {
    if (!this.player.updatedAt) return 0;
    if (this.player.paused) return this.player.position;
    return this.player.position + (Date.now() - this.player.updatedAt) / 1000;
  }

  private _extrapolateGlobal(): number {
    if (!this.global.updatedAt) return 0;
    if (this.global.paused) return this.global.position;
    return this.global.position + (Date.now() - this.global.updatedAt) / 1000;
  }

  // ── UI status ─────────────────────────────────────────────────────────────────

  private _emitStatus() {
    this.onStatus?.(this.getStatus());
  }
}

export interface SyncStatus {
  active: boolean;
  mpvConnected: boolean;
  hubConnected: boolean;
  playerPosition: number;
  playerPaused: boolean;
  globalPosition: number;
  globalPaused: boolean;
  drift: number;
  synced: boolean;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const syncEngine = new SyncEngine();
