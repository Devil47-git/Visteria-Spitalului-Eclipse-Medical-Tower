import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
let sqlClient;
let schemaReady;

function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Configurează DATABASE_URL cu connection string-ul Supabase (Transaction pooler).");
  }
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10
    });
  }
  return sqlClient;
}

async function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS visterie_state (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
        initialized BOOLEAN NOT NULL DEFAULT FALSE
      )`;
      await sql`ALTER TABLE visterie_state ADD COLUMN IF NOT EXISTS initialized BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`CREATE TABLE IF NOT EXISTS visterie_transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
        amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
        balance_cents BIGINT NOT NULL CHECK (balance_cents >= 0),
        note TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL,
        callsign TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS visterie_transactions_created_at_idx
        ON visterie_transactions (created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS visterie_users (
        discord_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        callsign TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'membru',
        is_hr BOOLEAN NOT NULL DEFAULT FALSE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`ALTER TABLE visterie_users ADD COLUMN IF NOT EXISTS is_hr BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`UPDATE visterie_users SET callsign = CONCAT('M-', callsign)
        WHERE callsign ~ '^[0-9]{1,3}$'`;
      await sql`CREATE TABLE IF NOT EXISTS visterie_codes (
        code TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT TRUE
      )`;
      await sql`ALTER TABLE visterie_codes ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE visterie_codes ADD COLUMN IF NOT EXISTS callsign TEXT NOT NULL DEFAULT 'M-'`;
      await sql`ALTER TABLE visterie_codes ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'membru'`;
      await sql`ALTER TABLE visterie_codes ADD COLUMN IF NOT EXISTS is_hr BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`CREATE TABLE IF NOT EXISTS visterie_sessions (
        token_hash TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS visterie_sessions_expires_at_idx
        ON visterie_sessions (expires_at)`;
      await sql`INSERT INTO visterie_state (singleton, balance_cents, initialized)
        VALUES (TRUE, 0, FALSE) ON CONFLICT (singleton) DO NOTHING`;
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

function sessionHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

/* ---------- Whitelist (visterie_users) ---------- */

export async function createBootstrapAdmin(discordId, displayName) {
  const sql = db();
  await ensureSchema(sql);
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74201931)`;
    const [state] = await tx`SELECT initialized FROM visterie_state WHERE singleton = TRUE FOR UPDATE`;
    if (state.initialized) return false;
    await tx`INSERT INTO visterie_users (discord_id, display_name, callsign, role, is_hr)
      VALUES (${discordId}, ${displayName}, 'M-001', 'membru', TRUE)
      ON CONFLICT (discord_id) DO NOTHING`;
    await tx`UPDATE visterie_state SET initialized = TRUE WHERE singleton = TRUE`;
    return true;
  });
}

export async function loadAccessList() {
  const sql = db();
  await ensureSchema(sql);
  return await sql`SELECT discord_id AS "discordId", display_name AS "displayName",
      callsign, role, is_hr AS "isHr"
    FROM visterie_users ORDER BY added_at DESC`;
}

export async function updateUserRole(discordId, role) {
  const sql = db();
  await ensureSchema(sql);
  const updated = await sql`UPDATE visterie_users SET role = ${role}
    WHERE discord_id = ${discordId} RETURNING discord_id`;
  return updated.length > 0;
}

export async function setUserHr(discordId, enabled) {
  const sql = db();
  await ensureSchema(sql);
  const updated = await sql`UPDATE visterie_users SET is_hr = ${enabled}
    WHERE discord_id = ${discordId} RETURNING discord_id`;
  return updated.length > 0;
}

/* ---------- Coduri de acces ---------- */

export function generateAccessCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 },
    () => alphabet[randomBytes(1)[0] % alphabet.length]).join("");
  return `VIST-${part()}-${part()}`;
}

