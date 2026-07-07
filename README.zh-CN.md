<p align="center">
  <img src="./frontend/public/icon.svg" alt="Subtitle UI 图标" width="222" height="222" />
</p>

# subtitle-ui

基于 Go + Next.js 开发的字幕文件管理 Web 应用，搭配 Jellyfin 风格的媒体库使用。项目面向中文用户的字幕工作流设计：从 Jellyfin（或兼容刮削器）生成的侧车 NFO 读取影片信息，一键跳转到字幕库 / SubHD 搜索字幕，安全上传或替换字幕文件，将 SRT 转换为 ASS，并支持编辑全局 ASS 转换模板。

English version: [`README.md`](./README.md)

## 功能概览

- **电影 / 电视剧分库** — 分别扫描 `movies/` 与 `tv/` 根目录；电视剧支持按剧集-季-分集逐层进入。
- **卡片 / 列表切换** — 海报网格与紧凑表格两种视图，均支持分页与按年份排序。
- **中文字幕工作流** — 内置简体中文界面，并提供常用中文字幕站搜索入口。
- **一键字幕搜索** — 可从当前影片直接打开字幕库（`zimuku.org`）或 SubHD（`subhd.tv`）搜索。
- **字幕操作** — 上传、替换（先备份）、删除、在线预览已存字幕内容。
- **手动时间轴偏移** — 对 SRT、VTT、ASS、SSA 字幕原地平移时间轴，并自动备份。
- **SRT 转 ASS** — 上传新 SRT 时可同时生成 ASS，也可将已有 SRT 转换为额外的 ASS 文件。
- **ASS 模板编辑** — 支持编辑全局 ASS 转换模板与默认源编码。
- **归档上传** — 支持 `.zip`、`.7z`、`.rar`，在前端解压并选择归档内的目标字幕。
- **电视剧整季批量上传** — 一个归档对应整季，按集号自动匹配。
- **海报** — 自动识别视频旁的 `poster.*` / `folder.*` / `fanart.*` / `<base>-poster.*`，支持 `.jpg` / `.png` / `.bmp`（剧集在剧根目录）。
- **仪表盘** — 扫描状态、已发现目录统计、最近操作日志。
- **多语言** — 英文与简体中文，选项保存在 `localStorage`。
- **主题** — 浅色 / 深色 / 跟随系统，选项保存在 `localStorage`。

## 发版流程

1. 发版前先验证代码与构建：

```bash
go test ./...
cd frontend
bun run build
```

2. 在 `main` 提交发版改动（遵循 Conventional Commit）。
3. 当前源码版本为 `0.7.2`。为要发布的版本创建并推送标签：

