/**
 * SyncEngine — server-side sync logic for AniTrack
 *
 * Architecture mirrors Syncplay:
 * - Connects to the hub via socket.io
 * - Controls the local player via IPlayerController (MPV or VLC — player-agnostic)
 * - All sync decisions happen here
 * - React UI is a viewer only
 *
 * Data flow:
 *   Player (polled/push) → SyncEngine → hub (state event)
 *   hub (state event)    → SyncEngine → Player (seek/pause via controller)
 */

import { io as ioClient, Socket } from "socket.io-client";
import { getController, type IPlayerController } from "./playerController.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEEK_THRESHOLD      = 1.0;   // s — diff must exceed this to trigger a seek
const REWIND_THRESHOLD    = 4.0;   // s — we are this far ahead → hard rewind
const SLOWDOWN_THRESHOLD  = 1.5;   // s — we are this far ahead → slow down
const SLOWDOWN_RESET      = 0.1;   // s — back in sync threshold
const SLOWDOWN_RATE       = 0.95;  // playback rate when slowing down
const HEARTBEAT_INTERVAL  = 2000;  // ms — send position to hub every 2s
const PLAYER_POLL_INTERVAL = 150;  // ms — poll player for state changes

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerState {
  position: number;
  paused: boolean;
  updatedAt: number;
}

interface GlobalState {
  position: number;
  paused: boolean;
  updatedAt: number;
  setBy: string | null;
}

export interface SyncStatus {
  active: boolean;
  playerConnected: boolean;  // renamed from mpvConnected — player-agnostic
  hubConnected: boolean;
  playerPosition: number;
  playerPaused: boolean;
  globalPosition: number;
  globalPaused: boolean;
  drift: number;
  synced: boolean;
}

// ─── SyncEngine ───────────────────────────────────────────────────────────────

export class SyncEngine {
  // Hub socket
  private hubSocket: Socket | null = null;
  private hubConnected = false;

  // Player state (updated via polling)
  private player: PlayerState = { position: 0, paused: true, updatedAt: 0 };
  private global: GlobalState = { position: 0, paused: true, updatedAt: 0, setBy: null };
  private lastSentState: { position: number; paused: boolean } | null = null;
  private lastPlayerPosition: number = 0;  // to detect user seeks

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private speedSlowed = false;

  // Suppress flags — prevent echo when WE command the player
  private suppressNextPauseEvent = false;
  private suppressNextSeekEvent = false;

  // Config
  private username = "Guest";
  private roomId = "";
  private hubUrl = "https://anitrack-hub.onrender.com";
  private active = false;

  private onStatus: ((status: SyncStatus) => void) | null = null;

  constructor() {}

  // ── Public API ───────────────────────────────────────────────────────────────

  join(username: string, roomId: string, hubUrl: string, onStatus?: (s: SyncStatus) => void) {
    this.username = username;
    this.roomId = roomId;
    this.hubUrl = hubUrl;
    this.onStatus = onStatus || null;
    this.active = true;

    this._connectHub();
    this._startPlayerPoll();
    this._startHeartbeat();

    console.log(`[sync] Joined room "${roomId}" as "${username}"`);
  }

  leave() {
    this.active = false;
    this._stopHeartbeat();
    this._stopPlayerPoll();
    this.hubSocket?.emit("leave-room", { roomId: this.roomId, username: this.username });
    this.hubSocket?.disconnect();
    this.hubSocket = null;
    console.log(`[sync] Left room "${this.roomId}"`);
  }

  isActive(): boolean { return this.active; }
  isHubConnected(): boolean { return this.hubConnected; }

  getRoomId(): string { return this.roomId; }
  getUsername(): string { return this.username; }

