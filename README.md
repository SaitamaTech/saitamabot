# SAITAMA BOT

SAITAMA BOT is a React/Vite dashboard and Node/Express WhatsApp automation service by SAITAMA TECH. It includes authenticated accounts, private real-time pairing-code delivery, encrypted Baileys session storage, PostgreSQL migrations, a searchable command catalogue, and working handlers for a clearly identified subset of commands.

> **This is an unofficial WhatsApp Web integration.** It may be affected by WhatsApp restrictions. Link only an account you own, use it responsibly, and keep a recoverable backup of your account. A pairing code is a login credential: never share it.

## What is implemented

The backend supports registration/login, HTTP-only signed cookies, private Socket.IO rooms, per-account encrypted WhatsApp auth files (AES-256-GCM), pair/disconnect/reconnect flows, session status, usage metrics, PostgreSQL persistence, and owner-email-gated metrics/account listing. The owner identity is reserved during public registration and must be provisioned from the server CLI.

Users can sign in with Google through Supabase Auth or use the existing email/password flow. Configure the Google provider in Supabase, then set `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the backend. The frontend fetches these public project settings at runtime from `/api/integrations`, so they do not need to be embedded in the frontend build. Only an anon JWT or `sb_publishable_` key is exposed; service-role/secret keys are rejected. In Supabase, set the Site URL to the deployed app origin and allow that origin and `http://localhost:5173` as redirect URLs. In Google Cloud Console, authorize the Supabase callback URL shown in the Supabase Google provider settings (`https://<project-ref>.supabase.co/auth/v1/callback`). The backend verifies each Supabase access token and requires a confirmed email before issuing its own HTTP-only session cookie.

Commands with real handlers include core status commands; `.ai`/`.gpt` using an OpenAI-compatible provider; six URL-shortener aliases using the configured shortener endpoint; TMDB search/details; coin, dice, number-guessing, rock-paper-scissors and safe arithmetic; the listed Unicode text-styling commands; time, weather, password generation, QR-code images; and selected group metadata, messaging, and moderation actions. Group changes check caller and bot admin rights where required.

The full requested inventory is searchable in **Command library**. Entries are labeled `ACTIVE`, `NEEDS SETUP`, or `NOT BUILT`, based on real handlers and the provider keys currently configured on the server. The remainder of the extensive download, compiler, anti-abuse, automation, owner, sports, media, GFX, and other moderation set is **not implemented** and is never presented as working.

Command replies include a clickable official WhatsApp Channel URL when `WHATSAPP_CHANNEL_URL` is configured. The supplied brief did not contain that URL; until the operator configures the real official link, replies explicitly say the channel link is unavailable rather than inventing one. Interactive native WhatsApp buttons are not used; WhatsApp-rendered URL text is the supported fallback.

## Requirements

- Node.js 20 or later
- PostgreSQL 14 or later (PostgreSQL 15+ recommended)
- A persistent private disk/volume for encrypted WhatsApp session files
- HTTPS in production (required for secure browser cookies)
- A WhatsApp account and phone for manual end-to-end pairing tests

## Local installation

1. Create a PostgreSQL database and user. For example, on a local PostgreSQL installation:

   ```sql
   CREATE USER saitama WITH PASSWORD 'choose-a-long-local-password';
   CREATE DATABASE saitama_bot OWNER saitama;
   ```

   Alternatively, with Docker installed, run `docker compose up -d db`; its local default password matches the example `DATABASE_URL` (`saitama`). If you change the Compose password, update `DATABASE_URL` to match.

2. Create your local environment file and generate independent secrets:

   ```bash
   cp .env.example .env
   openssl rand -hex 32   # use a new result for JWT_SECRET
   openssl rand -hex 32   # use a different result for SESSION_ENCRYPTION_KEY
   ```

   Set `DATABASE_URL`, `JWT_SECRET`, `SESSION_ENCRYPTION_KEY`, `WEB_ORIGIN`, and a verified `OWNER_EMAIL` in `.env`. For Google sign-in, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to your Supabase project URL and public anon/publishable key. Set `PGSSL=true` when your managed PostgreSQL/Supabase connection requires TLS. Set `OWNER_NUMBER`, `WHATSAPP_CHANNEL_URL`, and provider keys only to real values. `WHATSAPP_CHANNEL_URL` must be HTTPS.

3. Install and initialize the database:

   ```bash
   npm install
   npm --workspace backend run owner:create -- owner@example.com "Saitama Tech"
   ```

   Enter the owner password at the hidden terminal prompt. The command applies migrations and creates the reserved owner account. Public registration cannot claim `OWNER_EMAIL`.

4. Start the frontend and API in development:

   ```bash
   npm run dev
   ```

   Open `http://localhost:5173`. New regular accounts may sign up in the app. Database migrations run automatically when the API starts.

