/**
 * syncEngine.ts — AniTrack SyncWatch sync engine
 * Based on Syncplay 1.7.5 client.py algorithm.
 */

import { Server as SocketIOServer } from "socket.io";
import { getController, IPlayerController } from "./playerController.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_ASK_DELAY             = 0.1;   // 100ms poll interval
const SEEK_THRESHOLD               = 1.0;   // seconds — seek vs drift
const DEFAULT_REWIND_THRESHOLD     = 4.0;   // seconds ahead → rewind
const FASTFORWARD_BEHIND_THRESHOLD = 1.75;  // seconds behind before FF tracking
const DEFAULT_FASTFORWARD_THRESHOLD= 5.0;   // seconds behind → FF
const FASTFORWARD_EXTRA_TIME       = 0.25;  // overshoot when FF
const FASTFORWARD_RESET_THRESHOLD  = 3.0;   // seconds before re-checking FF
const SLOWDOWN_RATE                = 0.95;  // rate for slow correction
const DEFAULT_SLOWDOWN_KICKIN      = 1.5;   // seconds drift → slow down
const SLOWDOWN_RESET_THRESHOLD     = 0.1;   // seconds drift → restore rate
const SYNC_ON_PAUSE                = true;  // seek to peer pos when paused
const PAUSE_DEBOUNCE               = 500;   // ms — avoid double pause
const BROADCAST_INTERVAL           = 500;   // ms — periodic state broadcast
const JOIN_BROADCAST_HOLDOFF       = 3000;  // ms — don't broadcast after join
const SEEK_SUPPRESS_MS             = 700;   // ms — suppress after remote seek

// ─── Types ────────────────────────────────────────────────────────────────────

interface PeerState {
  username: string;
  position: number;
  paused: boolean;
  updatedAt: number;
}

// ─── SyncEngine ───────────────────────────────────────────────────────────────

export class SyncEngine {
  private active = false;
  private isHost = false;
  private room = "";
  username = "";

  private socket: any = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  // ── Local player state ────────────────────────────────────────────────────
  private _playerPosition = 0.0;
  private _playerPaused = true;
  private _lastPlayerUpdate: number | null = null;

  // ── Global (peer) state from hub ──────────────────────────────────────────
  private _globalPosition = 0.0;
  private _globalPaused = true;
  private _lastGlobalUpdate: number | null = null;

  // ── Correction state ──────────────────────────────────────────────────────
  private _speedChanged = false;
  private _behindFirstDetected: number | null = null;

  // ── Debounce / suppress ───────────────────────────────────────────────────
  private _lastPauseCommandAt = 0;
  private _lastBroadcastAt = 0;
  private _suppressUntil = 0;  // suppress local broadcast until this timestamp
  private _joinedAt = 0;       // holdoff broadcasts for JOIN_BROADCAST_HOLDOFF

  // ── Player reconnect ──────────────────────────────────────────────────────
  private _playerWasConnected = false;

  // ── Peers ─────────────────────────────────────────────────────────────────
  private peers = new Map<string, PeerState>();

  constructor(private io: SocketIOServer) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  isActive(): boolean { return this.active; }
  getRoom(): string { return this.room; }
  getPeers(): PeerState[] { return [...this.peers.values()]; }

  // Extrapolates from last known position
  getPlayerPosition(): number {
    if (!this._lastPlayerUpdate) return this._lastGlobalUpdate ? this.getGlobalPosition() : 0.0;
    let pos = this._playerPosition;
    if (!this._playerPaused) pos += (Date.now() - this._lastPlayerUpdate) / 1000;
    return pos;
  }

  getPlayerPaused(): boolean {
    if (!this._lastPlayerUpdate) return this._lastGlobalUpdate ? this.getGlobalPaused() : true;
    return this._playerPaused;
  }

  // Extrapolates from last known peer position
  getGlobalPosition(): number {
    if (!this._lastGlobalUpdate) return 0.0;
    let pos = this._globalPosition;
    if (!this._globalPaused) pos += (Date.now() - this._lastGlobalUpdate) / 1000;
    return pos;
  }

