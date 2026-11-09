// Shared helpers: crypto, sessions, blob store access.
import { getStore } from "@netlify/blobs";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SECRET = () =>
  process.env.SESSION_SECRET || "dev-insecure-secret-change-me";

// ── base64url ────────────────────────────────────────────────
export const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64uDecode = (s) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// ── password hashing (PBKDF2-SHA256, 150k iterations) ────────
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? b64uDecode(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256
  );
  return { salt: b64u(salt), hash: b64u(bits) };
}

export async function verifyPassword(password, saltB64, hashB64) {
  const { hash } = await hashPassword(password, saltB64);
  // constant-time-ish compare
  if (hash.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

// ── session tokens (HMAC-SHA256 signed JSON) ─────────────────
async function hmacKey() {
  return crypto.subtle.importKey("raw", enc.encode(SECRET()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(payload, ttlSeconds = 60 * 60 * 12) {
  const body = { ...payload, iat: Date.now(), exp: Date.now() + ttlSeconds * 1000 };
  const data = b64u(enc.encode(JSON.stringify(body)));
  const sig = b64u(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(data)));
  return `${data}.${sig}`;
}

export async function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64uDecode(sig), enc.encode(data));
    if (!ok) return null;
    const body = JSON.parse(dec.decode(b64uDecode(data)));
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch { return null; }
}

// ── stores ───────────────────────────────────────────────────
export const usersStore = () => getStore({ name: "users", consistency: "strong" });
export const dataStore  = () => getStore({ name: "userdata", consistency: "strong" });

// ── bootstrap admin from env ─────────────────────────────────
export async function ensureAdmin() {
  const store = usersStore();
  const username = (process.env.ADMIN_USER || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!username || !password) return;
  const existing = await store.get(username, { type: "json" });
  if (existing) return;
  const { salt, hash } = await hashPassword(password);
  await store.setJSON(username, {
    username, salt, hash, role: "admin", name: "Administrador",
    createdAt: new Date().toISOString(), active: true,
  });
}

// ── request helpers ──────────────────────────────────────────
export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export async function authed(req) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  return verifyToken(token);
}

// ── 2-year retention ─────────────────────────────────────────
export function pruneToTwoYears(transactions) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const iso = cutoff.toISOString().slice(0, 10);
  return transactions.filter((t) => typeof t.date === "string" && t.date >= iso);
}