5. To build the frontend and run the API as one service:

   ```bash
   npm run build
   npm start
   ```

   The API serves `frontend/dist` when it exists.

## WhatsApp pairing

Set a **random 32-byte** `SESSION_ENCRYPTION_KEY` as 64 hexadecimal characters. The pairing page remains disabled if it is missing or malformed. Sign in, open **WhatsApp session**, enter the number with its country calling code, request a code, then use WhatsApp → **Linked Devices** → **Link a Device** → **Link with phone number instead**. Pairing codes are sent only through the authenticated account's Socket.IO room and are never logged.

After successful linking, status is stored in PostgreSQL. The Baileys credentials/key store is encrypted on disk under `SESSION_DIR` (default `backend/data/sessions`) with restrictive permissions and atomic replacement. Reconnection after restart requires the same session volume and encryption key. **Back up the encrypted session volume and the key separately.** If you lose or rotate the key without re-encrypting the session, those sessions cannot be restored; disconnect/re-pair them. The UI's disconnect action logs out and deletes the encrypted session file.

Pairing was not run as part of this build: it requires an operator-supplied WhatsApp account, a live database, correct deployment secrets, and a manual confirmation on the user's phone.

## Optional providers

- `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` / `OPENAI_MODEL`: `.ai` and `.gpt`.
- `TMDB_API_KEY`: `.tmdb`, `.moviesearch`, `.moviesearch2`, `.moviedetail`.
- `WEATHER_API_KEY`: `.weather`.
- `SHORTENER_API_URL`: `.short*` handlers. The service requires an HTTPS endpoint.
- Other provider keys in `.env.example` are reserved and do not imply that those command families are implemented.

## Tests and verification

```bash
npm test
npm run build
```

The automated tests cover catalogue completeness/status labels, safe arithmetic, URL SSRF rejection, session encryption/tamper detection, and text conversions. Live pairing, provider-backed commands, and group mutations need a configured database/provider and a real test account/group; they are not simulated as successful in CI.

## Deployment

### Railway

Deploy from the repository using the included `Dockerfile`. Attach a PostgreSQL service and a persistent volume mounted at `/app/backend/data/sessions` (or set `SESSION_DIR` to the mounted path). Configure every required variable from `.env.example`, set `NODE_ENV=production`, `WEB_ORIGIN` to the public HTTPS app origin, and configure `OWNER_EMAIL`. Provision the owner with `npm --workspace backend run owner:create -- ...` from a one-off shell/release step after the database is available. Keep the same `SESSION_ENCRYPTION_KEY` across restarts and deployments.

### Render

Use a Node web service with build command `npm install && npm run build` and start command `npm start`, plus a PostgreSQL database. Attach a persistent disk at `/var/data` and set `SESSION_DIR=/var/data/sessions`. Set `DATABASE_URL`, long random secrets, `NODE_ENV=production`, the exact public `WEB_ORIGIN`, `TRUST_PROXY=1` when directly behind the platform's single trusted proxy, and provider/channel values. For Google sign-in, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Render. Render's ephemeral filesystem is **not** suitable for WhatsApp session storage. Provision the owner through a one-off shell after the database is ready.

### VPS

Install Node.js and PostgreSQL, provision the DB and owner account, build with `npm run build`, and run `npm start` under a process supervisor (systemd/PM2). Put a reverse proxy with TLS in front, set `WEB_ORIGIN` to the public origin, and mount/backup `SESSION_DIR` on a private persistent disk. Restrict access to the session directory and `.env` to the service user.

## Security notes

- Browser sessions use HTTP-only, SameSite=Lax cookies; no WhatsApp credential reaches the frontend.
- Socket.IO verifies the same account cookie and only joins that account's private room.
- API pairing is authenticated, rate-limited, number-validated, and scoped to the signed-in user.
- Auth state uses AES-256-GCM. Never commit `.env`, session files, or keys. Do not log pairing codes or WhatsApp auth state.
- The configured owner email is blocked from public signup; use the local owner provisioning command.
- Group commands check group context and role requirements. No user-supplied code is executed by the server.
- Baileys is pinned to patched v6 release 6.7.22 for [GHSA-qvv5-jq5g-4cgg](https://github.com/advisories/GHSA-qvv5-jq5g-4cgg); history sync is disabled and `messages.upsert` events carrying a `requestId` are discarded as additional defense in depth.
- Keep dependencies and deployment images updated; the unofficial WhatsApp library and protocol can change without notice.

## Project layout

```text
backend/
  migrations/001_init.sql
  src/auth.js
  src/commands/       catalogue, handlers, Unicode transforms
  src/routes/api.js
  src/whatsapp/manager.js
frontend/
  src/App.jsx
  src/styles.css
  vite.config.js
```