  getGlobalPaused(): boolean {
    if (!this._lastGlobalUpdate) return true;
    return this._globalPaused;
  }

  // Syncplay's _determinePlayerStateChange
  private _determinePlayerStateChange(paused: boolean, position: number): { pauseChange: boolean; seeked: boolean } {
    // pauseChange: both global AND player disagree with new state (prevents oscillation)
    const pauseChange = this.getPlayerPaused() !== paused && this.getGlobalPaused() !== paused;
    const playerDiff = Math.abs(this.getPlayerPosition() - position);
    const globalDiff = Math.abs(this.getGlobalPosition() - position);
    const seeked = playerDiff > SEEK_THRESHOLD && globalDiff > SEEK_THRESHOLD;
    return { pauseChange, seeked };
  }

  async join(hubUrl: string, room: string, username: string) {
    if (this.active) await this.leave();

    this.room = room;
    this.username = username;
    this._joinedAt = Date.now();

    console.log(`[sync] Joining room "${room}" as "${username}"`);

    const { io: sioClient } = await import("socket.io-client");
    this.socket = sioClient(hubUrl, { transports: ["websocket"], reconnection: true });

    this.socket.on("connect", () => {
      console.log(`[sync] Hub connected, joined room "${room}"`);
      this.socket.emit("join-room", room, username);
    });

    this.socket.on("disconnect", () => console.log("[sync] Hub disconnected"));

    this.socket.on("state", (data: any) => this._onHubState(data));

    this.socket.on("playlist-updated", (data: any) => {
      if (!data?.readyUsers) return;
      const now = Date.now();
      for (const user of Object.keys(data.readyUsers)) {
        if (user !== this.username && !this.peers.has(user)) {
          this.peers.set(user, { username: user, position: 0, paused: true, updatedAt: now });
        }
      }
      for (const user of [...this.peers.keys()]) {
        if (!(user in data.readyUsers)) this.peers.delete(user);
      }
      if (data.host !== undefined) this.isHost = data.host === this.username;
      this._notifyPeers();
    });

    this.socket.on("peer-disconnected", async (data: { username: string }) => {
      console.log(`[sync] Peer disconnected: ${data.username} — pausing`);
      const ctrl = await getController();
      if (ctrl) {
        try {
          await ctrl.setPaused(true);
          this._playerPaused = true;
          this._lastPlayerUpdate = Date.now();
          this._globalPaused = true;
          this._lastGlobalUpdate = Date.now();
          this._broadcastState(this.getPlayerPosition(), true, false);
        } catch {}
      }
    });

    this.socket.on("host-changed", (data: any) => {
      this.isHost = data.host === this.username;
      console.log(`[sync] Host is now: ${data.host} (me: ${this.isHost})`);
      this.io.emit("sync-host-changed", { host: data.host, isMe: this.isHost });
    });

    this.active = true;
    this._startPolling();
    this._startBroadcasting();
  }

  async leave() {
    console.log(`[sync] Left room "${this.room}"`);
    this.active = false;
    this._stopPolling();
    this._stopBroadcasting();
    this.socket?.disconnect();
    this.socket = null;
    this.room = "";
    this.peers.clear();
    this._lastGlobalUpdate = null;
    this._lastPlayerUpdate = null;
    this._speedChanged = false;
    this._behindFirstDetected = null;
    this.isHost = false;
    this._playerWasConnected = false;

    if (this._speedChanged) {
      const ctrl = await getController();
      if (ctrl) { try { await ctrl.setRate(1.0); } catch {} }
      this._speedChanged = false;
    }
  }

  // ─── Hub state received ────────────────────────────────────────────────────