export async function createAccessCode({ discordId, createdBy, displayName, callsign, role, isHr = false }) {
  const sql = db();
  await ensureSchema(sql);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateAccessCode();
    try {
      const [row] = await sql`INSERT INTO visterie_codes
          (code, discord_id, created_by, display_name, callsign, role, is_hr)
        VALUES (${code}, ${discordId}, ${createdBy}, ${displayName}, ${callsign}, ${role}, ${isHr})
        RETURNING code, discord_id AS "discordId", created_at AS "createdAt",
          used_at AS "usedAt", active`;
      return { ...row, createdAt: new Date(row.createdAt).toISOString(), usedAt: null };
    } catch (error) {
      if (error.code !== "23505") throw error;
    }
  }
  throw new Error("Nu s-a putut genera un cod unic. Încearcă din nou.");
}

export async function hasActiveAccessCode(discordId) {
  const sql = db();
  await ensureSchema(sql);
  const matches = await sql`SELECT 1 FROM visterie_codes
    WHERE discord_id = ${discordId} AND active = TRUE AND used_at IS NULL LIMIT 1`;
  return matches.length > 0;
}

export async function listAccessCodes() {
  const sql = db();
  await ensureSchema(sql);
  const rows = await sql`SELECT code, discord_id AS "discordId", created_by AS "createdBy",
      created_at AS "createdAt", used_at AS "usedAt", active
    FROM visterie_codes ORDER BY created_at DESC LIMIT 200`;
  return rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    usedAt: row.usedAt ? new Date(row.usedAt).toISOString() : null
  }));
}

export async function redeemAccessCode({ code, discordId, displayName }) {
  const sql = db();
  await ensureSchema(sql);
  const normalized = String(code || "").trim().toUpperCase();
  const [entry] = await sql`SELECT code, discord_id AS "discordId", display_name AS "displayName",
      callsign, role, is_hr AS "isHr", used_at AS "usedAt", active
    FROM visterie_codes WHERE code = ${normalized}`;
  if (!entry) return { error: "Codul nu există. Verifică codul primit de la directori." };
  if (!entry.active) return { error: "Acest cod a fost dezactivat de un director." };
    if (entry.usedAt) return { error: "Acest cod a fost deja folosit." };
  if (entry.discordId !== discordId) {
    return { error: "Codul nu este emis pentru contul tău Discord." };
  }
  const claimed = await sql.begin(async (tx) => {
    const result = await tx`UPDATE visterie_codes SET used_at = NOW()
      WHERE code = ${normalized} AND discord_id = ${discordId} AND active = TRUE AND used_at IS NULL
      RETURNING display_name AS "displayName", callsign, role, is_hr AS "isHr"`;
    if (result.length === 0) return false;
    const profile = result[0];
    const [existingUser] = await tx`SELECT callsign, role, is_hr AS "isHr" FROM visterie_users
      WHERE discord_id = ${discordId}`;
    const callsign = profile.callsign && profile.callsign !== "M-" ? profile.callsign : existingUser?.callsign || "M-";
    const role = profile.role && profile.role !== "membru" ? profile.role : existingUser?.role || profile.role || "membru";
    const isHr = profile.isHr || existingUser?.isHr || false;
    await tx`INSERT INTO visterie_users (discord_id, display_name, callsign, role, is_hr)
      VALUES (${discordId}, ${profile.displayName || displayName}, ${callsign}, ${role}, ${isHr})
      ON CONFLICT (discord_id) DO UPDATE SET display_name = EXCLUDED.display_name,
        callsign = EXCLUDED.callsign, role = EXCLUDED.role, is_hr = EXCLUDED.is_hr`;
    return true;
  });
  return claimed ? { ok: true } : { error: "Codul a fost deja folosit sau dezactivat." };
}

export async function revokeAccessCode(code) {
  const sql = db();
  await ensureSchema(sql);
  const normalized = String(code || "").trim().toUpperCase();
  const updated = await sql`UPDATE visterie_codes SET active = FALSE
    WHERE code = ${normalized} AND used_at IS NULL RETURNING code`;
  return updated.length > 0;
}

export async function removeAllAccessForDiscordId(discordId) {
  const sql = db();
  await ensureSchema(sql);
  await sql`DELETE FROM visterie_users WHERE discord_id = ${discordId}`;
  await sql`UPDATE visterie_codes SET active = FALSE WHERE discord_id = ${discordId} AND used_at IS NULL`;
  await sql`DELETE FROM visterie_sessions WHERE discord_id = ${discordId}`;
}

