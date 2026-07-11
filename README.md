<p align="center">
  <img src="./frontend/public/icon.svg" alt="Subtitle UI icon" width="222" height="222" />
</p>

# subtitle-ui

A Go + Next.js web application for managing subtitle files alongside a Jellyfin-style media library. It is designed around Chinese subtitle workflows: browse movies and TV shows from sidecar NFO metadata, jump directly to Zimuku/SubHD subtitle searches, upload or replace subtitle files safely, convert SRT subtitles to ASS, and edit the global ASS template used for conversions.

中文文档：[`README.zh-CN.md`](./README.zh-CN.md)

## Features

- **Movie and TV libraries** — split browsing for `movies/` and `tv/` roots, with per-series season and episode drilldowns.
- **Card and list views** — toggleable poster grid or compact table, with pagination and year sort.
- **Chinese subtitle workflow** — Chinese UI support plus quick links to common Chinese subtitle search sites.
- **One-click subtitle search** — open Zimuku (`zimuku.org`) or SubHD (`subhd.tv`) searches from the selected title.
- **Subtitle operations** — upload, replace (backup first), delete, preview stored subtitle content.
- **Manual timing offset** — shift SRT, VTT, ASS, and SSA subtitle timelines in-place with backup.
- **SRT to ASS conversion** — generate ASS while uploading a new SRT, or convert an existing SRT into an additional ASS file.
- **ASS template editing** — edit the global ASS conversion template and default source encoding.
- **Archive uploads** — accepts `.zip`, `.7z`, `.rar` payloads; entries are parsed client-side and you pick which subtitle inside to install.
- **TV season batch upload** — match one archive against a whole season by episode number.
- **Posters** — reads `poster.*` / `folder.*` / `fanart.*` / `<base>-poster.*` next to the video (or at series root for TV) in `.jpg` / `.png` / `.bmp`.
- **Dashboard** — scan status, discovered directory summary, and recent operation log.
- **i18n** — English and 简体中文; preference persisted in `localStorage`.
- **Theme** — light / dark / follow system, persisted in `localStorage`.

## Release process

1. Optional local check before pushing:

```bash
go test ./...
cd frontend
bun run build
```

2. Commit on `main` (Conventional Commit style) and push:

```bash
git push origin main
```

3. Pushing to `main` triggers `.github/workflows/docker-publish.yml`, which runs unit tests (`go test ./...`), resolves the next patch version from the version files, builds and pushes the image, then syncs version files back to `main` and creates tag `vX.Y.Z` on that commit.
4. You can also run the workflow manually with `workflow_dispatch`; the optional version input accepts `0.7.3` or `v0.7.3`, and if omitted the workflow increments the patch version from the version files.
5. Version-sync commits from `github-actions[bot]` (`chore: sync version files…`) do not re-trigger release.
6. Confirm release artifacts:
- GitHub Actions workflow succeeded.
- `ghcr.io/john5du/subtitle-ui` has tags: `vX.Y.Z`, `X.Y.Z`, `latest`, `sha-<short>`.
- Version file sync commit is pushed back to the default branch.

## Backend API

- `GET /api/health`
- `GET /api/version`
- `POST /api/scan` (compat: direct file scan)
- `POST /api/scan/directories` (discover media subdirectories that contain video/metadata files)
- `GET /api/scan/directories` (get last discovered directory result)
- `POST /api/scan/files` (scan files from selected directories, body: `movieDirs[]`, `tvDirs[]`)
- `GET /api/scan/status`
- `GET /api/config/subtitle-conversion`
  - response: `{ assTemplate, defaultAssTemplate, sourceEncodingDefault, updatedAt }`
- `PUT /api/config/subtitle-conversion` (body: `assTemplate`, `sourceEncodingDefault`)
- `GET /api/videos` (query: `mediaType=movie|tv`, optional `q`, `dir`, `page`, `pageSize`, `sortBy`, `sortOrder`)
  - response: `{ items: Video[], total, page, pageSize, totalPages }`
- `GET /api/tv/series` (query: optional `q`, `page`, `pageSize`, `sortYear`, `sortOrder`)
  - response: `{ items: TVSeriesSummary[], total, page, pageSize, totalPages }`
