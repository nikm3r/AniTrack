import net from "net";
import path from "path";
import fs from "fs";
import http from "http";
import os from "os";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerStatus {
  position: number;
  paused: boolean;
  filename: string | null;
}

export interface IPlayerController {
  getStatus(): Promise<PlayerStatus | null>;
  seek(seconds: number): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  isConnected(): boolean;
  disconnect(): void;
}

// ─── MPV Controller ───────────────────────────────────────────────────────────
// Communicates via JSON IPC socket (Unix socket on Linux/macOS, named pipe on Windows)

export class MpvController implements IPlayerController {
  private socket: net.Socket | null = null;
  private connected = false;
  private requestId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private buffer = "";
  private observers = new Map<string, (val: any) => void>();
  private _status: PlayerStatus = { position: 0, paused: true, filename: null };

  constructor(private socketPath: string) {}

  static getSocketPath(): string {
    if (process.platform === "win32") {
      return "\\\\.\\pipe\\anitrack-mpv-sync";
    }
    return path.join(os.tmpdir(), "anitrack-mpv.sock");
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on("connect", () => {
        this.connected = true;
        this._observeProperties();
        resolve();
      });

      this.socket.on("data", (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) this._handleLine(line.trim());
        }
      });

      this.socket.on("error", (err) => {
        this.connected = false;
        if (!this.socket) return;
        reject(err);
      });

      this.socket.on("close", () => {
        this.connected = false;
        this.socket = null;
        // Reject all pending
        for (const { reject } of this.pending.values()) {
          reject(new Error("MPV socket closed"));
        }
        this.pending.clear();
      });

      // Timeout if MPV not ready
      setTimeout(() => {
        if (!this.connected) reject(new Error("MPV connection timeout"));
      }, 3000);
    });
  }

  private _handleLine(line: string) {
    try {
      const msg = JSON.parse(line);

      // Response to a command
      if (msg.request_id !== undefined && this.pending.has(msg.request_id)) {
        const { resolve, reject } = this.pending.get(msg.request_id)!;
        this.pending.delete(msg.request_id);
        if (msg.error === "success") {
          resolve(msg.data);
        } else {
          reject(new Error(msg.error));
        }
        return;
      }

      // Property change event
      if (msg.event === "property-change") {
        const handler = this.observers.get(msg.name);
        if (handler) handler(msg.data);
      }
    } catch {
      // Ignore parse errors
    }
  }

  private _observeProperties() {
    // Observe time-pos and pause so we always have fresh status
    this._sendRaw({ command: ["observe_property", 1, "time-pos"] });
    this._sendRaw({ command: ["observe_property", 2, "pause"] });
    this._sendRaw({ command: ["observe_property", 3, "filename"] });

    this.observers.set("time-pos", (val) => {
      if (val !== null && val !== undefined) this._status.position = val;
    });
    this.observers.set("pause", (val) => {
      if (val !== null && val !== undefined) this._status.paused = val;
    });
    this.observers.set("filename", (val) => {
      this._status.filename = val ?? null;
    });
  }

  private _sendRaw(obj: object): void {
    if (!this.socket || !this.connected) return;
    try {
      this.socket.write(JSON.stringify(obj) + "\n");
    } catch {
      // Socket may have closed
    }
  }

  private _command(args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pending.set(id, { resolve, reject });
      this._sendRaw({ command: args, request_id: id });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("MPV command timeout"));
        }
      }, 2000);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getStatus(): Promise<PlayerStatus | null> {
    if (!this.connected) return null;
    return { ...this._status };
  }

  async seek(seconds: number): Promise<void> {
    await this._command(["set_property", "time-pos", seconds]);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this._command(["set_property", "pause", paused]);
  }

  disconnect(): void {
    this.connected = false;
    try { this.socket?.destroy(); } catch {}
    this.socket = null;
  }
}

// ─── VLC Controller ───────────────────────────────────────────────────────────
// Communicates via the syncplay.lua TCP interface injected into VLC

export class VlcController implements IPlayerController {
  private socket: net.Socket | null = null;
  private connected = false;
  private buffer = "";
  private _status: PlayerStatus = { position: 0, paused: true, filename: null };
  private pendingLines: Array<(line: string) => void> = [];

