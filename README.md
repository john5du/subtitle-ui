<p align="center">
  <img src="./frontend/public/icon.svg" alt="Subtitle UI icon" width="222" height="222" />
</p>

# subtitle-ui

A Go + Next.js web application for managing subtitle files alongside a Jellyfin-style media library. It is designed around Chinese subtitle workflows: browse movies and TV shows from sidecar NFO metadata, search and download from SubHD in-app (or open Zimuku/SubHD in the browser), upload or replace subtitle files safely, convert SRT to ASS, normalize language labels, and optionally integrate Sonarr (missing episodes) and Jellyfin (library notify + play preview).

中文文档：[`README.zh-CN.md`](./README.zh-CN.md)

## Features

- **Movie and TV libraries** — split browsing for `movies/` and `tv/` roots, with per-series season and episode drilldowns.
- **Card and list views** — toggleable poster grid or compact table, with pagination and year sort.
- **Chinese subtitle workflow** — Chinese UI support plus quick links to common Chinese subtitle search sites.
- **One-click external search** — open Zimuku (`zimuku.org`) or SubHD (`subhd.tv`) in the browser from the selected title.
- **SubHD in-app search/download** — backend provider (on by default): search, download, and install sidecars; TV season packs with prepare/install.
- **Subtitle operations** — upload, replace (backup first), delete, preview stored subtitle content.
- **Manual timing offset** — shift SRT, VTT, ASS, and SSA subtitle timelines in-place with backup.
- **Subtitle language normalize** — plan/apply rename of sidecar language tags (single video or whole TV season).
- **SRT to ASS conversion** — generate ASS while uploading a new SRT, or convert an existing SRT into an additional ASS file.
- **ASS template editing** — edit the global ASS conversion template and default source encoding.
- **Archive uploads** — accepts `.zip`, `.7z`, `.rar`; entries are listed and extracted **server-side** (pure-Go), then you pick which subtitle to install.
- **TV season batch upload** — match one archive against a whole season by episode number.
- **Sonarr (optional)** — TV season completeness vs local files; queue missing EpisodeSearch.
- **Jellyfin (optional)** — notify library after subtitle changes; embedded track list; video play-preview via stream-ticket proxy (progressive or HLS).
- **Posters** — reads `poster.*` / `folder.*` / `fanart.*` / `<base>-poster.*` next to the video (or at series root for TV) in `.jpg` / `.png` / `.bmp`.
- **Dashboard** — scan status, discovered directory summary, recent operation log, provider settings (SubHD / Sonarr / Jellyfin).
- **i18n** — English and 简体中文; preference persisted in `localStorage`.
- **Theme** — light / dark / follow system, persisted in `localStorage`.

## Release process

1. Optional local check before pushing:

```bash
go test ./backend/...
cd frontend
bun run build
```

2. Commit on `main` (Conventional Commit style) and push:

```bash
git push origin main
```

3. Pushing to `main` triggers `.github/workflows/docker-publish.yml`, which runs unit tests (`go test ./backend/...`), resolves the next patch version from the version files, builds and pushes the image, then syncs version files back to `main` and creates tag `vX.Y.Z` on that commit.
4. You can also run the workflow manually with `workflow_dispatch`; the optional version input accepts `0.7.3` or `v0.7.3`, and if omitted the workflow increments the patch version from the version files.
5. Version-sync commits from `github-actions[bot]` (`chore: sync version files…`) do not re-trigger release.
6. Confirm release artifacts:
- GitHub Actions workflow succeeded.
- `ghcr.io/john5du/subtitle-ui` has tags: `vX.Y.Z`, `X.Y.Z`, `latest`, `sha-<short>`.
- Version file sync commit is pushed back to the default branch.

## Backend API

Auth: most `/api/*` routes need `Authorization: Bearer <token>`. **Public without Bearer:**

- `GET /api/health`
- `GET /api/videos/{id}/poster`
- `GET|HEAD /api/videos/{id}/stream?ticket=`
- `GET|HEAD /api/videos/{id}/hls/master?ticket=`
- `GET|HEAD /api/videos/{id}/hls/seg?ticket=&u=`

