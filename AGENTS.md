# AGENTS.md

Go API + Next.js static UI for subtitle management against a Jellyfin-style media library (`movies/` + `tv/` + sidecar NFO). Production: one Go binary serves API and `frontend/out` on `:9307`.

## Commands

```bash
# Dev (macOS; needs go, bun, node, lsof, curl)
cp scripts/.env.example scripts/.env   # once; fill secrets (gitignored)
./scripts/dev-up.sh          # FE :3300, BE :9307; loads scripts/.env; logs/pids in tmp/
./scripts/dev-down.sh        # optional: --kill-by-port
./scripts/dev-restart.sh     # down --kill-by-port then up (reloads .env / CORS)

# Manual
go run ./backend/cmd/server
cd frontend && bun install && bun run dev

# Verify (CI runs only the first)
go test ./...
go test ./backend/internal/store -run TestName
cd frontend && bun run lint
cd frontend && bun run build   # static export → frontend/out
```

- Package manager is **bun@1.3.14** (`frontend/package.json` `packageManager`). Use `bun`, not npm/yarn.
- Postgres store tests skip unless `TEST_POSTGRES_DSN` is set (creates a per-test schema, then drops it). Release CI sets `TEST_POSTGRES_DSN` against a Postgres 16 service so dialect paths run on `main`.
- Local env: `dev-up` / `dev-restart` load `scripts/.env` then `scripts/.env.local` via `scripts/lib/load-env.sh` (shell-exported vars win). Real `scripts/.env` is gitignored; commit only `scripts/.env.example`.
- Local FE→BE mutating requests need CORS. `dev-up` sets `CORS_ALLOWED_ORIGINS` for `localhost:3300` / `127.0.0.1:3300` when unset. Reuse of an already-running backend does **not** refresh env — use `dev-restart`.
- Optional FE API override: `NEXT_PUBLIC_API_BASE=http://localhost:9307`.
- Video stream preview (ArtPlayer + optional hls.js; requires Jellyfin enabled):
  - UI play-preview button only when Jellyfin is enabled (no local ffmpeg; audio via Jellyfin when needed)
  - `POST /api/videos/{id}/stream-ticket` (Bearer) → `{ ticket, expiresAt, url, kind }` (`kind`: `progressive`|`hls`; 503 if Jellyfin off / item not found)
  - Issue path: `FindItemIDByPath` (Path-only, paginated) → Jellyfin `POST /Items/{id}/PlaybackInfo` with AAC-preferring DeviceProfile → ticket **v2** embeds mode + upstream path
  - `kind=progressive`: `GET /api/videos/{id}/stream?ticket=` proxies JF static/direct stream (Range)
  - `kind=hls`: `GET /api/videos/{id}/hls/master?ticket=` + `/hls/seg?ticket=&u=` proxies JF HLS and rewrites m3u8 (API key never exposed to browser)
  - Forces browser-friendly audio when needed (e.g. EAC3→AAC on Jellyfin); video may stay copy
  - Upstream media statuses 2xx / 404 / 416 passed through on progressive/segments; no playback progress reporting
  - `STREAM_TICKET_SECRET` (optional; else AdminToken), `STREAM_TICKET_TTL` (default 15m)
- SubHD auto-download (backend, default **on**):
  - Env bootstrap: `SUBHD_ENABLED=false` to disable; `SUBHD_BASE_URL`; `SUBHD_PROXY=socks5://host:port`
  - Runtime config (DB overrides env, no restart): `GET/PUT /api/config/subhd` `{ enabled, baseUrl, proxy }`
  - Settings UI on dashboard config page
  - `SUBHD_MIN_INTERVAL=3s` (download API throttle)
  - `SUBHD_SEARCH_MAX_PAGES=1`
  - `GET /api/videos/{id}/subtitles/providers/subhd/search?q=&page=`
  - `POST /api/videos/{id}/subtitles/providers/subhd/download` JSON `{ "sid", "label?", "replaceId?", "archiveEntry?" }`
  - Installs sidecar next to video (`source=download`). Archives: zip/7z/rar (pure-Go). Rate-limit / captcha handled server-side.
- Sonarr TV completeness (optional):
  - Env bootstrap: `SONARR_URL` (e.g. `http://127.0.0.1:8989`), `SONARR_API_KEY`, optional `SONARR_ENABLED=false`
  - Runtime config (DB overrides env, no restart): `GET/PUT /api/config/sonarr` `{ enabled, url, apiKey }`
  - Settings UI on dashboard config page
  - Enabled when URL+key set (unless explicitly disabled)
  - `GET /api/tv/series/completeness?path=&key=&season=` — local vs Sonarr missing episodes (monitored + aired only)
  - `POST /api/tv/series/sonarr/search` JSON `{ path|key, season, episodes?, allMissing? }` — queues Sonarr `EpisodeSearch`
  - Match order: series path → `series_tmdb_id` → `series_imdb_id`
  - Present set is local scan (not Sonarr `hasFile`). UI: TV season/episode panel only.