  private _onHubState(data: any) {
    const now = Date.now();

    let position: number = data.position ?? 0;
    const paused: boolean = data.paused ?? true;
    const setBy: string = data.setBy ?? "";
    const doSeek: boolean = data.doSeek === true;

    // Compensate for message transit time
    const messageAge = data.ts ? Math.max(0, (now - data.ts) / 1000) : 0;
    if (!paused) position += messageAge;

    if (setBy && setBy !== this.username) {
      this.peers.set(setBy, { username: setBy, position, paused, updatedAt: now });
      this._notifyPeers();
    }

    if (setBy === this.username) return;

    this._changePlayerStateAccordingToGlobalState(position, paused, doSeek, setBy);
  }

  private async _changePlayerStateAccordingToGlobalState(
    position: number,
    paused: boolean,
    doSeek: boolean,
    setBy: string,
  ) {
    const now = Date.now();

    // Compute diff and pauseChanged BEFORE updating global state
    const pauseChanged = paused !== this.getGlobalPaused() && paused !== this.getPlayerPaused();
    const diff = this.getPlayerPosition() - position;

    // Update global state FIRST
    const isFirstUpdate = this._lastGlobalUpdate === null;
    this._globalPosition = position;
    this._globalPaused = paused;
    this._lastGlobalUpdate = now;

    const ctrl = await getController();
    // If player not open yet, global state is stored and will be used when player connects
    if (!ctrl) return;

    // First state update — seek to peer position if player differs
    if (isFirstUpdate) {
      const status = await ctrl.getStatus();
      const playerPos = status?.position ?? 0;
      if (Math.abs(playerPos - position) > 2.0) {
        try {
          await this._setPosition(ctrl, position);
          await ctrl.setPaused(paused);
          this._playerPosition = position;
          this._playerPaused = paused;
          this._lastPlayerUpdate = now;
          this._suppressUntil = now + SEEK_SUPPRESS_MS;
        } catch {}
      }
      return;
    }

    // ── 1. Explicit seek from peer
    if (doSeek) await this._serverSeeked(ctrl, position, setBy);

    // ── 2. Rewind — we are too far ahead
    if (diff > DEFAULT_REWIND_THRESHOLD && !doSeek && Date.now() > this._suppressUntil) {
      await this._rewindPlayerDueToTimeDifference(ctrl, position, setBy);
    }

    // ── 3. Fast forward — we are too far behind
    if (diff < (FASTFORWARD_BEHIND_THRESHOLD * -1) && !doSeek && Date.now() > this._suppressUntil) {
      if (this._behindFirstDetected === null) {
        this._behindFirstDetected = now;
      } else {
        const durationBehind = (now - this._behindFirstDetected) / 1000;
        if (
          durationBehind > (DEFAULT_FASTFORWARD_THRESHOLD - FASTFORWARD_BEHIND_THRESHOLD) &&
          diff < (DEFAULT_FASTFORWARD_THRESHOLD * -1)
        ) {
          await this._fastforwardPlayerDueToTimeDifference(ctrl, position, setBy);
          this._behindFirstDetected = now + FASTFORWARD_RESET_THRESHOLD * 1000;
        }
      }
    } else {
      this._behindFirstDetected = null;
    }

    // ── 4. Slow down for small drift
    if (!doSeek && !paused) {
      await this._slowDownToCoverTimeDifference(ctrl, diff, setBy);
    }

    // ── 5. Apply pause/unpause
    let madeChange = doSeek;
    if (pauseChanged) {
      if (now - this._lastPauseCommandAt > PAUSE_DEBOUNCE) {
        if (paused) {
          await this._serverPaused(ctrl, position, setBy);
        } else {
          await this._serverUnpaused(ctrl, setBy);
        }
        this._lastPauseCommandAt = now;
        madeChange = true;
      }
    }

    if (madeChange) {
      this._suppressUntil = now + SEEK_SUPPRESS_MS;
      setTimeout(async () => {
        try {
          const c = await getController();
          const s = c ? await c.getStatus() : null;
          if (s) {
            this._playerPosition = s.position;
            this._playerPaused = s.paused;
            this._lastPlayerUpdate = Date.now();
          }
        } catch {}
      }, 250);
    }
  }