(`POST .../stream-ticket` still needs Bearer.)

### MCP (AI agents)

Streamable MCP on the same process (default **off**):

- Endpoint: `/mcp` (Bearer `ADMIN_TOKEN` required; 503 when disabled)
- Env bootstrap: `MCP_ENABLED=true`; runtime `GET|PUT /api/config/mcp` `{ enabled, endpoint }` (DB overrides env; Settings UI)
- Tools (in-process `app.Service`): `list_videos`, `get_video`, `list_tv_series`, `version_info`, `scan_status`, `scan_files`, `discover_directories`, `read_subtitle_content`, `delete_subtitle`, `convert_subtitle_to_ass`, `offset_subtitle_timing`, `normalize_plan_video` / `normalize_apply_video`, `normalize_plan_season` / `normalize_apply_season`, `install_subtitle_from_path`, `read_subtitle_cues`, `install_translated_cues` (agent bilingual SRT; timing locked to source), `subhd_search`, `subhd_download`, `subhd_season_packs`, `subhd_season_prepare`, `subhd_season_install`
- Agent translate: `read_subtitle_cues` → `install_translated_cues_preview` → `install_translated_cues` (`label` default `zh&en`)
- Safety: mutate tools need `*_preview` + `confirmToken`; `list_operation_logs` / `rollback_operation` / backup cleanup / log prune tools
- REST rollback: `POST /api/logs/{id}/rollback`
- Connect with URL `http://127.0.0.1:9307/mcp` and `Authorization: Bearer <ADMIN_TOKEN>`

### Core

- `GET /api/health`
- `GET /api/version`
- `POST /api/scan/directories` — discover media subdirectories that contain video/metadata files
- `GET /api/scan/directories` — last discovered directory result
- `POST /api/scan/files` — body: `movieDirs[]`, `tvDirs[]`; empty body scans all
- `GET /api/scan/status`
- `GET /api/logs` — query: optional `page`, `pageSize`
- `DELETE /api/logs`

### Config

- `GET|PUT /api/config/subtitle-conversion` — `{ assTemplate, defaultAssTemplate, sourceEncodingDefault, updatedAt }`
- `GET|PUT /api/config/subhd` — `{ enabled, baseUrl, proxy }`
- `GET|PUT /api/config/sonarr` — `{ enabled, url, apiKey }` (`apiKey` empty on GET + `apiKeySet`; empty PUT keeps stored key)
- `POST /api/config/sonarr/test`
- `GET|PUT /api/config/jellyfin` — `{ enabled, url, apiKey, pathMap }` (same apiKey masking)
- `POST /api/config/jellyfin/test`

### Library

- `GET /api/videos` — query: `mediaType=movie|tv`, optional `q`, `dir`, `page`, `pageSize`, `sortBy`, `sortOrder`
- `GET /api/videos/{videoId}`
- `GET /api/videos/{videoId}/poster`
- `GET /api/tv/series` — optional `q`, `page`, `pageSize`, `sortYear`, `sortOrder`
- `GET /api/tv/series/completeness` — query: `path` or `key`, required `season` (Sonarr)
- `POST /api/tv/series/sonarr/search` — body: `path`/`key`, `season`, optional `episodes[]` or `allMissing`

### Subtitles

- `POST /api/videos/{videoId}/subtitles` — multipart `file`, optional `label`, `replaceId`; optional `convertTo=ass`, `sourceEncoding`
- `GET /api/videos/{videoId}/subtitles/{subtitleId}/content`
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/convert` — body: `targetFormat=ass`, optional `sourceEncoding`
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/timing/offset` — body: `offsetMs`
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `POST /api/videos/{videoId}/subtitles/normalize/plan|apply`
- `POST /api/tv/series/subtitles/normalize/plan|apply` — body scopes series + season
- `GET /api/videos/{videoId}/subtitles/embedded` — Jellyfin embedded tracks (503 if off)

### SubHD

