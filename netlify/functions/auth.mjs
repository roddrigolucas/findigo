import {
  usersStore, hashPassword, verifyPassword, signToken, authed, ensureAdmin, json,
} from "./_lib.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  await ensureAdmin();

  let body = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = body.action;
  const store = usersStore();

  // ── LOGIN ──────────────────────────────────────────────────
  if (action === "login") {
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!username || !password) return json({ error: "credenciais_invalidas" }, 401);

    const user = await store.get(username, { type: "json" });
    // Always run a hash to keep timing similar for unknown users
    if (!user) { await hashPassword(password); return json({ error: "credenciais_invalidas" }, 401); }
    if (user.active === false) return json({ error: "usuario_desativado" }, 403);

    const ok = await verifyPassword(password, user.salt, user.hash);
    if (!ok) return json({ error: "credenciais_invalidas" }, 401);

    const token = await signToken({ sub: username, role: user.role || "user", name: user.name || username });
    await store.setJSON(username, { ...user, lastLogin: new Date().toISOString() });
    return json({ token, user: { username, role: user.role || "user", name: user.name || username } });
  }

  // ── SESSION CHECK ──────────────────────────────────────────
  if (action === "session") {
    const s = await authed(req);
    if (!s) return json({ error: "sessao_expirada" }, 401);
    return json({ user: { username: s.sub, role: s.role, name: s.name }, exp: s.exp });
  }

  // ── CHANGE OWN PASSWORD ────────────────────────────────────
  if (action === "change_password") {
    const s = await authed(req);
    if (!s) return json({ error: "sessao_expirada" }, 401);
    const current = String(body.current || "");
    const next = String(body.next || "");
    if (next.length < 6) return json({ error: "senha_curta" }, 400);
    const user = await store.get(s.sub, { type: "json" });
    if (!user || !(await verifyPassword(current, user.salt, user.hash)))
      return json({ error: "senha_atual_incorreta" }, 401);
    const { salt, hash } = await hashPassword(next);
    await store.setJSON(s.sub, { ...user, salt, hash, passwordChangedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  // ── ADMIN: LIST USERS ──────────────────────────────────────
  if (action === "list_users") {
    const s = await authed(req);
    if (!s) return json({ error: "sessao_expirada" }, 401);
    if (s.role !== "admin") return json({ error: "sem_permissao" }, 403);
    const { blobs } = await store.list();
    const users = [];
    for (const b of blobs) {
      const u = await store.get(b.key, { type: "json" });
      if (u) users.push({ username: u.username, name: u.name, role: u.role, active: u.active !== false, createdAt: u.createdAt, lastLogin: u.lastLogin || null });
    }
    return json({ users });
  }

  // ── ADMIN: CREATE USER ─────────────────────────────────────
  if (action === "create_user") {
    const s = await authed(req);
    if (!s) return json({ error: "sessao_expirada" }, 401);
    if (s.role !== "admin") return json({ error: "sem_permissao" }, 403);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return json({ error: "usuario_invalido" }, 400);
    if (password.length < 6) return json({ error: "senha_curta" }, 400);
    if (await store.get(username, { type: "json" })) return json({ error: "usuario_existe" }, 409);
    const { salt, hash } = await hashPassword(password);
    await store.setJSON(username, {
      username, salt, hash,
      role: body.role === "admin" ? "admin" : "user",
      name: String(body.name || username).slice(0, 60),
      createdAt: new Date().toISOString(), active: true,
    });
    return json({ ok: true });
  }

  // ── ADMIN: TOGGLE / DELETE USER ────────────────────────────
  if (action === "set_active" || action === "delete_user") {
    const s = await authed(req);
    if (!s) return json({ error: "sessao_expirada" }, 401);
    if (s.role !== "admin") return json({ error: "sem_permissao" }, 403);
    const username = String(body.username || "").trim().toLowerCase();
    if (username === s.sub) return json({ error: "nao_pode_alterar_a_si_mesmo" }, 400);
    const user = await store.get(username, { type: "json" });
    if (!user) return json({ error: "nao_encontrado" }, 404);
    if (action === "delete_user") { await store.delete(username); return json({ ok: true }); }
    await store.setJSON(username, { ...user, active: !!body.active });
    return json({ ok: true });
  }

  return json({ error: "acao_desconhecida" }, 400);
};

export const config = { path: "/api/auth" };
