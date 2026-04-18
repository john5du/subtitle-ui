<p align="center">
  <img src="./frontend/public/icon.svg" alt="Subtitle UI icon" width="222" height="222" />
</p>

# subtitle-ui

A Go + Next.js web application for managing subtitle files alongside a Jellyfin-style media library. Video metadata is read from sidecar NFO files scraped by Jellyfin (or any compatible scraper).

中文文档：[`README.zh-CN.md`](./README.zh-CN.md)

## Features

- **Movie and TV libraries** — split browsing for `movies/` and `tv/` roots, with per-series season and episode drilldowns.
- **Card and list views** — toggleable poster grid or compact table, with pagination and year sort.
- **Subtitle operations** — upload, replace (backup first), delete (backup first), preview stored subtitle content.
- **Archive uploads** — accepts `.zip`, `.7z`, `.rar` payloads; entries are parsed client-side and you pick which subtitle inside to install.
- **TV season batch upload** — match one archive against a whole season by episode number.
- **Posters** — reads `poster.*` / `folder.*` / `fanart.*` / `<base>-poster.*` next to the video (or at series root for TV) in `.jpg` / `.png` / `.bmp`.
- **Dashboard** — scan status, discovered directory summary, and recent operation log.
- **i18n** — English and 简体中文; preference persisted in `localStorage`.
- **Theme** — light / dark / follow system, persisted in `localStorage`.

## Release process

1. Verify code and build before release:

```bash
go test ./...
cd frontend
npm run build
```

2. Commit release changes on `main` (Conventional Commit style).
3. Create and push the release tag:

```bash
git push origin main
git tag v0.5.4
git push origin v0.5.4
```

4. Tag push (`v*`) triggers `.github/workflows/docker-publish.yml`.
5. Confirm release artifacts:
- GitHub Actions workflow succeeded.
- `ghcr.io/john5du/subtitle-ui` has tags: `v0.5.4`, `0.5.4`, `latest`, `sha-<short>`.
- Version file sync commit is pushed back to the default branch.

## Backend API

- `GET /api/health`
- `GET /api/version`
- `POST /api/scan` (compat: direct file scan)
- `POST /api/scan/directories` (discover media subdirectories that contain video/metadata files)
- `GET /api/scan/directories` (get last discovered directory result)
- `POST /api/scan/files` (scan files from selected directories, body: `movieDirs[]`, `tvDirs[]`)
- `GET /api/scan/status`
- `GET /api/videos` (query: `mediaType=movie|tv`, optional `q`, `dir`, `page`, `pageSize`, `sortBy`, `sortOrder`)
  - response: `{ items: Video[], total, page, pageSize, totalPages }`
- `GET /api/tv/series` (query: optional `q`, `page`, `pageSize`, `sortYear`, `sortOrder`)
  - response: `{ items: TVSeriesSummary[], total, page, pageSize, totalPages }`
- `GET /api/videos/{videoId}`
- `GET /api/videos/{videoId}/poster` (serves poster image resolved under the video's media root)
- `POST /api/videos/{videoId}/subtitles` (multipart `file`, optional `label`, optional `replaceId`)
- `GET /api/videos/{videoId}/subtitles/{subtitleId}/content` (subtitle bytes for preview)
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs?limit=30`

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
- Local `go`, `node`, and `npm`

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
npm install
npm run dev
```

3. Open browser: `http://localhost:3300`

4. Optional (for local dev against non-default API host):

```bash
export NEXT_PUBLIC_API_BASE=http://localhost:9307
cd frontend
npm run dev
```

Or:

```bash
cd frontend
NEXT_PUBLIC_API_BASE=http://localhost:9307 npm run dev
```

## Frontend build output (for Go static hosting)

```bash
cd frontend
npm run build
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
  - `UI_DIST=/app/frontend/out`
- Media root mounts must be writable because subtitle files are created/replaced in-place.

Run with Docker Compose:

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

## GitHub Actions image publish

- Workflow file: `.github/workflows/docker-publish.yml`
- Trigger: push tag matching `v*` (for example `v0.5.4`)
- Registry: `ghcr.io/john5du/subtitle-ui`
- Tags published:
  - semantic tag (`v0.5.4`)
  - semantic version tag (`0.5.4`)
  - moving tag (`latest`)
  - commit SHA tag (`sha-<short>`)
- The publish workflow syncs version files from the pushed tag before image build, and commits those file changes back to the default branch.

## Configuration

- `SERVER_ADDR` default `:9307`
- `MOVIE_MEDIA_ROOT` default `./media/movies`
- `TV_MEDIA_ROOT` default `./media/tv`
- `MEDIA_ROOT` legacy fallback (if set and `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` not set, both use it)
- `DB_PATH` default `./tmp/subtitle_manager.sqlite3`
- `UI_DIST` default `./frontend/out`
- `NEXT_PUBLIC_API_BASE` (frontend dev) — overrides the API host, e.g. `http://localhost:9307`

## Notes

- Upload entry points accept subtitle files and archives (`.zip`, `.7z`, `.rar`); only subtitle files (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) inside archives are processed.
- Scanner reads `<videoName>.nfo` and `movie.nfo` from the video's directory.
- Poster resolution order — movies: `poster`, `movie`, `folder`, `<base>-poster`, `<base>`, `cover`; TV (at series root): `poster`, `folder`, `fanart`.
- Replace and delete operations back up the existing subtitle file before writing.
- This project is not production hardened.
