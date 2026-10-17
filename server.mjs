import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";
import { createAccessCodeRequest, createRedeemRequest } from "./lib/access.mjs";
import { parseWholeDollars } from "./lib/money.mjs";
import { isDirector, normalizeRole, rankForRole } from "./lib/roles.mjs";
import { sendTransactionWebhook } from "./lib/webhook.mjs";
import {
  createAccessCode,
  createBootstrapAdmin,
  createSession,
  deleteSession,
  getSession,
  hasActiveAccessCode,
  listAccessCodes,
  loadAccessList,
  loadLedger,
  recordTransaction,
  redeemAccessCode,
  removeAllAccessForDiscordId,
  revokeAccessCode,
  setBalanceCents,
  setSessionStage,
  setUserHr,
  updateUserRole
} from "./lib/store.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, "public");
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const configuredPort = Number(process.env.PORT || 3000);
const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function setCookie(response, name, value, maxAge) {
  response.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookie}`);
}

function clearCookie(response, name) {
  setCookie(response, name, "", 0);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const requestHost = request.headers["x-forwarded-host"] || request.headers.host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

async function readJson(request, maxBytes = 4096) {
  if (request.body !== undefined) {
    const body = typeof request.body === "string" || Buffer.isBuffer(request.body)
      ? request.body.toString()
      : JSON.stringify(request.body);
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Cererea este prea mare.");
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Datele trimise nu sunt valide.");
    }
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error("Cererea este prea mare.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Datele trimise nu sunt valide.");
  }
}

// 007 + ID-urile din DISCORD_ADMIN_IDS au rang de șef HR (fondator)
function isAdminDiscordId(discordId) {
  return (process.env.DISCORD_ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(discordId);
}

function isHrUser(user) {
  return Boolean(user?.isHr || isAdminDiscordId(user?.discordId));
}

// Rezolvă utilizatorul din sesiune; sesiunea poate fi în etapa "pending"
// (logat cu Discord dar fără cod introdus) sau "authorized".
async function resolveSessionUser(session, request, sessionCookie) {
  if (!session) return undefined;
  const users = await loadAccessList();
  const member = users.find((user) => user.discordId === session.discordId);
  const isAdmin = isAdminDiscordId(session.discordId);

  if (session.stage === "pending") {
    if (member || isAdmin) {
      await setSessionStage(session.tokenHash || sessionCookie, "authorized");
      session.stage = "authorized";
    } else if (await hasActiveAccessCode(session.discordId)) {
      return { stage: "pending", discordId: session.discordId, displayName: session.discordDisplayName };
    } else {
      await deleteSession(sessionCookie);
      return undefined;
    }
  }

  if (!member && !isAdmin) {
    await deleteSession(cookieValue(request, "visterie_session"));
    return undefined;
  }
  const role = member?.role || "membru";
  const isHr = isHrUser({ discordId: session.discordId, isHr: member?.isHr });
  const user = {
    discordId: session.discordId,
    displayName: member?.displayName || session.discordDisplayName,
    callsign: member?.callsign || "M-",
    role,
    isHr,
    isAdmin,
    isDirector: isAdmin || isHr || isDirector(role)
  };
  return { stage: "authorized", user };
}

async function handleApi(request, response, url) {
  const sessionCookie = cookieValue(request, "visterie_session");
  const session = await getSession(sessionCookie);
  const resolved = await resolveSessionUser(session, request, sessionCookie);

  if (url.pathname === "/api/session" && request.method === "GET") {
    return sendJson(response, 200, resolved || { stage: "anonymous" });
  }

  // Etapa 2: persoana logată cu Discord introduce codul primit de la director
  if (url.pathname === "/api/access-code/redeem" && request.method === "POST") {
    if (!resolved || resolved.stage !== "pending") {
      return sendJson(response, 401, { error: "Sesiunea Discord a expirat. Reîncarcă pagina și conectează-te din nou." });
    }
    if (!isSameOrigin(request)) return sendJson(response, 403, { error: "Cererea nu este permisă." });
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
    let payload;
    try {
      payload = createRedeemRequest(body);
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
    const result = await redeemAccessCode({
      code: payload.code,
      discordId: resolved.discordId,
      displayName: resolved.displayName
    });
    if (result.error) return sendJson(response, 400, { error: result.error });
    await setSessionStage(sessionCookie, "authorized");
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/logout") {
    if (!resolved || resolved.stage !== "authorized") {
      return sendJson(response, 401, { error: "Conectează-te cu un cont Discord autorizat." });
    }
    const user = resolved.user;

    if (url.pathname === "/api/ledger" && request.method === "GET") {
      return sendJson(response, 200, await loadLedger());
    }

    if (url.pathname === "/api/transactions" && request.method === "POST") {
      if (!isSameOrigin(request)) return sendJson(response, 403, { error: "Cererea nu este permisă." });
      const body = await readJson(request);
      if (body.type !== "deposit" && body.type !== "withdrawal") {
        return sendJson(response, 400, { error: "Alege adăugare sau retragere." });
      }
      let amountCents;
      try { amountCents = parseWholeDollars(body.amount); }
      catch (error) { return sendJson(response, 400, { error: error.message }); }
      const targetCallsign = typeof body.targetCallsign === "string" ? body.targetCallsign.trim().toUpperCase() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 120) : "";
      if (!/^M-[A-Z0-9-]{1,28}$/.test(targetCallsign)) {
        return sendJson(response, 400, { error: "Callsign invalid. Folosește formatul M-XXX." });
      }
      if (!reason) return sendJson(response, 400, { error: "Introdu motivul tranzacției." });
      const note = `${body.type === "deposit" ? "De la" : "Pentru"} ${targetCallsign} — ${reason}`;
      const result = await recordTransaction({ type: body.type, amountCents, note, user });
      if (result.insufficientBalance) {
        return sendJson(response, 400, { error: "Soldul vistieriei nu este suficient pentru această retragere." });
      }
      // Notificare Discord — nu blochează răspunsul
      sendTransactionWebhook({
        type: body.type,
        amountCents,
        note,
        actor: user.displayName,
        callsign: user.callsign,
        targetCallsign,
        discordId: user.discordId,
        balanceCents: result.ledger.balanceCents
      }).catch(() => { });
      return sendJson(response, 201, result.ledger);
    }

    /* ---------- Rute directori adjunct+ (004,003,002,001 + 007) ---------- */

    if (url.pathname.startsWith("/api/admin/")) {
      if (!user.isDirector) return sendJson(response, 403, { error: "Doar directorii (004+) pot folosi acest panou." });
      if (!isSameOrigin(request) && request.method !== "GET") {
        return sendJson(response, 403, { error: "Cererea nu este permisă." });
      }

      // Panoul de coduri de acces: creează cod pentru un Discord ID
      if (url.pathname === "/api/admin/codes" && request.method === "GET") {
        return sendJson(response, 200, { codes: await listAccessCodes() });
      }
      if (url.pathname === "/api/admin/codes" && request.method === "POST") {
        const body = await readJson(request);
        let requestPayload;
        try {
          requestPayload = createAccessCodeRequest(body);
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
        if (requestPayload.isHr && !user.isHr && !user.isAdmin) {
          return sendJson(response, 403, { error: "Doar un șef HR poate acorda funcția de șef HR." });
        }
        if (rankForRole(requestPayload.role) <= 4 && !user.isHr && !user.isAdmin) {
          return sendJson(response, 403, { error: "Doar șeful HR poate genera coduri pentru roluri de director." });
        }
        if (requestPayload.isHr && !user.isHr && !user.isAdmin) {
          return sendJson(response, 403, { error: "Doar un șef HR poate acorda funcția de șef HR." });
        }
        const code = await createAccessCode({
          discordId: requestPayload.discordId,
          createdBy: user.displayName,
          displayName: requestPayload.displayName,
          callsign: requestPayload.callsign,
          role: requestPayload.role,
          isHr: requestPayload.isHr
        });
        return sendJson(response, 201, code);
      }
      if (url.pathname === "/api/admin/codes/revoke" && request.method === "POST") {
        const body = await readJson(request);
        const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
        const revoked = await revokeAccessCode(code);
        if (!revoked) return sendJson(response, 404, { error: "Codul nu a fost găsit sau a fost deja folosit." });
        return sendJson(response, 200, { ok: true });
      }

      // Whitelist: listare / revocare totală (pe Discord ID)
      if (url.pathname === "/api/admin/access" && request.method === "GET") {
        return sendJson(response, 200, { users: await loadAccessList() });
      }
      if (url.pathname === "/api/admin/access" && request.method === "DELETE") {
        const body = await readJson(request);
        const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
        if (!/^\d{17,20}$/.test(discordId)) {
          return sendJson(response, 400, { error: "ID Discord invalid." });
        }
        if (discordId === user.discordId) {
          return sendJson(response, 400, { error: "Nu-ți poți revoca singur accesul." });
        }
        await removeAllAccessForDiscordId(discordId);
        return sendJson(response, 200, { ok: true });
      }

      // Schimbare rol — doar 007 poate acorda roluri de director (001–004)
      if (url.pathname === "/api/admin/access/role" && request.method === "POST") {
        if (!user.isHr && !user.isAdmin && user.role !== "001") {
          return sendJson(response, 403, { error: "Doar șeful HR sau directorul general poate modifica rolurile." });
        }
        const body = await readJson(request);
        const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
        const role = normalizeRole(body?.role);
        if (!/^\d{17,20}$/.test(discordId)) {
          return sendJson(response, 400, { error: "ID Discord invalid." });
        }
        if (rankForRole(role) <= 4 && !user.isHr && !user.isAdmin) {
          return sendJson(response, 403, { error: "Doar șeful HR poate acorda roluri de director." });
        }
        if (discordId === user.discordId && rankForRole(role) > 4 && !user.isHr && !user.isAdmin) {
          return sendJson(response, 403, { error: "Nu poți elimina propriile tale permisiuni de director." });
        }
        const updated = await updateUserRole(discordId, role);
        if (!updated) return sendJson(response, 404, { error: "Persoana nu există în whitelist." });
        return sendJson(response, 200, { ok: true, role });
      }
      if (url.pathname === "/api/admin/access/hr" && request.method === "POST") {
        if (!user.isHr && !user.isAdmin) return sendJson(response, 403, { error: "Doar șeful HR poate modifica această opțiune." });
        const body = await readJson(request);
        const discordId = typeof body?.discordId === "string" ? body.discordId.trim() : "";
        const enabled = body?.enabled === true;
        if (!/^\\d{17,20}$/.test(discordId)) return sendJson(response, 400, { error: "ID Discord invalid." });
        const updated = await setUserHr(discordId, enabled);
        if (!updated) return sendJson(response, 404, { error: "Persoana nu există în whitelist." });
        return sendJson(response, 200, { ok: true, isHr: enabled });
      }

      // Sold editabil manual — pentru ajustarea sumei înainte de lansare
      if (url.pathname === "/api/admin/balance" && request.method === "POST") {
        const body = await readJson(request);
        let cents;
        try { cents = parseWholeDollars(body.amount); }
        catch (error) { return sendJson(response, 400, { error: error.message }); }
        await setBalanceCents(cents);
        const ledger = await loadLedger();
        return sendJson(response, 200, { ok: true, ledger });
      }

      // Bilanț — doar directori adjunct+ și 007
      if (url.pathname === "/api/admin/bilant" && request.method === "GET") {
        const ledger = await loadLedger();
        return sendJson(response, 200, {
          totalDepositsCents: ledger.totalDepositsCents,
          totalWithdrawalsCents: ledger.totalWithdrawalsCents,
          balanceCents: ledger.balanceCents,
          profitCents: ledger.totalDepositsCents - ledger.totalWithdrawalsCents,
          transactionCount: ledger.transactions.length
        });
      }

      return sendJson(response, 404, { error: "Ruta API nu există." });
    }
    return sendJson(response, 404, { error: "Ruta API nu există." });
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    if (!isSameOrigin(request)) return sendJson(response, 403, { error: "Cererea nu este permisă." });
    await deleteSession(sessionCookie);
    clearCookie(response, "visterie_session");
    return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 404, { error: "Ruta API nu există." });
}

async function handleOAuth(request, response, url) {
  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } = process.env;
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    return sendJson(response, 503, { error: "Autentificarea Discord nu este configurată. Completează variabilele DISCORD_* din fișierul .env." });
  }
  if (url.pathname === "/auth/discord" && request.method === "GET") {
    const state = randomBytes(32).toString("hex");
    setCookie(response, "visterie_oauth_state", state, 600);
    const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
    authorizeUrl.search = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: "code",
      scope: "identify",
      state
    }).toString();
    response.writeHead(302, { Location: authorizeUrl.toString(), "Cache-Control": "no-store" });
    return response.end();
  }
  if (url.pathname === "/auth/discord/callback" && request.method === "GET") {
    const state = url.searchParams.get("state") || "";
    const stateCookie = cookieValue(request, "visterie_oauth_state");
    const expected = Buffer.from(stateCookie);
    const actual = Buffer.from(state);
    const matchingState = expected.length === actual.length && timingSafeEqual(expected, actual);
    clearCookie(response, "visterie_oauth_state");
    if (!matchingState) {
      response.writeHead(302, { Location: "/?error=oauth", "Cache-Control": "no-store" });
      return response.end();
    }
    if (url.searchParams.has("error") || !url.searchParams.has("code")) {
      response.writeHead(302, { Location: "/?error=oauth", "Cache-Control": "no-store" });
      return response.end();
    }
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: url.searchParams.get("code"),
        redirect_uri: DISCORD_REDIRECT_URI
      })
    });
    if (!tokenResponse.ok) throw new Error("Discord nu a putut valida autentificarea.");
    const token = await tokenResponse.json();
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    if (!userResponse.ok) throw new Error("Nu s-au putut prelua datele contului Discord.");
    const discordUser = await userResponse.json();
    if (!/^\d{17,20}$/.test(discordUser.id)) throw new Error("Discord a returnat un ID de utilizator invalid.");

    // Dacă e deja pe whitelist (adăugat de un director), intră direct.
    // Altfel sesiunea pornește în etapa "pending": trebuie să introducă codul.
    const allowedUsers = await loadAccessList();
    let whitelisted = allowedUsers.some((entry) => entry.discordId === discordUser.id)
      || isAdminDiscordId(discordUser.id);
    if (!whitelisted && allowedUsers.length === 0) {
      whitelisted = await createBootstrapAdmin(discordUser.id, discordUser.global_name || discordUser.username);
    }
    const displayName = discordUser.global_name || discordUser.username;
    const sessionId = randomBytes(32).toString("hex");
    await createSession(sessionId, discordUser.id, displayName, whitelisted ? "authorized" : "pending");
    setCookie(response, "visterie_session", sessionId, sessionLifetimeMs / 1000);
    response.writeHead(302, { Location: whitelisted ? "/" : "/?pending=1", "Cache-Control": "no-store" });
    return response.end();
  }
  return sendJson(response, 404, { error: "Ruta de autentificare nu există." });
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(publicRoot, requested);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    response.writeHead(403);
    return response.end("Acces interzis.");
  }
  if (!existsSync(filePath)) {
    response.writeHead(404);
    return response.end("Pagina nu a fost găsită.");
  }
  const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(await readFile(filePath));
}

export async function handler(request, response) {
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/auth/")) {
      url.pathname = url.pathname.slice("/api".length);
    }
    if (process.env.VERCEL && !process.env.DATABASE_URL
      && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))) {
      return sendJson(response, 503, {
        error: "Baza de date Supabase nu este configurată. Adaugă DATABASE_URL în Environment Variables pe Vercel și redeployează."
      });
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);
    if (url.pathname.startsWith("/auth/")) return await handleOAuth(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      return response.end("Metodă neacceptată.");
    }
    return await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "A apărut o eroare internă. Verifică jurnalul serverului." });
    } else {
      response.destroy(error);
    }
  }
}

export default handler;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
    console.warn("Configurează variabilele DISCORD_* pentru a activa autentificarea Discord.");
  }
  createServer(handler).listen(configuredPort, () => {
    console.log(`Vistieria rulează la http://localhost:${configuredPort}`);
  });
}
