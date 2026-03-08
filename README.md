# subtitle-ui

subtitle-ui project using Go + Next.js web UI for managing subtitle files. Video metadata is loaded from Jellyfin-scraped sidecar files (NFO) in the media library.

## Implemented in this iteration

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
- `GET /api/videos` (query: `mediaType=movie|tv`, optional `q`, `dir`, `page`, `pageSize`)
  - response: `{ items: Video[], total, page, pageSize, totalPages }`
- `GET /api/videos/{videoId}`
- `POST /api/videos/{videoId}/subtitles` (multipart `file`, optional `label`, optional `replaceId`)
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs?limit=30`

## Local run

### One-click startup (Windows PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`
- Logs: `tmp/frontend.out.log`, `tmp/frontend.err.log`, `tmp/backend.out.log`, `tmp/backend.err.log`

### One-click stop

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
```

- Optional fallback by port (when pid files are missing):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1 -KillByPort
```

### One-click restart

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-restart.ps1
```

- `dev-restart` 会先执行 `dev-down`（含 `-KillByPort` 兜底），再执行 `dev-up`。

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

3. Open browser: `http://localhost:3000`

4. Optional (for local dev against non-default API host):

```bash
set NEXT_PUBLIC_API_BASE=http://localhost:8080
```

## Frontend build output (for Go static hosting)

```bash
cd frontend
npm run build
```

- Static export output is `./frontend/out`
- Backend default `UI_DIST` is `./frontend/out`

## Configuration

- `SERVER_ADDR` default `:8080`
- `MOVIE_MEDIA_ROOT` default `./media/movies`
- `TV_MEDIA_ROOT` default `./media/tv`
- `MEDIA_ROOT` legacy fallback (if set and `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` not set, both use it)
- `DB_PATH` default `./tmp/subtitle_manager.sqlite3`
- `UI_DIST` default `./frontend/out`

## Notes

- Only common subtitle formats are accepted: `.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`.
- Scanner currently reads `videoName.nfo` and `movie.nfo`.
- This project is not production hardened.
