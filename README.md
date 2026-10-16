# Visteria Spital — Eclipse Medical Tower

Aplicație web privată pentru evidența sumelor depuse și retrase din visteria spitalului.
Autentificare prin Discord OAuth. Datele sunt stocate în **Supabase (Postgres)**.

## Funcționare pe scurt

- **Coduri de acces**: directorii (004, 003, 002, 001) și șeful HR (007) generează din panou
  un cod pentru un Discord ID. Persoana se conectează cu Discord, bagă codul, primește
  whitelist și rămâne logată până când accesul îi e revoat (pe Discord ID sau cod).
- **Bilanț** (total băgat, total scos, profit): vizibil doar pentru directori+ (004 și peste).
- **Soldul** se poate ajusta manual din panoul de directori, înainte de lansare.
- **Webhook Discord**: fiecare tranzacție trimite un embed verde/roșu într-un canal.

## Configurare

### 1. Baza de date — Supabase

1. Creează un cont pe [supabase.com](https://supabase.com) → **New project**
   (nume: `visteria-eclipse`, regiune: **Frankfurt / eu-central**).
2. Copiază connection string-ul: Settings → Database → **Connection pooling → Transaction**
   (port `6543`). E forma `postgresql://postgres.abc:[PAROLA]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`.

### 2. Discord Developer Portal

1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
2. OAuth2 → Redirects: adaugă exact `https://[DOMENIUL-TĂU]/auth/discord/callback`.
3. Copiază **Client ID** și **Client Secret**.

### 3. Vercel

Importă repo-ul, apoi Settings → Environment Variables:

| Variabilă | De unde | Exemplu |
|---|---|---|
| `DATABASE_URL` | Supabase (connection pooling, pas 1) | `postgresql://postgres...:6543/postgres` |
| `DISCORD_CLIENT_ID` | Discord Developer Portal | `1234567890123456789` |
| `DISCORD_CLIENT_SECRET` | Discord Developer Portal | (secret) |
| `DISCORD_REDIRECT_URI` | Îl scrii tu | `https://domeniul.vercel.app/auth/discord/callback` |
| `DISCORD_ADMIN_IDS` | ID-ul tău Discord (și alți șefi, separate prin `,`) — au rang 007 automat | `111111111111111111` |
| `DISCORD_WEBHOOK_URL` | Serverul Discord → canal → Edit → Integrations → Webhooks → Copy URL | `https://discord.com/api/webhooks/...` |

## Pornire locală

Ai nevoie de Node.js 20.6+. Copiază `.env.example` în `.env`, completează valorile, apoi:

```bash
npm install
npm start        # http://localhost:3000
npm test
```

Schema bazei de date se creează automat la primul request — nu rulezi nimic manual în Supabase.