```bash
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

4. 推送 `v*` 标签后，会触发 `.github/workflows/docker-publish.yml`。也可以通过 `workflow_dispatch` 手动运行工作流；可选版本输入支持 `0.7.3` 或 `v0.7.3`，不填写时会基于版本文件自动递增 patch。
5. 发版结果核对：
- GitHub Actions 工作流执行成功。
- `ghcr.io/john5du/subtitle-ui` 生成标签：`vX.Y.Z`、`X.Y.Z`、`latest`、`sha-<short>`。
- 版本文件同步提交已回推到默认分支。

## 后端 API

- `GET /api/health`
- `GET /api/version`
- `POST /api/scan`（兼容：直接文件扫描）
- `POST /api/scan/directories`（发现包含视频/元数据文件的媒体子目录）
- `GET /api/scan/directories`（获取最近一次目录发现结果）
- `POST /api/scan/files`（从选定目录扫描文件，body: `movieDirs[]`, `tvDirs[]`）
- `GET /api/scan/status`
- `GET /api/config/subtitle-conversion`
  - 响应：`{ assTemplate, defaultAssTemplate, sourceEncodingDefault, updatedAt }`
- `PUT /api/config/subtitle-conversion`（body: `assTemplate`, `sourceEncodingDefault`）
- `GET /api/videos`（查询参数：`mediaType=movie|tv`，可选 `q`, `dir`, `page`, `pageSize`, `sortBy`, `sortOrder`）
  - 响应：`{ items: Video[], total, page, pageSize, totalPages }`
- `GET /api/tv/series`（查询参数：可选 `q`, `page`, `pageSize`, `sortYear`, `sortOrder`）
  - 响应：`{ items: TVSeriesSummary[], total, page, pageSize, totalPages }`
- `GET /api/videos/{videoId}`
- `GET /api/videos/{videoId}/poster`（在视频所属媒体根内解析并返回海报图）
- `POST /api/videos/{videoId}/subtitles`（multipart `file`，可选 `label`，可选 `replaceId`；新上传 SRT 时可选 `convertTo=ass`, `sourceEncoding`）
- `GET /api/videos/{videoId}/subtitles/{subtitleId}/content`（用于预览的字幕原始字节）
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/convert`（body: `targetFormat=ass`，可选 `sourceEncoding`）
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/timing/offset`（body: `offsetMs`；支持 SRT/VTT/ASS/SSA）
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `GET /api/logs`（查询参数：可选 `page`, `pageSize`）
  - 响应：`{ items: OperationLog[], total, page, pageSize, totalPages }`
- `DELETE /api/logs`（清空全部操作日志）

## 媒体库目录结构

每个被扫描到的视频都需要带 `<title>` / `<year>` 的侧车 NFO；海报可选。

### 电影

```
media/movies/
  The Midnight Compass (2023)/
    The Midnight Compass.mkv
    The Midnight Compass.nfo   # 或 movie.nfo
    poster.png                 # 可选（poster / movie / folder / <base>-poster / cover）
```

### 电视剧

```
media/tv/
  Chronicle of Lanterns/
    poster.png                 # 可选（poster / folder / fanart）
    Season 1/
      Chronicle of Lanterns S01E01.mkv
      Chronicle of Lanterns S01E01.nfo
```

识别的视频扩展：`.mp4 .mkv .avi .mov .wmv .flv .m4v .mpeg .mpg`。
识别的字幕扩展：`.srt .ass .ssa .vtt .sub`。

## 本地运行（macOS）

依赖要求：
- macOS 自带 `bash` 与 `lsof`
- 本地已安装 `go`、`bun`（`frontend/package.json` 当前指定 `bun@1.3.14`）

### 一键启动

```bash
./scripts/dev-up.sh
```

- 前端：`http://localhost:3300`
- 后端：`http://localhost:9307`
- 日志：`tmp/frontend.out.log`, `tmp/frontend.err.log`, `tmp/backend.out.log`, `tmp/backend.err.log`

### 一键停止

```bash
./scripts/dev-down.sh
```

- `pid` 文件丢失时可按端口兜底停止：

```bash
./scripts/dev-down.sh --kill-by-port
```

### 一键重启

```bash
./scripts/dev-restart.sh
```

- `dev-restart` 会先执行 `dev-down --kill-by-port`，再执行 `dev-up`。

### 手动启动

1. 启动后端：

```bash
go run ./backend/cmd/server
```

2. 启动前端开发服务器：

```bash
cd frontend
bun install
bun run dev
```

3. 打开浏览器：`http://localhost:3300`

4. 可选（本地开发时指定非默认 API 主机）：

```bash
export NEXT_PUBLIC_API_BASE=http://localhost:9307
cd frontend
bun run dev
```

或者：

```bash
cd frontend
NEXT_PUBLIC_API_BASE=http://localhost:9307 bun run dev
```

## 前端构建输出（用于 Go 静态托管）

```bash
cd frontend
bun run build
```

- 静态导出目录：`./frontend/out`
- 后端默认 `UI_DIST`：`./frontend/out`

## 容器镜像

本地构建镜像：

```bash
docker build -t subtitle-ui:local .
```