- `GET /api/videos/{videoId}/subtitles/providers/subhd/search?q=&page=`
- `POST /api/videos/{videoId}/subtitles/providers/subhd/download` — JSON `{ sid, label?, replaceId?, archiveEntry? }`
- `GET /api/videos/{videoId}/subtitles/providers/subhd/season-packs`
- `POST /api/subtitles/providers/subhd/season-prepare`
- `POST /api/subtitles/providers/subhd/season-install`

### Archives

- `POST /api/archives/subtitle-entries` — multipart `file` → `{ entries }`
- `POST /api/archives/extract` — multipart `file` + `entry` / `archiveEntry`
- `POST /api/subtitles/batch-from-archive` — multipart `file` + JSON `mappings`

### Stream preview (Jellyfin)

- `POST /api/videos/{videoId}/stream-ticket` → `{ ticket, expiresAt, url, kind }` (`progressive`|`hls`)
- `GET|HEAD /api/videos/{videoId}/stream?ticket=`
- `GET|HEAD /api/videos/{videoId}/hls/master?ticket=`
- `GET|HEAD /api/videos/{videoId}/hls/seg?ticket=&u=`

## Media library layout

Each scanned video needs a parseable sidecar NFO (or, for TV, a series `tvshow.nfo` reachable from the episode directory). Posters are optional. NFO is accepted if it has any of `<title>`, `<originaltitle>`, `<year>`, `<imdb_id>`, or `<tmdbid>` non-empty; empty title falls back to the video filename; **year is not required**.

### Movies

```
media/movies/
  The Midnight Compass (2023)/
    The Midnight Compass.mkv
    The Midnight Compass.nfo   # or movie.nfo
    poster.png                 # optional (poster / movie / folder / <base>-poster / cover)
```

### TV

```
media/tv/
  Chronicle of Lanterns/
    tvshow.nfo                 # optional but recommended (series title / ids; also searched upward)
    poster.png                 # optional (poster / folder / fanart)
    Season 1/
      Chronicle of Lanterns S01E01.mkv
      Chronicle of Lanterns S01E01.nfo   # and/or series tvshow.nfo
```

Video extensions recognized: `.mp4 .mkv .avi .mov .wmv .flv .m4v .mpeg .mpg`.
Subtitle extensions recognized: `.srt .ass .ssa .vtt .sub`.

## Local run (macOS)

Requirements:
- macOS with `bash` and `lsof`
- Local `go` and `bun` (`frontend/package.json` currently pins `bun@1.3.14`)

### One-click startup

```bash
cp scripts/.env.example scripts/.env   # once; fill secrets (gitignored)
./scripts/dev-up.sh
```

- Loads `scripts/.env` then `scripts/.env.local` (shell-exported vars win). See `scripts/.env.example`.
- If `DATABASE_URL` is unset, starts the **dev-only** Compose Postgres (`127.0.0.1:5432`, `postgres:16`, user/password/db `subtitle` / `subtitle` / `subtitle_ui`) and waits until it is healthy.
- Frontend: `http://localhost:3300`
- Backend: `http://localhost:9307`
- Logs: `tmp/frontend.out.log`, `tmp/frontend.err.log`, `tmp/backend.out.log`, `tmp/backend.err.log`

### One-click stop

```bash
./scripts/dev-down.sh
```

- Optional fallback by port (when pid files are missing):

```bash
./scripts/dev-down.sh --kill-by-port
```

### One-click restart

```bash
./scripts/dev-restart.sh
```

- `dev-restart` first runs `dev-down --kill-by-port`, then runs `dev-up`.

### Manual startup

1. Start backend:

```bash
go run ./backend/cmd/server
```

2. Start frontend dev server:

```bash
cd frontend
bun install
bun run dev
```

3. Open browser: `http://localhost:3300`

4. Optional (for local dev against non-default API host):

```bash
export NEXT_PUBLIC_API_BASE=http://localhost:9307
cd frontend
bun run dev
```

Or:

```bash
cd frontend
NEXT_PUBLIC_API_BASE=http://localhost:9307 bun run dev
```