  constructor(private port: number) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, "127.0.0.1");

      this.socket.on("connect", () => {
        this.connected = true;
        resolve();
        // Start polling
        this._startPolling();
      });

      this.socket.on("data", (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this._handleLine(trimmed);
        }
      });

      this.socket.on("error", (err) => {
        this.connected = false;
        reject(err);
      });

      this.socket.on("close", () => {
        this.connected = false;
        this.socket = null;
      });

      setTimeout(() => {
        if (!this.connected) reject(new Error("VLC connection timeout"));
      }, 3000);
    });
  }

  private _handleLine(line: string) {
    // Parse syncplay.lua responses
    if (line.startsWith("position: ")) {
      const val = parseFloat(line.replace("position: ", "").replace(",", "."));
      if (!isNaN(val)) this._status.position = val;
    } else if (line.startsWith("playstate: ")) {
      const state = line.replace("playstate: ", "").trim();
      if (state !== "no-input") this._status.paused = state !== "playing";
    } else if (line.startsWith("filename: ")) {
      this._status.filename = line.replace("filename: ", "").trim() || null;
    }

    // Resolve any waiting line callbacks
    if (this.pendingLines.length > 0) {
      const cb = this.pendingLines.shift()!;
      cb(line);
    }
  }

  private _send(cmd: string): void {
    if (!this.socket || !this.connected) return;
    try {
      this.socket.write(cmd + "\n");
    } catch {}
  }

  private _startPolling() {
    const poll = () => {
      if (!this.connected) return;
      this._send(".");
      setTimeout(poll, 1000);
    };
    poll();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getStatus(): Promise<PlayerStatus | null> {
    if (!this.connected) return null;
    return { ...this._status };
  }

  async seek(seconds: number): Promise<void> {
    // syncplay.lua uses "set-position: <seconds>"
    this._send(`set-position: ${seconds}`);
  }

  async setPaused(paused: boolean): Promise<void> {
    this._send(`set-playstate: ${paused ? "paused" : "playing"}`);
  }

  disconnect(): void {
    this.connected = false;
    try { this.socket?.destroy(); } catch {}
    this.socket = null;
  }
}

// ─── Controller manager (singleton per process) ───────────────────────────────

let activeController: IPlayerController | null = null;
let activePlayerType: "mpv" | "vlc" | null = null;
let vlcPort: number | null = null;

export function setActivePlayer(type: "mpv" | "vlc", port?: number) {
  activePlayerType = type;
  if (type === "vlc" && port) vlcPort = port;
  activeController = null; // Will reconnect on next getController call
}

export function clearActivePlayer() {
  activeController?.disconnect();
  activeController = null;
  activePlayerType = null;
  vlcPort = null;
}

export async function getController(): Promise<IPlayerController | null> {
  if (activeController?.isConnected()) return activeController;

  if (!activePlayerType) return null;

  try {
    if (activePlayerType === "mpv") {
      const ctrl = new MpvController(MpvController.getSocketPath());
      await ctrl.connect();
      activeController = ctrl;
      return ctrl;
    }

    if (activePlayerType === "vlc" && vlcPort) {
      const ctrl = new VlcController(vlcPort);
      await ctrl.connect();
      activeController = ctrl;
      return ctrl;
    }
  } catch {
    activeController = null;
  }

  return null;
}

// ─── VLC lua intf setup ───────────────────────────────────────────────────────
// Copies syncplay.lua to VLC's lua intf directory so VLC can load it

export function getVlcIntfPaths(): { intfPath: string; userPath: string } | null {
  const home = os.homedir();
  const plat = process.platform;

  if (plat === "linux") {
    return {
      intfPath: "/usr/lib/vlc/lua/intf/",
      userPath: path.join(home, ".local/share/vlc/lua/intf/"),
    };
  }
  if (plat === "darwin") {
    return {
      intfPath: "/Applications/VLC.app/Contents/MacOS/share/lua/intf/",
      userPath: path.join(home, "Library/Application Support/org.videolan.vlc/lua/intf/"),
    };
  }
  if (plat === "win32") {
    const appdata = process.env.APPDATA || home;
    return {
      intfPath: "",
      userPath: path.join(appdata, "VLC", "lua", "intf"),
    };
  }
  return null;
}

export function installVlcLua(resourcesPath: string, vlcExePath?: string): boolean {
  const src = path.join(resourcesPath, "syncplay.lua");
  if (!fs.existsSync(src)) {
    console.error(`[vlc] syncplay.lua not found at: ${src}`);
    return false;
  }

  // For portable VLC, install next to the executable
  if (vlcExePath && vlcExePath.toLowerCase().includes("portable")) {
    const portableIntf = path.join(path.dirname(vlcExePath), "App", "vlc", "lua", "intf");
    try {
      fs.mkdirSync(portableIntf, { recursive: true });
      fs.copyFileSync(src, path.join(portableIntf, "syncplay.lua"));
      console.log(`[vlc] Installed syncplay.lua to portable path: ${portableIntf}`);
      return true;
    } catch (e) {
      console.error(`[vlc] Failed to install to portable path: ${e}`);
    }
  }

  const paths = getVlcIntfPaths();
  if (!paths) return false;

  try {
    fs.mkdirSync(paths.userPath, { recursive: true });
    fs.copyFileSync(src, path.join(paths.userPath, "syncplay.lua"));
    console.log(`[vlc] Installed syncplay.lua to: ${paths.userPath}`);
    return true;
  } catch (e) {
    console.error(`[vlc] Failed to install syncplay.lua: ${e}`);
    return false;
  }
}