  private async _serverSeeked(ctrl: IPlayerController, position: number, setBy: string) {
    if (setBy === this.username) return;
    console.log(`[sync] Remote seek by ${setBy} → ${position.toFixed(2)}s`);
    await this._setPosition(ctrl, position);
    if (this._speedChanged) {
      try { await ctrl.setRate(1.0); } catch {}
      this._speedChanged = false;
    }
  }

  private async _rewindPlayerDueToTimeDifference(ctrl: IPlayerController, position: number, setBy: string) {
    if (setBy === this.username) return;
    console.log(`[sync] Rewind: ${(this.getPlayerPosition() - position).toFixed(2)}s ahead → ${position.toFixed(2)}s`);
    await this._setPosition(ctrl, position);
    if (this._speedChanged) {
      try { await ctrl.setRate(1.0); } catch {}
      this._speedChanged = false;
    }
  }

  private async _fastforwardPlayerDueToTimeDifference(ctrl: IPlayerController, position: number, setBy: string) {
    if (setBy === this.username) return;
    const target = position + FASTFORWARD_EXTRA_TIME;
    console.log(`[sync] FF: ${Math.abs(this.getPlayerPosition() - position).toFixed(2)}s behind → ${target.toFixed(2)}s`);
    await this._setPosition(ctrl, target);
    if (this._speedChanged) {
      try { await ctrl.setRate(1.0); } catch {}
      this._speedChanged = false;
    }
  }

  private async _serverPaused(ctrl: IPlayerController, position: number, setBy: string) {
    console.log(`[sync] Remote pause by ${setBy} at ${position.toFixed(2)}s`);
    if (SYNC_ON_PAUSE && setBy !== this.username) await this._setPosition(ctrl, position);
    try {
      await ctrl.setPaused(true);
      this._playerPaused = true;
      this._lastPlayerUpdate = Date.now();
    } catch {}
  }

  private async _serverUnpaused(ctrl: IPlayerController, setBy: string) {
    console.log(`[sync] Remote unpause by ${setBy}`);
    try {
      await ctrl.setPaused(false);
      this._playerPaused = false;
      this._lastPlayerUpdate = Date.now();
    } catch {}
  }

  private async _slowDownToCoverTimeDifference(ctrl: IPlayerController, diff: number, setBy: string) {
    if (setBy === this.username) return;
    const absDiff = Math.abs(diff);
    if (absDiff > DEFAULT_SLOWDOWN_KICKIN && !this._speedChanged) {
      console.log(`[sync] Slowing down: drift=${diff.toFixed(2)}s`);
      try { await ctrl.setRate(SLOWDOWN_RATE); this._speedChanged = true; } catch {}
    } else if (this._speedChanged && absDiff < SLOWDOWN_RESET_THRESHOLD) {
      console.log(`[sync] Restoring rate: drift=${diff.toFixed(2)}s`);
      try { await ctrl.setRate(1.0); this._speedChanged = false; } catch {}
    }
  }

  private async _setPosition(ctrl: IPlayerController, position: number) {
    try {
      await ctrl.seek(position);
      this._playerPosition = position;
      this._lastPlayerUpdate = Date.now();
    } catch {}
  }

  // ─── Polling ─────────────────────────────────────────────────────────────

  private _startPolling() {
    this._stopPolling();
    this.pollTimer = setInterval(() => this._poll(), PLAYER_ASK_DELAY * 1000);
  }

