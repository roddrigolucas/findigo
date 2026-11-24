import { authed, json } from "./_lib.mjs";
import { readCupom } from "./_nfce.mjs";

// POST /api/nfce { code } → dados do cupom fiscal lido pela câmera
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const s = await authed(req);
  if (!s) return json({ error: "sessao_expirada" }, 401);
  let body = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const code = String(body.code || "").slice(0, 1500);
  if (!code) return json({ error: "codigo_vazio" }, 400);
  const r = await readCupom(code);
  return json(r, r.error ? 422 : 200);
};

export const config = { path: "/api/nfce" };
