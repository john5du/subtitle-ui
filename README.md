<p align="center">
  <img src="./frontend/public/icon.svg" alt="Subtitle UI icon" width="222" height="222" />
</p>

# subtitle-ui

A Go + Next.js web application for managing subtitle files. Video metadata is loaded from Jellyfin-scraped sidecar files (NFO) in the media library.

中文文档：[`README.zh-CN.md`](./README.zh-CN.md)

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
git tag v0.1.4
git push origin v0.1.4
```

4. Tag push (`v*`) triggers `.github/workflows/docker-publish.yml`.
5. Confirm release artifacts:
- GitHub Actions workflow succeeded.
- `ghcr.io/john5du/subtitle-ui` has tags: `v0.1.4`, `0.1.4`, `latest`, `sha-<short>`.
- Version file sync commit is pushed back to the default branch.

## Implemented in this release

- Go backend skeleton with scan and subtitle file APIs
- Media scanner that finds videos, sidecar NFO metadata, and subtitle files
- Subtitle operations: upload, replace (backup first), delete (backup first)
- Next.js + shadcn/ui frontend for scan, browsing, upload/replace/delete, and operation logs

## Backend API

- `GET /api/health`
- `POST /api/scan` (compat: direct file scan)
- `POST /api/scan/directories` (discover media subdirectories that contain video/metadata files)
- `GET /api/scan/directories` (get last discovered directory result)
- `POST /api/scan/files` (scan files from selected directories, body: `movieDirs[]`, `tvDirs[]`)
- `GET /api/scan/status`
- `GET /api/version`
- `GET /api/videos` (query: `mediaType=movie|tv`, optional `q`, `dir`, `page`, `pageSize`, `sortBy`, `sortOrder`)
  - response: `{ items: Video[], total, page, pageSize, totalPages }`
- `GET /api/tv/series` (query: optional `q`, `page`, `pageSize`, `sortYear`, `sortOrder`)
  - response: `{ items: TVSeriesSummary[], total, page, pageSize, totalPages }`
- `GET /api/videos/{videoId}`
- `POST /api/videos/{videoId}/subtitles` (multipart `file`, optional `label`, optional `replaceId`)
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs?limit=30`

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
- Trigger: push tag matching `v*` (for example `v0.1.0`)
- Registry: `ghcr.io/john5du/subtitle-ui`
- Tags published:
  - semantic tag (`v0.1.0`)
  - semantic version tag (`0.1.0`)
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

## Notes

- Upload entry points accept subtitle files and archives (`.zip`, `.7z`, `.rar`); only subtitle files (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`) inside archives are processed.
- Scanner currently reads `videoName.nfo` and `movie.nfo`.
- This project is not production hardened.
