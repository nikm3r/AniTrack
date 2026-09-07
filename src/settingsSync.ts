// ─── Settings Cloud Sync ──────────────────────────────────────────────────────
// Encrypts settings with AES-256-GCM using a key derived from the tracker token.
// The hub only ever sees an opaque encrypted blob — never plaintext settings.

const HUB_URL = "https://anitrack-hub.onrender.com";

// Settings keys that are machine-specific and should NOT be synced
const EXCLUDE_KEYS = new Set([
  "base_folder",
  "torrent_client_path",
  "player_executable_path",
  "player_executable",
]);

async function deriveKey(token: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(token), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("anitrack-settings-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(key: CryptoKey, payload: object): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload))
  );
  return {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
  };
}

async function decrypt(key: CryptoKey, iv: string, data: string): Promise<any> {
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const dataBytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, dataBytes);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    throw new Error("Decryption failed — make sure you're logged in with the same account.");
  }
}

async function hubPush(username: string, slot: string, payload: { iv: string; data: string }): Promise<void> {
  const res = await fetch(`${HUB_URL}/settings/${encodeURIComponent(username)}-${slot}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Push failed: ${res.status}`);
}

async function hubPull(username: string, slot: string): Promise<{ iv: string; data: string }> {
  const res = await fetch(`${HUB_URL}/settings/${encodeURIComponent(username)}-${slot}`);
  if (res.status === 404) throw new Error("No cloud settings found for this account.");
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  return res.json();
}

function collectLocalStorageFilters(): Record<string, any> {
  const filters: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("filters_t_")) {
      try { filters[k] = JSON.parse(localStorage.getItem(k) || "{}"); } catch {}
    }
  }
  return filters;
}

async function fetchSeriesSettings(): Promise<any[]> {
  const res = await fetch("http://localhost:3000/api/anime?limit=9999");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || [])
    .filter((a: any) => a.alt_title || a.download_path || a.notes)
    .map((a: any) => ({
      anilist_id: a.anilist_id ?? null,
      mal_id: a.mal_id ?? null,
      title_romaji: a.title_romaji,
      alt_title: a.alt_title ?? null,
      download_path: a.download_path ?? null,
      notes: a.notes ?? null,
    }));
}

async function applySeriesSettings(entries: any[]): Promise<void> {
  // Get all anime from local DB to match by tracker ID or title
  const res = await fetch("http://localhost:3000/api/anime?limit=9999");
  if (!res.ok) return;
  const data = await res.json();
  const localAnime: any[] = data.data || [];

  for (const entry of entries) {
    // Match by anilist_id, mal_id, or title_romaji fallback
    const match = localAnime.find(a =>
      (entry.anilist_id && a.anilist_id === entry.anilist_id) ||
      (entry.mal_id && a.mal_id === entry.mal_id) ||
      a.title_romaji === entry.title_romaji
    );
    if (!match) continue;

    const updates: any = {};
    if (entry.alt_title !== undefined) updates.alt_title = entry.alt_title;
    if (entry.download_path !== undefined) updates.download_path = entry.download_path;
    if (entry.notes !== undefined) updates.notes = entry.notes;
    if (Object.keys(updates).length === 0) continue;

    await fetch(`http://localhost:3000/api/anime/${match.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  }
}

function applyLocalStorageFilters(filters: Record<string, any>): void {
  for (const [k, v] of Object.entries(filters)) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function pushSettings(
  settings: Record<string, string>,
  token: string,
  username: string
): Promise<void> {
  const key = await deriveKey(token);

  // Push app settings
  const appPayload = Object.fromEntries(
    Object.entries(settings).filter(([k]) => !EXCLUDE_KEYS.has(k))
  );
  await hubPush(username, "app", await encrypt(key, appPayload));

  // Push series settings (DB fields + localStorage filters)
  const seriesFromDb = await fetchSeriesSettings();
  const filtersFromStorage = collectLocalStorageFilters();
  await hubPush(username, "series", await encrypt(key, { db: seriesFromDb, filters: filtersFromStorage }));
}

export async function pullSettings(
  token: string,
  username: string
): Promise<Record<string, string>> {
  const key = await deriveKey(token);

  // Pull and apply series settings first
  try {
    const seriesBlob = await hubPull(username, "series");
    const { db, filters } = await decrypt(key, seriesBlob.iv, seriesBlob.data);
    if (Array.isArray(db)) await applySeriesSettings(db);
    if (filters) applyLocalStorageFilters(filters);
  } catch (e) {
    // Series settings missing is non-fatal (first push might have been app-only)
    console.warn("[settingsSync] No series settings found:", e);
  }

  // Pull app settings
  const appBlob = await hubPull(username, "app");
  return decrypt(key, appBlob.iv, appBlob.data);
}
