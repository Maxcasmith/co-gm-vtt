# DB Migration Rules

MySQL. Migrations split into `up/` and `down/`.

- `up/` — dir for change we want to make
- `down/` — dir for revert of same change

## Filename

Each migration = one pair, same timestamp, same descriptive name, in both dirs.

`up/<timestamp>_<description>.sql`
`down/<timestamp>_<description>.sql`

Timestamp format: `YYYYMMDDHHMMSS` (UTC, generate at creation time — never reuse or backdate).

Example:

```
up/20260910143000_create_users_table.sql
down/20260910143000_create_users_table.sql
```

## Rules

- Every `up` file needs matching `down` file, same timestamp + description.
- `down` must fully revert `up` — no partial revert.
- One logical change per migration pair (one table, one column, one index — not a batch of unrelated changes).
- Every table's `id` column is a UUID (`CHAR(36)`), never an auto-increment int or a natural/slug key.
- Never edit an already-committed migration file. New change = new pair, new timestamp.
- Migrations run in timestamp order.

## Migrations table

A `migrations` table tracks which migrations are active (`name`, `run_at`). It is bootstrapped automatically by the runner — never create it via an up/down pair.

- Running an `up` file adds its row to `migrations`.
- Running a `down` file removes that row.

## Running

- `pnpm migrate` — runs every `up` migration not yet in `migrations`, in timestamp order.
- `pnpm migrate:down` — reverts the single most recently applied migration.
- `pnpm migrate:rollback` — reverts every migration from the most recent `pnpm migrate` run (all migrations that were applied together share one `run_at`).
- `pnpm migrate:fresh` — drops every table in the database, then runs all `up` migrations from scratch. Destructive, local/dev use only.

Runner lives at `packages/api/src/db/migrate.ts`, reads `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` env vars.

## Seeds

`seed/` — dir for sample/reference data, separate from migrations (migrations own schema + fixed lookup rows like `products`; seeds own everything else — demo users, sample content).

- `seed/<timestamp>_<description>.sql`, same timestamp convention as migrations.
- No tracking table — `pnpm seed` runs every file in `seed/` in filename order, every time it's invoked. Write seed SQL idempotently (`INSERT IGNORE`, `ON DUPLICATE KEY UPDATE`, etc.) since a file may run more than once.
- `pnpm seed` — runs all seed files. Runner lives at `packages/api/src/db/seed.ts`.
