# Auth port from packages/web/packages/api — review notes

Ported web's DDD/CQRS/DI auth module into `packages/api/src/{domain,repositories,services,application,presentation}` unchanged in logic. Everything below needs your review/action before this is live.

## New dependencies (added, not yet reviewed by you)
- `packages/api`: `jsonwebtoken`, `google-auth-library` (+ `@types/jsonwebtoken` dev)
- `packages/shared`: `zod` (v4.3.6, matching the version `packages/web` uses)

Run `pnpm install` at repo root to fetch these.

## Env vars now required (ambient — no `.env` loading added, per your call)
- `JWT_SECRET` — signs access tokens
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `GOOGLE_REDIRECT_URI` — defaults to `"postmessage"` if unset
- `TOKEN_ENCRYPTION_KEY` — exactly 32 chars, encrypts stored Google tokens at rest. **Module throws at import time if missing/wrong length** — same as web's original, so the process won't boot without it once anything imports `EncryptionService`.
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` — reused from the existing `licenses/db.ts` naming (root convention), not web's `DB_*` names. Default database name is `co_gm_vtt` (root's existing default), not web's `babyface`.

Checked locally: MariaDB is running on `127.0.0.1:3306`, but the default `root`/no-password combo (what `licenses/db.ts` and the new `Database.ts` both fall back to) is rejected — real credentials need to be set in the environment for either module to connect.

## Schema
`packages/api/database/Schema.sql` — new file, `users` / `user_auth_providers` / `refresh_tokens` tables + a `cleanup_expired_tokens()` procedure, ported unchanged from web's schema (camelCase columns, matches the repositories' raw SQL exactly). **Not run automatically** — run it yourself against the same DB `MYSQL_DATABASE` points at.

## Deliberately out of scope
- **Existing routes are not protected.** `authMiddleware` is exported and ready but not wired onto any of the 13 existing routers (campaigns, maps, etc.) — per your instruction, that's a separate task.
- **User CRUD (commands/queries/routes) was not ported.** `GoogleSigninCommandHandler` only needs `userRepository.create`/`findByEmail` internally, so only the `User` entity + repository came over — not web's `CreateUserCommand`/`MutateUserCommand`/`FindUserQuery`/`ListUsersQuery`/`UserRoutes`/`UserController`. Not part of "authentication" as scoped.
- **`UserRepository.test.ts` was not ported** — root api has no test runner configured (web uses vitest). Flag if you want vitest added.
- **Full-api DDD/CQRS refactor.** You said this should be the pattern for the whole api "no exceptions" — this task only introduced it for the new auth module. The other 13 routers, socket handlers, and game logic remain in their existing style. Treat as a separate, larger follow-up task.

## New routes (mounted at `/api`, matching web's paths exactly)
- `POST /api/auth/google/signin`
- `POST /api/auth/refresh`
- `GET /api/auth/me` (protected)
- `GET /api/auth/sessions` (protected)
- `POST /api/auth/sessions/:sessionId/revoke` (protected)