  getStatus(): SyncStatus {
    const globalPos = this._extrapolateGlobal();
    const playerPos = this._extrapolatePlayer();
    const diff = Math.abs(playerPos - globalPos);
    return {
      active: this.active,
      playerConnected: this.player.updatedAt > 0,
      hubConnected: this.hubConnected,
      playerPosition: playerPos,
      playerPaused: this.player.paused,
      globalPosition: globalPos,
      globalPaused: this.global.paused,
      drift: diff,
      synced: diff < 2,
    };
  }

  // ── Player polling ───────────────────────────────────────────────────────────
  // Instead of MPV-specific IPC observe_property, we poll via getController()
  // which works for both MPV and VLC.

  private _startPlayerPoll() {
    this._stopPlayerPoll();
    this.pollTimer = setInterval(() => this._pollPlayer(), PLAYER_POLL_INTERVAL);
  }

  private _stopPlayerPoll() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async _pollPlayer() {
    if (!this.active) return;

    const ctrl = await getController();
    if (!ctrl) return;

    try {
      const status = await ctrl.getStatus();
      if (!status) return;

      const now = Date.now();
      const prevPaused = this.player.paused;
      const prevPosition = this.player.position;

      this.player.position = status.position;
      this.player.paused = status.paused;
      this.player.updatedAt = now;

      // Detect user seek: position jumped unexpectedly
      if (this.suppressNextSeekEvent) {
        // We commanded this seek — ignore
        this.suppressNextSeekEvent = false;
        this.lastPlayerPosition = status.position;
        return;
      }

      const expectedPos = prevPosition + (this.player.paused ? 0 : PLAYER_POLL_INTERVAL / 1000);
      const jumped = Math.abs(status.position - expectedPos) > 2.0 && this.lastPlayerPosition !== 0;
      this.lastPlayerPosition = status.position;

      if (jumped && this.hubConnected) {
        console.log(`[sync] User seeked to ${status.position.toFixed(1)}s`);
        this._sendStateToHub(false);
        return;
      }

      // Detect user pause/unpause
      if (this.suppressNextPauseEvent) {
        this.suppressNextPauseEvent = false;
        return;
      }
      if (status.paused !== prevPaused && this.hubConnected) {
        console.log(`[sync] Player ${status.paused ? "paused" : "unpaused"} by user at ${status.position.toFixed(1)}s`);
        this._sendStateToHub(false);
      }
    } catch {
      // Controller may have disconnected — will reconnect on next poll
    }
  }

  // ── Hub connection ───────────────────────────────────────────────────────────

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

    socket.on("reconnect", () => {
      console.log("[sync] Hub reconnected — rejoining room");
      socket.emit("join-room", this.roomId, this.username);
    });

    socket.on("disconnect", () => {
      this.hubConnected = false;
      this._emitStatus();
      // Pause our player when we lose the hub
      if (this.player.updatedAt > 0) {
        console.log("[sync] Hub disconnected — pausing player");
        this._commandSetPaused(true);
      }
    });

    // Core: receive state from another user
    socket.on("state", ({ position, paused, doSeek, setBy, ignoringOnTheFly }: any) => {
      const now = Date.now();
      const messageAge = 0.05; // ~50ms network delay
      const adjustedPosition = paused ? position : position + messageAge;

      const wasPaused = this.global.paused;
      this.global.position = adjustedPosition;
      this.global.paused = paused;
      this.global.updatedAt = now;
      this.global.setBy = setBy;

      this._applyGlobalState(adjustedPosition, paused, doSeek, setBy, wasPaused);
    });