/* ---------- Ledger ---------- */

export async function loadLedger() {
  const sql = db();
  await ensureSchema(sql);
  const [state] = await sql`SELECT balance_cents AS "balanceCents"
    FROM visterie_state WHERE singleton = TRUE`;
  const transactions = await sql`SELECT id, type, amount_cents AS "amountCents",
      balance_cents AS "balanceCents", note, actor, callsign, discord_id AS "discordId",
      created_at AS "createdAt"
    FROM visterie_transactions ORDER BY created_at DESC, id DESC LIMIT 500`;
  const [totals] = await sql`SELECT
      COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount_cents ELSE 0 END), 0) AS "totalDeposits",
      COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount_cents ELSE 0 END), 0) AS "totalWithdrawals",
      COUNT(*) AS "count"
    FROM visterie_transactions`;
  return {
    balanceCents: Number(state.balanceCents),
    totalDepositsCents: Number(totals.totalDeposits),
    totalWithdrawalsCents: Number(totals.totalWithdrawals),
    transactions: transactions.map((transaction) => ({
      ...transaction,
      amountCents: Number(transaction.amountCents),
      balanceCents: Number(transaction.balanceCents),
      createdAt: new Date(transaction.createdAt).toISOString()
    }))
  };
}

export async function recordTransaction({ type, amountCents, note, user }) {
  const sql = db();
  await ensureSchema(sql);
  const delta = type === "deposit" ? amountCents : -amountCents;
  const id = randomBytes(12).toString("hex");
  const [updated] = await sql`
    WITH balance AS (
      UPDATE visterie_state
      SET balance_cents = balance_cents + ${delta}, initialized = TRUE
      WHERE singleton = TRUE AND balance_cents + ${delta} >= 0
      RETURNING balance_cents
    ), inserted AS (
      INSERT INTO visterie_transactions
        (id, type, amount_cents, balance_cents, note, actor, callsign, discord_id)
      SELECT ${id}, ${type}, ${amountCents}, balance.balance_cents, ${note},
        ${user.displayName}, ${user.callsign}, ${user.discordId}
      FROM balance
      RETURNING id
    )
    SELECT balance_cents AS "balanceCents" FROM balance`;
  if (!updated) return { insufficientBalance: true };
  return { ledger: await loadLedger() };
}

export async function setBalanceCents(balanceCents) {
  const sql = db();
  await ensureSchema(sql);
  await sql`UPDATE visterie_state SET balance_cents = ${balanceCents}, initialized = TRUE
    WHERE singleton = TRUE`;
}

/* ---------- Sesiuni ---------- */

export async function createSession(token, discordId, displayName, stage = "authorized") {
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  const sql = db();
  await ensureSchema(sql);
  await sql`INSERT INTO visterie_sessions (token_hash, discord_id, display_name, stage, expires_at)
    VALUES (${sessionHash(token)}, ${discordId}, ${displayName}, ${stage}, ${expiresAt.toISOString()})
    ON CONFLICT (token_hash) DO UPDATE SET discord_id = EXCLUDED.discord_id,
      display_name = EXCLUDED.display_name, stage = EXCLUDED.stage,
      expires_at = EXCLUDED.expires_at`;
}

export async function getSession(token) {
  if (!token) return undefined;
  const sql = db();
  await ensureSchema(sql);
  const [session] = await sql`UPDATE visterie_sessions
    SET expires_at = NOW() + INTERVAL '7 days'
    WHERE token_hash = ${sessionHash(token)} AND expires_at > NOW()
    RETURNING token_hash AS "tokenHash", discord_id AS "discordId",
      display_name AS "discordDisplayName", stage`;
  return session ? { ...session } : undefined;
}

export async function setSessionStage(token, stage) {
  const sql = db();
  await ensureSchema(sql);
  await sql`UPDATE visterie_sessions SET stage = ${stage}
    WHERE token_hash = ${sessionHash(token)}`;
}

export async function deleteSession(token) {
  if (!token) return;
  const sql = db();
  await ensureSchema(sql);
  await sql`DELETE FROM visterie_sessions WHERE token_hash = ${sessionHash(token)}`;
}
