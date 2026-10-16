import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";

const sessionLifetimeMs = 7 * 24 * 60 * 1000;
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
        balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0)
      )`;
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
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS visterie_codes (
        code TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT TRUE
      )`;
      await sql`CREATE INDEX IF NOT EXISTS visterie_codes_discord_idx
        ON visterie_codes (discord_id)`;
      await sql`CREATE TABLE IF NOT EXISTS visterie_sessions (
        token_hash TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS visterie_sessions_expires_at_idx
        ON visterie_sessions (expires_at)`;
      await sql`INSERT INTO visterie_state (singleton, balance_cents)
        VALUES (TRUE, 0) ON CONFLICT (singleton) DO NOTHING`;
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

export async function loadAccessList() {
  const sql = db();
  await ensureSchema(sql);
  return await sql`SELECT discord_id AS "discordId", display_name AS "displayName",
      callsign, role
    FROM visterie_users ORDER BY added_at DESC`;
}

export async function addAccessEntry(member) {
  const sql = db();
  await ensureSchema(sql);
  const inserted = await sql`INSERT INTO visterie_users (discord_id, display_name, callsign, role)
    VALUES (${member.discordId}, ${member.displayName}, ${member.callsign}, ${member.role || "membru"})
    ON CONFLICT (discord_id) DO NOTHING RETURNING discord_id`;
  return inserted.length > 0;
}

export async function removeAccessEntry(discordId) {
  const sql = db();
  await ensureSchema(sql);
  const removed = await sql`DELETE FROM visterie_users WHERE discord_id = ${discordId}
    RETURNING discord_id`;
  return removed.length > 0;
}

export async function updateUserRole(discordId, role) {
  const sql = db();
  await ensureSchema(sql);
  const updated = await sql`UPDATE visterie_users SET role = ${role}
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

export async function createAccessCode({ discordId, createdBy }) {
  const sql = db();
  await ensureSchema(sql);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateAccessCode();
    const existing = await sql`SELECT 1 FROM visterie_codes WHERE code = ${code}`;
    if (existing.length > 0) continue;
    const [row] = await sql`INSERT INTO visterie_codes (code, discord_id, created_by)
      VALUES (${code}, ${discordId}, ${createdBy})
      RETURNING code, discord_id AS "discordId", created_at AS "createdAt",
        used_at AS "usedAt", active`;
    return { ...row, createdAt: new Date(row.createdAt).toISOString(), usedAt: null };
  }
  throw new Error("Nu s-a putut genera un cod unic. Încearcă din nou.");
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
  const [entry] = await sql`SELECT code, discord_id AS "discordId", used_at AS "usedAt", active
    FROM visterie_codes WHERE code = ${normalized}`;
  if (!entry) return { error: "Codul nu există. Verifică codul primit de la directori." };
  if (!entry.active) return { error: "Acest cod a fost dezactivat de un director." };
  if (entry.usedAt) return { error: "Acest cod a fost deja folosit." };
  if (entry.discordId !== discordId) {
    return { error: "Codul nu este emis pentru contul tău Discord." };
  }
  const alreadyMember = await sql`SELECT 1 FROM visterie_users WHERE discord_id = ${discordId}`;
  if (alreadyMember.length === 0) {
    await sql`INSERT INTO visterie_users (discord_id, display_name, callsign, role)
      VALUES (${discordId}, ${displayName}, ${"—"}, 'membru')
      ON CONFLICT (discord_id) DO NOTHING`;
  }
  await sql`UPDATE visterie_codes SET used_at = NOW() WHERE code = ${normalized}`;
  return { ok: true };
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
      SET balance_cents = balance_cents + ${delta}
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
  await sql`UPDATE visterie_state SET balance_cents = ${balanceCents}
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
    RETURNING discord_id AS "discordId", display_name AS "discordDisplayName", stage`;
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
