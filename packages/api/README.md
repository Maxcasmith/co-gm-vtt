# Environment Variables

Copy `env-example` to `.env` and fill in real values. Grouped below by what each var actually does — verified against the current code, not just the example file.

## Server

| Var | Used? | What it does |
|---|---|---|
| `PORT` | **Not read.** | Server port is hardcoded to `3001` in `src/index.ts`. Changing this env var does nothing right now. |
| `NODE_ENV` | **Not read.** | No code in this package checks it. |
| `FRONTEND_URL` | **Not read.** | CORS is wide open (`cors()` with no options in `src/state.ts`, and Socket.IO's `origin: '*'`) — this var isn't wired to either. |

## Auth

| Var | What it does |
|---|---|
| `JWT_SECRET` | Signs access tokens. |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Google OAuth tokens at rest. **Must be exactly 32 characters** — a module throws at import time if it's missing or the wrong length, so the process won't boot without it. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth app credentials. |
| `GOOGLE_REDIRECT_URI` | Defaults to `"postmessage"` if unset (the value the Google Identity SDK expects for a popup flow). |
| `ADMIN_PASSWORD` | Fallback password for the `/admin` panel — only used if no admin password has been set yet in-app (Settings). Defaults to `"admin"` if this is also unset. Once a real password is saved in Settings, this env var is ignored. |

## Database

| Var | What it does |
|---|---|
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Connection for the relational data: users, auth, licenses/products, and (if `STORAGE_*_BACKEND=rds`) the storage abstraction's `storage_objects` table. Defaults: `localhost:3306`, `root`/no password, database `co_gm_vtt`. |

Migrations live in `db/up` / `db/down` at the repo root — run with `pnpm migrate` (see root `package.json`), not automatically on boot.

## Deploy target

| Var | What it does |
|---|---|
| `DEPLOY_TARGET` | `saas` → `/api/config` reports `platform: 'web'`; anything else (including unset) → `platform: 'desktop'`. This is how the client tells whether it's running as the hosted web app or the Electron build. |

## Storage backend

Two independent stores — one for text/JSON content (campaigns, characters, notes, quests), one for binary media (portraits, tilesets, maps). Each picks its backend separately, so e.g. a self-hosted desktop build can keep both `local` while a SaaS deploy runs media on `s3` and text on `rds`.

| Var | What it does |
|---|---|
| `STORAGE_TEXT_BACKEND` | `local` (default), `s3`, or `rds`. Backs every JSON/markdown read-write in `storage.ts`, `compendium/storage.ts`, `adventures/storage.ts`. |
| `STORAGE_MEDIA_BACKEND` | Same three options, for binary content (images, maps). |

**If either is `local`:** no other vars needed — reads/writes the same on-disk `packages/api/storage/` directory the app has always used.

**If either is `s3`:**

| Var | What it does |
|---|---|
| `AWS_REGION` | AWS SDK region for the S3 client. Uses the SDK default if unset. |
| `S3_TEXT_BUCKET` | Bucket for `STORAGE_TEXT_BACKEND=s3`. Throws at request time if that backend is selected and this is unset. |
| `S3_MEDIA_BUCKET` | Bucket for `STORAGE_MEDIA_BACKEND=s3`. Same throw-if-missing behavior. |

Uses the AWS SDK's default credential chain (env vars, shared config file, instance role, etc.) — no explicit access-key env vars here.

**If either is `rds`:** no separate vars — reuses the `MYSQL_*` connection above, storing objects in a `storage_objects` key-value table (migration: `db/up/20260910170000_create_storage_objects_table.sql`).
