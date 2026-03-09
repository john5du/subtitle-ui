# subtitle-ui

Current Release Version: 0.1.0

基于 Go + Next.js 开发的字幕文件管理 Web 应用。视频元数据从 Jellyfin 刮取的 NFO 元数据文件读取。

English version: [`README.md`](./README.md)

## 本版本实现的功能

- Go 后端骨架框架，包含扫描和字幕文件 API
- 媒体扫描器，可查找视频、NFO 元数据文件和字幕文件
- 字幕操作：上传、替换（先备份）、删除（先备份）
- 基于 Next.js + shadcn/ui 的前端，支持扫描、浏览、上传/替换/删除以及操作日志
- UI 重设计：左侧工作台导航、总览优先流、电影/电视剧管理弹窗、全局 footer（含 GitHub 外链）以及深色背景 + 橙色强调配色

## 后端 API

- `GET /api/health`
- `POST /api/scan` (兼容：直接文件扫描)
- `POST /api/scan/directories` (发现包含视频/元数据文件的媒体子目录)
- `GET /api/scan/directories` (获取最后发现的目录结果)
- `POST /api/scan/files` (从选定目录扫描文件，body: `movieDirs[]`, `tvDirs[]`)
- `GET /api/scan/status`
- `GET /api/videos` (查询参数: `mediaType=movie|tv`, 可选 `q`, `dir`, `page`, `pageSize`)
  - 响应: `{ items: Video[], total, page, pageSize, totalPages }`
- `GET /api/videos/{videoId}`
- `POST /api/videos/{videoId}/subtitles` (multipart `file`, 可选 `label`, `replaceId`)
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs?limit=30`

## 本地运行

### 一键启动 (Windows PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-up.ps1
```

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8080`
- 日志：`tmp/frontend.out.log`, `tmp/frontend.err.log`, `tmp/backend.out.log`, `tmp/backend.err.log`

### 一键停止

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1
```

- 当 pid 文件丢失时的备用选项（按端口杀进程）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1 -KillByPort
```

### 一键重启

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-restart.ps1
```

- `dev-restart` 会先执行 `dev-down`（含 `-KillByPort` 兜底），再执行 `dev-up`。

### 手动启动

1. 启动后端：

```bash
go run ./backend/cmd/server
```

2. 启动前端开发服务器：

```bash
cd frontend
npm install
npm run dev
```

3. 打开浏览器：`http://localhost:3000`

4. 可选（本地开发时指定非默认 API 主机）：

```bash
set NEXT_PUBLIC_API_BASE=http://localhost:8080
```

## 前端构建输出（用于 Go 静态托管）

```bash
cd frontend
npm run build
```

- 静态导出输出目录：`./frontend/out`
- 后端默认 `UI_DIST` 值：`./frontend/out`

## 容器镜像

### 本地构建镜像：

```bash
docker build -t subtitle-ui:local .
```

### 运行容器（使用 bind mount 示例）：

```bash
docker run --rm -p 8080:8080 \
  -v /path/to/movies:/data/media/movies \
  -v /path/to/tv:/data/media/tv \
  -v /path/to/data:/data \
  ghcr.io/john5du/subtitle-ui:latest
```

- 应用程序在 `:8080` 端口同时提供 API 和前端服务。
- 默认容器路径：
  - `MOVIE_MEDIA_ROOT=/data/media/movies`
  - `TV_MEDIA_ROOT=/data/media/tv`
  - `DB_PATH=/data/subtitle_manager.sqlite3`
  - `UI_DIST=/app/frontend/out`

### Docker Compose 运行：

```yaml
services:
  subtitle-ui:
    image: ghcr.io/john5du/subtitle-ui:latest
    container_name: subtitle-ui
    ports:
      - "8080:8080"
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

## GitHub Actions 镜像发布

- 工作流文件：`.github/workflows/docker-publish.yml`
- 触发条件：推送与 `v*` 匹配的标签（例如 `v0.1.0`）
- 镜像仓库：`ghcr.io/john5du/subtitle-ui`
- 发布的标签：
  - 语义版本标签（`v0.1.0`）
  - 提交 SHA 标签（`sha-<short>`）

## 配置项

- `SERVER_ADDR` 默认 `:8080`
- `MOVIE_MEDIA_ROOT` 默认 `./media/movies`
- `TV_MEDIA_ROOT` 默认 `./media/tv`
- `MEDIA_ROOT` 旧版备用（如果设置且 `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` 未设置，两者都会使用它）
- `DB_PATH` 默认 `./tmp/subtitle_manager.sqlite3`
- `UI_DIST` 默认 `./frontend/out`

## 注意事项

- 仅接受常见的字幕格式：`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`。
- 扫描器当前读取 `videoName.nfo` 和 `movie.nfo`。
- 本项目非生产级别的实现。
