# subtitle-ui（中文说明）

英文版：[`README.md`](./README.md)

本项目使用 Go + Next.js 提供字幕管理 Web UI。视频元数据来自媒体库中的 Jellyfin 侧车文件（NFO）。

## 本次已实现功能

- Go 后端骨架与扫描/字幕 API
- 媒体扫描：识别视频、NFO 元数据与字幕文件
- 字幕操作：上传、替换（先备份）、删除（先备份）
- Next.js + shadcn/ui 前端：扫描、浏览、上传/替换/删除、操作日志

## 后端 API

- `GET /api/health`
- `POST /api/scan`（兼容：直接扫描）
- `POST /api/scan/directories`（发现包含视频/元数据的目录）
- `GET /api/scan/directories`（获取最近一次目录扫描结果）
- `POST /api/scan/files`（按目录扫描，body: `movieDirs[]`, `tvDirs[]`）
- `GET /api/scan/status`
- `GET /api/videos`（参数：`mediaType=movie|tv`，可选 `q`, `dir`, `page`, `pageSize`）
- `GET /api/videos/{videoId}`
- `POST /api/videos/{videoId}/subtitles`（multipart：`file`，可选 `label`, `replaceId`）
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs?limit=30`

## 本地运行

### Windows 一键启动

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

兜底按端口结束：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-down.ps1 -KillByPort
```

### 一键重启

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-restart.ps1
```

- `dev-restart` 会先执行 `dev-down`（含 `-KillByPort` 兜底），再执行 `dev-up`。

### 手动启动

```bash
go run ./backend/cmd/server
cd frontend
npm install
npm run dev
```

可选 API 地址：

```bash
set NEXT_PUBLIC_API_BASE=http://localhost:8080
```

## 前端静态构建（供 Go 托管）

```bash
cd frontend
npm run build
```

- 导出目录：`./frontend/out`
- 后端默认 `UI_DIST`：`./frontend/out`

## 容器镜像

本地构建：

```bash
docker build -t subtitle-ui:local .
```

本地运行（绑定目录示例）：

```bash
docker run --rm -p 8080:8080 \
  -v /path/to/movies:/data/media/movies \
  -v /path/to/tv:/data/media/tv \
  -v /path/to/data:/data \
  subtitle-ui:local
```

默认容器路径：

- `MOVIE_MEDIA_ROOT=/data/media/movies`
- `TV_MEDIA_ROOT=/data/media/tv`
- `DB_PATH=/data/subtitle_manager.sqlite3`
- `UI_DIST=/app/frontend/out`

### Docker Compose 示例

```yaml
services:
  subtitle-ui:
    image: ghcr.io/john5du/subtitle-ui:v0.0.1
    container_name: subtitle-ui
    ports:
      - "8080:8080"
    environment:
      MOVIE_MEDIA_ROOT: /data/media/movies
      TV_MEDIA_ROOT: /data/media/tv
      DB_PATH: /data/subtitle_manager.sqlite3
      UI_DIST: /app/frontend/out
    volumes:
      - /path/to/movies:/data/media/movies:ro
      - /path/to/tv:/data/media/tv:ro
      - /path/to/data:/data
    restart: unless-stopped
```

```bash
docker compose up -d
```

## GitHub Actions 自动发布镜像

- 流水线文件：`.github/workflows/docker-publish.yml`
- 触发条件：推送 `v*` 标签（例如 `v0.1.0`）
- 仓库地址：`ghcr.io/john5du/subtitle-ui`
- 发布标签：
  - 语义化标签（如 `v0.1.0`）
  - 提交哈希标签（`sha-<short>`）

## 配置项

- `SERVER_ADDR` 默认 `:8080`
- `MOVIE_MEDIA_ROOT` 默认 `./media/movies`
- `TV_MEDIA_ROOT` 默认 `./media/tv`
- `MEDIA_ROOT` 兼容回退（若设置且未设置 movie/tv 根目录，则两者都使用它）
- `DB_PATH` 默认 `./tmp/subtitle_manager.sqlite3`
- `UI_DIST` 默认 `./frontend/out`

## 说明

- 仅支持常见字幕格式：`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`
- 扫描器当前读取 `videoName.nfo` 与 `movie.nfo`
- 当前项目尚未做生产级加固