- Jellyfin (optional; subtitle notify + video play-preview stream proxy):
  - Env bootstrap: `JELLYFIN_URL` (e.g. `http://127.0.0.1:8096`), `JELLYFIN_API_KEY`, optional `JELLYFIN_ENABLED=false`, `JELLYFIN_PATH_MAP=local:jellyfin,...`, optional `JELLYFIN_USER_ID` (PlaybackInfo user; empty auto-picks admin via `GET /Users`)
  - Runtime config (DB overrides env, no restart): `GET/PUT /api/config/jellyfin` `{ enabled, url, apiKey, pathMap }`
  - Settings UI on dashboard config page
  - Enabled when URL+key set (unless explicitly disabled)
  - After subtitle upload/replace/delete/convert/offset/normalize (and SubHD install via those paths): async `POST /Library/Media/Updated` with mapped video path; on failure fallback `Items/{id}/Refresh?metadataRefreshMode=ValidationOnly`
  - Path map required when subtitle-ui and Jellyfin see different bind-mount roots; failures only log (`jellyfin_notify` op), never fail the subtitle write
  - Video preview: backend proxies static stream only (see stream-ticket above); no Sessions/Playing progress
  - Embedded subtitle languages (read-only): `GET /api/videos/{id}/subtitles/embedded` → `{ tracks: [{ index, language, title, displayTitle, codec, isForced, isDefault, isText }] }` via JF `PlaybackInfo` MediaStreams (`IsExternal=false`); 503 if Jellyfin off

## Layout

| Path | Role |
|------|------|
| `backend/cmd/server` | Process entry |
| `backend/internal/api` | HTTP routes/handlers |
| `backend/internal/app` | Service / use-cases (scan, upload, convert, offset, logs, SubHD) |
| `backend/internal/store` | SQLite + Postgres, migrations, SQLite→PG one-shot import |
| `backend/internal/scanner` | Disk scan (video + NFO + posters + subtitles) |
| `backend/internal/subtitle` | Paths, ASS conversion, timing offset |
| `backend/internal/provider/subhd` | SubHD search/download client (on by default) |
| `backend/internal/provider/sonarr` | Optional Sonarr client (series match, episode list, EpisodeSearch) |
| `backend/internal/provider/jellyfin` | Optional Jellyfin client (media updated + item refresh after subtitle changes) |
| `backend/internal/config` | Env config |
| `backend/internal/version` | `const Value` — release source of truth (with FE package version) |
| `frontend/src/app` | Next App Router shell |
| `frontend/src/hooks/use-subtitle-manager` | Client state + controllers |
| `frontend/src/lib` | API client, i18n, archive helpers |
| `frontend/src/components/subtitle-manager` | UI panels/dialogs |
| `scripts/dev-*.sh` | Local process orchestration |
| `media/` | Local media roots (gitignored); defaults `./media/movies`, `./media/tv` |
| `tmp/` | Local DB default, logs, pids (gitignored) |

`frontend/next.config.mjs`: `output: "export"` (no Next server in prod). Go default `UI_DIST=./frontend/out`.

## Config gotchas

- DB: SQLite default `DB_PATH=./tmp/subtitle_manager.sqlite3`. Set `DATABASE_URL` for Postgres; first connect can import SQLite from `DB_PATH` once (backs up SQLite first; refuses non-empty PG without import marker).
- `ADMIN_TOKEN`: admin API token (default `change-me` when unset). All `/api/*` except `GET /api/health` and `GET /api/videos/{id}/poster` need `Authorization: Bearer <token>` (posters stay public so `<img>` works). Startup logs the default value and warns to set `ADMIN_TOKEN`. FE login page stores token in `localStorage` (`subtitle-ui:admin-token`).
- Media roots must be **writable** (subtitle write/replace/backup in place).
- Videos without sidecar NFO (`<title>`/`<year>`) are skipped by the scanner.
- Subtitle replace/delete/offset backup existing files before mutating.

## Release / version

- Push to `main` triggers `.github/workflows/docker-publish.yml`: `go test ./...` → resolve patch bump → build/push `ghcr.io/john5du/subtitle-ui` → commit version sync → tag.
- Keep **in sync**: `backend/internal/version/version.go` (`const Value`) and `frontend/package.json` `version`. Mismatch fails the release job.
- Bot commits `chore: sync version files…` do not re-release.
- Prefer Conventional Commits. Do not push casual WIP to `main`.

## Agent notes

- Frontend unit tests: `cd frontend && bun test` (Bun test runner). Prefer pure-function tests.
- Prefer focused `go test` packages under `backend/internal/...` while iterating.
- After FE changes that ship in the container, `bun run build` must succeed (static export).
- Do not commit secrets, `tmp/`, `media/`, or `frontend/out`.
- Frontend UI conventions: `docs/frontend-ui.md` (control density, library list shell, drawer sizes, empty/settings rows) and `docs/frontend-dialogs.md` (modal `sm|md|lg`, drawer `md|lg|xl`, `DialogTitleWithHelp` / `DialogHelpTip`).
- Language label contract: shared fixtures in `testdata/language/*.json` — update both Go (`backend/internal/subtitle/language_contract_test.go`) and FE (`frontend/src/lib/language-contract.test.ts`) when changing detection/normalization rules.