运行容器（bind mount 示例）：

```bash
docker run --rm -p 9307:9307 \
  -v /path/to/movies:/data/media/movies \
  -v /path/to/tv:/data/media/tv \
  -v /path/to/data:/data \
  ghcr.io/john5du/subtitle-ui:latest
```

- 应用在 `:9307` 同时提供 API 和前端服务。
- 默认容器路径：
  - `MOVIE_MEDIA_ROOT=/data/media/movies`
  - `TV_MEDIA_ROOT=/data/media/tv`
  - `DB_PATH=/data/subtitle_manager.sqlite3`
  - `DATABASE_URL` 默认不设置，因此使用 SQLite
  - `UI_DIST=/app/frontend/out`
- 媒体目录挂载必须可写，因为字幕文件会原地创建/替换。

使用 Docker Compose 运行（SQLite）：

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

PostgreSQL 变体：

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

## GitHub Actions 镜像发布

- 工作流文件：`.github/workflows/docker-publish.yml`
- 触发条件：推送匹配 `v*` 的标签（例如 `v0.7.2`）或手动执行 `workflow_dispatch`
- 镜像仓库：`ghcr.io/john5du/subtitle-ui`
- 发布标签：
  - 语义版本标签（`vX.Y.Z`）
  - 纯语义版本标签（`X.Y.Z`）
  - 滚动标签（`latest`）
  - 提交 SHA 标签（`sha-<short>`）
- 发布流程会在镜像构建前同步版本文件，并在需要时将版本文件改动提交回默认分支，确保仓库与容器内版本一致。

## 配置项

- `SERVER_ADDR` 默认 `:9307`
- `MOVIE_MEDIA_ROOT` 默认 `./media/movies`
- `TV_MEDIA_ROOT` 默认 `./media/tv`
- `MEDIA_ROOT` 旧版兜底（若设置且 `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` 未设置，则两者都使用它）
- `DB_PATH` 默认 `./tmp/subtitle_manager.sqlite3`；SQLite 数据库路径，设置 `DATABASE_URL` 时也作为 SQLite 迁移源
- `DATABASE_URL` 可选 PostgreSQL DSN；设置后使用 PostgreSQL 而不是 SQLite
- `UI_DIST` 默认 `./frontend/out`
- `CORS_ALLOWED_ORIGINS` 逗号分隔的允许来源列表，用于跨来源写入类 API 请求
- `TRUST_FORWARDED_HEADERS` 设置为 `1`、`true`、`yes` 或 `on` 后，会基于 `X-Forwarded-Proto` / `X-Forwarded-Host` 生成绝对海报 URL
- `NEXT_PUBLIC_API_BASE`（前端开发）— 覆盖 API 主机地址，例如 `http://localhost:9307`

## 注意事项

- 上传入口支持字幕文件与归档文件（`.zip`、`.7z`、`.rar`）；归档内仅处理字幕格式：`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`。
- SRT 转 ASS 支持 `auto`、`utf-8`、`utf-16le`、`utf-16be`、`gb18030`、`big5` 源编码。
- 扫描器从视频所在目录读取 `<videoName>.nfo` 和 `movie.nfo`。
- 海报查找顺序 — 电影：`poster`、`movie`、`folder`、`<base>-poster`、`<base>`、`cover`；电视剧（剧根目录）：`poster`、`folder`、`fanart`。
- 替换与删除操作会先备份原字幕文件再写入。
- 首次连接 PostgreSQL 时，会从 `DB_PATH` 指向的 SQLite 数据库导入一次数据。在打开或升级 SQLite 源库前，应用会先在同目录创建 `<db>.backup-<UTC 时间戳>` 形式的备份；如果存在 `-wal`/`-shm` 旁路文件，也会一起复制。如果 PostgreSQL 业务表已有数据且没有导入标记，启动会失败，避免自动合并或覆盖数据。
- 本项目尚未达到生产级硬化。