  private _stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private async _poll() {
    if (!this.active) return;
    const ctrl = await getController();

    if (!ctrl) {
      if (this._playerWasConnected) {
        this._playerWasConnected = false;
        console.log("[sync] Player closed — pausing");
        this._globalPaused = true;
        this._lastGlobalUpdate = Date.now();
        this._broadcastState(this.getPlayerPosition(), true, false);
        if (this.socket?.connected) {
          this.socket.emit("message", {
            roomId: this.room,
            sender: "system",
            text: `⚠ ${this.username} closed their player — playback paused.`,
            danger: true,
          });
        }
      }
      return;
    }

    const status = await ctrl.getStatus();
    if (!status) {
      if (this._playerWasConnected) {
        this._playerWasConnected = false;
        console.log("[sync] Player closed — pausing");
        this._globalPaused = true;
        this._lastGlobalUpdate = Date.now();
        this._broadcastState(this.getPlayerPosition(), true, false);
        if (this.socket?.connected) {
          this.socket.emit("message", {
            roomId: this.room,
            sender: "system",
            text: `⚠ ${this.username} closed their player — playback paused.`,
            danger: true,
          });
        }
      }
      return;
    }

    // Player just reconnected — seek to peer's current position
    if (!this._playerWasConnected && this._lastGlobalUpdate) {
      const peerPos = this.getGlobalPosition();
      console.log(`[sync] Player reconnected — seeking to peer position ${peerPos.toFixed(2)}s`);
      try {
        await ctrl.seek(peerPos);
        await ctrl.setPaused(this._globalPaused);
        this._playerPosition = peerPos;
        this._playerPaused = this._globalPaused;
        this._lastPlayerUpdate = Date.now();
        this._suppressUntil = Date.now() + SEEK_SUPPRESS_MS;
      } catch {}
    }
    this._playerWasConnected = true;

    const now = Date.now();
    const { pauseChange, seeked } = this._determinePlayerStateChange(status.paused, status.position);

    const prevPosition = this._playerPosition;
    this._playerPosition = status.position;
    this._playerPaused = status.paused;
    this._lastPlayerUpdate = now;

    this.io.emit("sync-status", {
      position: status.position,
      paused: status.paused,
      playerConnected: true,
    });

    if (!this._lastGlobalUpdate) return;

    if (pauseChange || seeked) {
      if (Date.now() < this._suppressUntil) {
        // suppressed — remote change applied, don't echo back
      } else {
        if (seeked) {
          console.log(`[sync] Local seek: ${prevPosition.toFixed(2)} → ${status.position.toFixed(2)}`);
        } else {
          console.log(`[sync] Local ${status.paused ? "pause" : "play"} at ${status.position.toFixed(2)}s`);
        }
        this._broadcastState(status.position, status.paused, seeked);
      }
    }
  }

  // ─── Broadcasting ─────────────────────────────────────────────────────────

  private _startBroadcasting() {
    this._stopBroadcasting();
    this.broadcastTimer = setInterval(async () => {
      if (!this.active) return;
      const ctrl = await getController();
      if (!ctrl) return;
      const status = await ctrl.getStatus();
      if (!status) return;
      const now = Date.now();
      if (now - this._lastBroadcastAt < BROADCAST_INTERVAL) return;
      if (now < this._suppressUntil) return; // suppress periodic broadcast after remote seek
      this._broadcastState(status.position, status.paused, false);
    }, BROADCAST_INTERVAL);
  }

  private _stopBroadcasting() {
    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null; }
  }

  private _broadcastState(position: number, paused: boolean, doSeek: boolean) {
    if (!this.active || !this.socket?.connected) return;
    // Hold off broadcasts after joining — receive peer state first
    if (Date.now() - this._joinedAt < JOIN_BROADCAST_HOLDOFF) return;
    // When we send a seek, suppress incoming corrections immediately
    if (doSeek) this._suppressUntil = Date.now() + SEEK_SUPPRESS_MS;
    const msg: any = {
      roomId: this.room,
      position,
      paused,
      setBy: this.username,
      ts: Date.now(),
    };
    if (doSeek) msg.doSeek = true;
    this.socket.emit("state", msg);
    this._lastBroadcastAt = Date.now();
  }

  private _notifyPeers() {
    this.io.emit("sync-peers", [...this.peers.values()]);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _engine: SyncEngine | null = null;

export function getSyncEngine(io?: SocketIOServer): SyncEngine {
  if (!_engine) {
    if (!io) throw new Error("SyncEngine not initialized — pass io on first call");
    _engine = new SyncEngine(io);
  }
  return _engine;
}