## Frontend build output (for Go static hosting)

```bash
cd frontend
bun run build
```

- Static export output is `./frontend/out`
- Backend default `UI_DIST` is `./frontend/out`

## Container image

Build image locally:

```bash
docker build -t subtitle-ui:local .
```

Run container (PostgreSQL plus required env — the image sets `APP_ENV=production`):

```bash
docker network inspect subtitle-ui >/dev/null 2>&1 || docker network create subtitle-ui

docker run -d --name subtitle-ui-pg --network subtitle-ui \
  -e POSTGRES_USER=subtitle \
  -e POSTGRES_PASSWORD=subtitle \
  -e POSTGRES_DB=subtitle_ui \
  --health-cmd="pg_isready -U subtitle -d subtitle_ui" \
  --health-interval=3s --health-timeout=3s --health-retries=20 \
  postgres:16-alpine

for i in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' subtitle-ui-pg 2>/dev/null || true)"
  case "$status" in
    healthy) break ;;
    unhealthy|exited|dead)
      echo "Postgres failed (status=$status)" >&2
      exit 1
      ;;
  esac
  if [ "$i" -eq 60 ]; then
    echo "Timed out waiting for Postgres to become healthy" >&2
    exit 1
  fi
  sleep 1
done

docker run --rm --network subtitle-ui -p 9307:9307 \
  -e DATABASE_URL='postgres://subtitle:subtitle@subtitle-ui-pg:5432/subtitle_ui?sslmode=disable' \
  -e ADMIN_TOKEN='replace-me' \
  -e STREAM_TICKET_SECRET='replace-me-too' \
  -v /path/to/movies:/data/media/movies \
  -v /path/to/tv:/data/media/tv \
  ghcr.io/john5du/subtitle-ui:latest
```

- App entrypoint serves both API and frontend on `:9307`.
- Required at runtime: `DATABASE_URL` (PostgreSQL), `ADMIN_TOKEN`, and `STREAM_TICKET_SECRET`.
- Default container paths:
  - `MOVIE_MEDIA_ROOT=/data/media/movies`
  - `TV_MEDIA_ROOT=/data/media/tv`
  - `APP_ENV=production`
  - `UI_DIST=/app/frontend/out`
- Media root mounts must be writable because subtitle files are created/replaced in-place.
- Change the example passwords and tokens before any shared deployment.

Recommended: Docker Compose (same Postgres 16 account as local `docker-compose.yml` / `scripts/.env.example`):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: subtitle
      POSTGRES_PASSWORD: subtitle
      POSTGRES_DB: subtitle_ui
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U subtitle -d subtitle_ui"]
      interval: 3s
      timeout: 3s
      retries: 20
    restart: unless-stopped

  subtitle-ui:
    image: ghcr.io/john5du/subtitle-ui:latest
    container_name: subtitle-ui
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "9307:9307"
    environment:
      MOVIE_MEDIA_ROOT: /data/media/movies
      TV_MEDIA_ROOT: /data/media/tv
      APP_ENV: production
      DATABASE_URL: postgres://subtitle:subtitle@postgres:5432/subtitle_ui?sslmode=disable
      ADMIN_TOKEN: replace-me
      STREAM_TICKET_SECRET: replace-me-too
      UI_DIST: /app/frontend/out
    volumes:
      - /path/to/movies:/data/media/movies
      - /path/to/tv:/data/media/tv
    restart: unless-stopped

volumes:
  postgres-data:
```

## GitHub Actions image publish

- Workflow file: `.github/workflows/docker-publish.yml`
- Trigger: push to `main` or manual `workflow_dispatch`
- Pipeline: unit tests (`go test ./backend/...`) → resolve patch version → image build/push → version file sync → tag
- Bot version-sync commits (`chore: sync version files…`) do not re-trigger release
- Registry: `ghcr.io/john5du/subtitle-ui`
- Tags published:
  - semantic tag (`vX.Y.Z`)
  - semantic version tag (`X.Y.Z`)
  - moving tag (`latest`)
  - commit SHA tag (`sha-<short>`)
- The publish workflow writes version files into the build context, builds/pushes the image first, then commits those file changes and tags that commit on the default branch when needed.

## Configuration

Core:

- `SERVER_ADDR` default `:9307`
- `MOVIE_MEDIA_ROOT` default `./media/movies`
- `TV_MEDIA_ROOT` default `./media/tv`
- `MEDIA_ROOT` legacy fallback (if set and `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` not set, both use it)
- `DATABASE_URL` required PostgreSQL DSN
- `UI_DIST` default `./frontend/out`
- `CORS_ALLOWED_ORIGINS` comma-separated allowed origins for mutating cross-origin API requests
- `ADMIN_TOKEN` admin API token (default `change-me` when unset). The insecure default is rejected unless you set a strong secret, or (non-production only) `ALLOW_INSECURE_DEFAULT_ADMIN_TOKEN=true` (`./scripts/dev-up.sh` sets the opt-in when unset). Bearer required on `/api/*` and `/mcp` except public paths listed under Backend API (health, poster, ticket stream/HLS). The UI stores the token in `localStorage`.
- `MCP_ENABLED` default off; set `true` to enable Streamable MCP at `/mcp` on startup (also toggle via Settings / `PUT /api/config/mcp`)
- `TRUST_FORWARDED_HEADERS` set to `1`, `true`, `yes`, or `on` to build absolute poster URLs from `X-Forwarded-Proto` / `X-Forwarded-Host`
- `NEXT_PUBLIC_API_BASE` (frontend dev) — overrides the API host, e.g. `http://localhost:9307`

SubHD (default **on**; runtime `GET/PUT /api/config/subhd` overrides env without restart):

- `SUBHD_ENABLED` — set `false` to disable
- `SUBHD_BASE_URL` default `https://subhd.tv`
- `SUBHD_PROXY` e.g. `socks5://host:port`
- `SUBHD_MIN_INTERVAL` default `3s` (download throttle)
- `SUBHD_SEARCH_MAX_PAGES` default `1`

Sonarr (optional; enabled when URL+key set unless `SONARR_ENABLED=false`):

- `SONARR_URL` e.g. `http://127.0.0.1:8989`
- `SONARR_API_KEY`
- `SONARR_ENABLED`

Jellyfin (optional; subtitle notify + stream preview; enabled when URL+key set unless `JELLYFIN_ENABLED=false`):

- `JELLYFIN_URL` e.g. `http://127.0.0.1:8096`
- `JELLYFIN_API_KEY`
- `JELLYFIN_ENABLED`
- `JELLYFIN_PATH_MAP` `local:jellyfin,...` when bind-mount roots differ
- `JELLYFIN_USER_ID` optional PlaybackInfo user GUID; empty auto-picks an admin
- `STREAM_TICKET_SECRET` required in production; empty in development falls back to `ADMIN_TOKEN`
- `STREAM_TICKET_TTL` default `15m`

See also `scripts/.env.example` and agent-oriented detail in [`AGENTS.md`](./AGENTS.md). Frontend UI conventions: [`docs/frontend-ui.md`](./docs/frontend-ui.md), [`docs/frontend-dialogs.md`](./docs/frontend-dialogs.md).

## Notes

- Upload entry points accept subtitle files and archives (`.zip`, `.7z`, `.rar`); archive listing/extraction is server-side; only subtitle files (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) inside archives are processed.
- SRT to ASS conversion supports `auto`, `utf-8`, `utf-16le`, `utf-16be`, `gb18030`, and `big5` source encodings.
- Scanner: movies use `{base}.nfo` / `movie.nfo`; TV also walks up for `tvshow.nfo`. Videos with no usable NFO are skipped.
- Poster resolution order — movies: `poster`, `movie`, `folder`, `<base>-poster`, `<base>`, `cover`; TV (at series root): `poster`, `folder`, `fanart`.
- Replace and delete operations back up the existing subtitle file before writing.
- This project is not production hardened.