- `GET /api/videos/{videoId}`
- `GET /api/videos/{videoId}/poster` (serves poster image resolved under the video's media root)
- `POST /api/videos/{videoId}/subtitles` (multipart `file`, optional `label`, optional `replaceId`; optional `convertTo=ass`, `sourceEncoding` for new SRT uploads)
- `GET /api/videos/{videoId}/subtitles/{subtitleId}/content` (subtitle bytes for preview)
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/convert` (body: `targetFormat=ass`, optional `sourceEncoding`)
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/timing/offset` (body: `offsetMs`; supports SRT/VTT/ASS/SSA)
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs` (query: optional `page`, `pageSize`)
  - response: `{ items: OperationLog[], total, page, pageSize, totalPages }`
- `DELETE /api/logs` (clears all operation logs)

## Media library layout

Each scanned video needs a sidecar NFO with `<title>` / `<year>`. Posters are optional.

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
    poster.png                 # optional (poster / folder / fanart)
    Season 1/
      Chronicle of Lanterns S01E01.mkv
      Chronicle of Lanterns S01E01.nfo
```

Video extensions recognized: `.mp4 .mkv .avi .mov .wmv .flv .m4v .mpeg .mpg`.
Subtitle extensions recognized: `.srt .ass .ssa .vtt .sub`.

## Local run (macOS)

Requirements:
- macOS with `bash` and `lsof`
- Local `go` and `bun` (`frontend/package.json` currently pins `bun@1.3.14`)

### One-click startup

```bash
./scripts/dev-up.sh
```

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

Run container (example with bind mounts):

```bash
docker run --rm -p 9307:9307 \
  -v /path/to/movies:/data/media/movies \
  -v /path/to/tv:/data/media/tv \
  -v /path/to/data:/data \
  ghcr.io/john5du/subtitle-ui:latest
```

- App entrypoint serves both API and frontend on `:9307`.
- Default container paths:
  - `MOVIE_MEDIA_ROOT=/data/media/movies`
  - `TV_MEDIA_ROOT=/data/media/tv`
  - `DB_PATH=/data/subtitle_manager.sqlite3`
  - `DATABASE_URL` unset by default, so SQLite is used
  - `UI_DIST=/app/frontend/out`
- Media root mounts must be writable because subtitle files are created/replaced in-place.

Run with Docker Compose using SQLite:

```yaml
services:
  subtitle-ui:
    image: ghcr.io/john5du/subtitle-ui:latest
    container_name: subtitle-ui
    ports:
      - "9307:9307"
    environment:
      MOVIE_MEDIA_ROOT: /data/media/movies
      TV_MEDIA_ROOT: /data/media/tv
      DB_PATH: /data/subtitle_manager.sqlite3
      UI_DIST: /app/frontend/out
    volumes:
      - /path/to/movies:/data/media/movies
      - /path/to/tv:/data/media/tv
      - /path/to/data:/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

PostgreSQL variant:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: subtitle_ui
      POSTGRES_USER: subtitle_ui
      POSTGRES_PASSWORD: change-me
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

  subtitle-ui:
    image: ghcr.io/john5du/subtitle-ui:latest
    container_name: subtitle-ui
    depends_on:
      - postgres
    ports:
      - "9307:9307"
    environment:
      MOVIE_MEDIA_ROOT: /data/media/movies
      TV_MEDIA_ROOT: /data/media/tv
      DB_PATH: /data/subtitle_manager.sqlite3
      DATABASE_URL: postgres://subtitle_ui:change-me@postgres:5432/subtitle_ui?sslmode=disable
      UI_DIST: /app/frontend/out
    volumes:
      - /path/to/movies:/data/media/movies
      - /path/to/tv:/data/media/tv
      - /path/to/data:/data
    restart: unless-stopped

volumes:
  postgres-data:
```

## GitHub Actions image publish

- Workflow file: `.github/workflows/docker-publish.yml`
- Trigger: push to `main` or manual `workflow_dispatch`
- Pipeline: unit tests (`go test ./...`) → resolve patch version → image build/push → version file sync → tag
- Bot version-sync commits do not re-trigger release
- Registry: `ghcr.io/john5du/subtitle-ui`
- Tags published:
  - semantic tag (`vX.Y.Z`)
  - semantic version tag (`X.Y.Z`)
  - moving tag (`latest`)
  - commit SHA tag (`sha-<short>`)
- The publish workflow writes version files into the build context, builds/pushes the image first, then commits those file changes and tags that commit on the default branch when needed.

## Configuration

- `SERVER_ADDR` default `:9307`
- `MOVIE_MEDIA_ROOT` default `./media/movies`
- `TV_MEDIA_ROOT` default `./media/tv`
- `MEDIA_ROOT` legacy fallback (if set and `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` not set, both use it)
- `DB_PATH` default `./tmp/subtitle_manager.sqlite3`; SQLite database path, and the SQLite import source when `DATABASE_URL` is set
- `DATABASE_URL` optional PostgreSQL DSN; when set, PostgreSQL is used instead of SQLite
- `UI_DIST` default `./frontend/out`
- `CORS_ALLOWED_ORIGINS` comma-separated allowed origins for mutating cross-origin API requests
- `ADMIN_TOKEN` admin API token (default `change-me`); all `/api/*` routes except `GET /api/health` and `GET /api/videos/{id}/poster` require `Authorization: Bearer <token>` (poster images stay public because browsers cannot send auth headers on `<img>`). When the default is used, startup logs the value and asks you to change it. The UI shows a login page and stores the token in `localStorage`.
- `TRUST_FORWARDED_HEADERS` set to `1`, `true`, `yes`, or `on` to build absolute poster URLs from `X-Forwarded-Proto` / `X-Forwarded-Host`
- `NEXT_PUBLIC_API_BASE` (frontend dev) — overrides the API host, e.g. `http://localhost:9307`

## Notes

- Upload entry points accept subtitle files and archives (`.zip`, `.7z`, `.rar`); only subtitle files (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) inside archives are processed.
- SRT to ASS conversion supports `auto`, `utf-8`, `utf-16le`, `utf-16be`, `gb18030`, and `big5` source encodings.
- Scanner reads `<videoName>.nfo` and `movie.nfo` from the video's directory.
- Poster resolution order — movies: `poster`, `movie`, `folder`, `<base>-poster`, `<base>`, `cover`; TV (at series root): `poster`, `folder`, `fanart`.
- Replace and delete operations back up the existing subtitle file before writing.
- On the first PostgreSQL connection, existing SQLite data from `DB_PATH` is imported once. Before the SQLite source is opened or upgraded, the app creates a sibling backup named like `<db>.backup-<UTC timestamp>` and also copies `-wal`/`-shm` sidecar files when present. If the PostgreSQL business tables already contain data and no import marker exists, startup fails instead of merging or overwriting data.
- This project is not production hardened.