    socket.on("message", ({ text, system }: any) => {
      if (system && text?.includes("left the room")) {
        console.log(`[sync] ${text} — pausing player`);
        this._commandSetPaused(true);
      }
    });
  }

  // ── Sync logic ───────────────────────────────────────────────────────────────

  private _applyGlobalState(
    position: number,
    paused: boolean,
    doSeek: boolean,
    setBy: string | null,
    wasPaused: boolean
  ) {
    if (this.player.updatedAt === 0) return; // player not ready yet

    const playerPos = this._extrapolatePlayer();
    const diff = playerPos - position; // positive = we are ahead
    const pauseChanged = paused !== wasPaused || paused !== this.player.paused;

    // Explicit seek from another user
    if (doSeek && setBy && setBy !== this.username) {
      console.log(`[sync] Remote seek by ${setBy} to ${position.toFixed(1)}s`);
      this._commandSeek(position);
      return;
    }

    // We are way too far ahead — hard rewind
    if (diff > REWIND_THRESHOLD) {
      console.log(`[sync] Rewind: ${diff.toFixed(1)}s ahead`);
      this._commandSeek(position);
      return;
    }

    // We are slightly ahead — slow down
    if (!paused && diff > SLOWDOWN_THRESHOLD && !this.speedSlowed) {
      console.log(`[sync] Slowing down: ${diff.toFixed(1)}s ahead`);
      this.speedSlowed = true;
      this._commandSetRate(SLOWDOWN_RATE);
    } else if (Math.abs(diff) < SLOWDOWN_RESET && this.speedSlowed) {
      console.log("[sync] Back in sync, restoring speed");
      this.speedSlowed = false;
      this._commandSetRate(1.0);
    }

    // Pause state changed
    if (pauseChanged) {
      console.log(`[sync] Remote ${paused ? "pause" : "play"} by ${setBy}`);
      this._commandSetPaused(paused);
    }
  }

  // ── Player commands ──────────────────────────────────────────────────────────
  // All go through getController() — works for MPV and VLC

  private async _commandSeek(seconds: number) {
    const ctrl = await getController();
    if (!ctrl) return;
    try {
      this.suppressNextSeekEvent = true;
      await ctrl.seek(seconds);
      this.player.position = seconds;
      this.player.updatedAt = Date.now();
    } catch (e) {
      this.suppressNextSeekEvent = false;
      console.error("[sync] seek failed:", e);
    }
  }

  private async _commandSetPaused(paused: boolean) {
    const ctrl = await getController();
    if (!ctrl) return;
    try {
      this.suppressNextPauseEvent = true;
      await ctrl.setPaused(paused);
      this.player.paused = paused;
      this.player.updatedAt = Date.now();
    } catch (e) {
      this.suppressNextPauseEvent = false;
      console.error("[sync] setPaused failed:", e);
    }
  }

  private async _commandSetRate(rate: number) {
    const ctrl = await getController();
    if (!ctrl) return;
    try {
      // VlcController exposes setRate; MpvController doesn't have it as a named method
      // but we can use seek/setPaused workaround — for now just try casting
      if (typeof (ctrl as any).setRate === "function") {
        await (ctrl as any).setRate(rate);
      } else {
        // MPV: use set_property speed via the underlying IPC
        // MpvController doesn't expose setRate — add it via duck typing below
        await (ctrl as any)._command(["set_property", "speed", rate]);
      }
    } catch (e) {
      console.error("[sync] setRate failed:", e);
    }
  }

  // ── State sending ────────────────────────────────────────────────────────────

  private _sendStateToHub(isHeartbeat: boolean) {
    if (!this.hubSocket?.connected || !this.active) return;

    const position = this._extrapolatePlayer();
    const paused = this.player.paused;

    const prevPos = this.lastSentState?.position ?? position;
    const globalPos = this._extrapolateGlobal();
    const playerDiff = Math.abs(prevPos - position);
    const globalDiff = Math.abs(globalPos - position);
    const doSeek = !isHeartbeat && playerDiff > SEEK_THRESHOLD && globalDiff > SEEK_THRESHOLD;

    const payload: any = {
      roomId: this.roomId,
      position,
      paused,
      doSeek,
      setBy: this.username,
    };

    this.hubSocket.emit("state", payload);
    this.lastSentState = { position, paused };
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────────

  private _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.hubConnected && this.player.updatedAt > 0) {
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

  // ── Position extrapolation ───────────────────────────────────────────────────

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

// ─── Singleton ────────────────────────────────────────────────────────────────

export const syncEngine = new SyncEngine();
