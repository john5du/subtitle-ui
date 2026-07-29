<p align="center">
  <img src="./frontend/public/icon.svg" alt="Subtitle UI 图标" width="222" height="222" />
</p>

# subtitle-ui

基于 Go + Next.js 开发的字幕文件管理 Web 应用，搭配 Jellyfin 风格的媒体库使用。项目面向中文用户的字幕工作流：从侧车 NFO 读取影片信息，支持站内 SubHD 搜索/下载（也可一键打开字幕库 / SubHD 网页），安全上传或替换字幕，SRT 转 ASS，语言标签规范化，并可选集成 Sonarr（缺集）与 Jellyfin（库刷新 + 播放预览）。

English version: [`README.md`](./README.md)

## 功能概览

- **电影 / 电视剧分库** — 分别扫描 `movies/` 与 `tv/` 根目录；电视剧支持按剧集-季-分集逐层进入。
- **卡片 / 列表切换** — 海报网格与紧凑表格两种视图，均支持分页与按年份排序。
- **中文字幕工作流** — 内置简体中文界面，并提供常用中文字幕站搜索入口。
- **一键外链搜索** — 可从当前影片直接打开字幕库（`zimuku.org`）或 SubHD（`subhd.tv`）网页搜索。
- **SubHD 站内搜索/下载** — 后端 Provider（默认开启）：搜索、下载并安装侧车字幕；电视剧支持季包 prepare/install。
- **字幕操作** — 上传、替换（先备份）、删除、在线预览已存字幕内容。
- **手动时间轴偏移** — 对 SRT、VTT、ASS、SSA 字幕原地平移时间轴，并自动备份。
- **字幕语言规范化** — 单集或整季 plan/apply，重命名侧车语言标签。
- **SRT 转 ASS** — 上传新 SRT 时可同时生成 ASS，也可将已有 SRT 转换为额外的 ASS 文件。
- **ASS 模板编辑** — 支持编辑全局 ASS 转换模板与默认源编码。
- **归档上传** — 支持 `.zip`、`.7z`、`.rar`；**服务端**列举与解压（pure-Go），再选择归档内目标字幕。
- **电视剧整季批量上传** — 一个归档对应整季，按集号自动匹配。
- **Sonarr（可选）** — 对照本机扫描结果展示缺集，并可触发 EpisodeSearch。
- **Jellyfin（可选）** — 字幕变更后通知媒体库；内嵌字幕轨列表；通过 stream-ticket 代理播放预览（progressive / HLS）。
- **海报** — 自动识别视频旁的 `poster.*` / `folder.*` / `fanart.*` / `<base>-poster.*`，支持 `.jpg` / `.png` / `.bmp`（剧集在剧根目录）。
- **仪表盘** — 扫描状态、已发现目录统计、最近操作日志，以及 SubHD / Sonarr / Jellyfin 配置。
- **多语言** — 英文与简体中文，选项保存在 `localStorage`。
- **主题** — 浅色 / 深色 / 跟随系统，选项保存在 `localStorage`。

## 发版流程

1. 推送前可本地验证（可选）：

```bash
go test ./...
cd frontend
bun run build
```

2. 在 `main` 提交改动（遵循 Conventional Commit）并推送：

```bash
git push origin main
```

3. 推送到 `main` 会触发 `.github/workflows/docker-publish.yml`：先跑单元测试（`go test ./...`），再基于版本文件解析下一 patch，构建并推送镜像；成功后再把版本文件同步回 `main`，并在该提交上创建标签 `vX.Y.Z`。
4. 也可以通过 `workflow_dispatch` 手动运行工作流；可选版本输入支持 `0.7.3` 或 `v0.7.3`，不填写时会基于版本文件自动递增 patch。
5. `github-actions[bot]` 的版本同步提交（`chore: sync version files…`）不会再次触发发版。
6. 发版结果核对：
- GitHub Actions 工作流执行成功。
- `ghcr.io/john5du/subtitle-ui` 生成标签：`vX.Y.Z`、`X.Y.Z`、`latest`、`sha-<short>`。
- 版本文件同步提交已回推到默认分支。

## 后端 API

鉴权：多数 `/api/*` 需 `Authorization: Bearer <token>`。**无需 Bearer 的公开路径：**

- `GET /api/health`
- `GET /api/videos/{id}/poster`
- `GET|HEAD /api/videos/{id}/stream?ticket=`
- `GET|HEAD /api/videos/{id}/hls/master?ticket=`
- `GET|HEAD /api/videos/{id}/hls/seg?ticket=&u=`

（`POST .../stream-ticket` 仍需 Bearer。）

### MCP（AI agent）

同一进程内嵌 Streamable MCP（默认**关闭**）：

- 端点：`/mcp`（需 Bearer `ADMIN_TOKEN`；关闭时 503）
- 环境变量引导：`MCP_ENABLED=true`；运行时 `GET|PUT /api/config/mcp` `{ enabled, endpoint }`（DB 覆盖 env；设置页可开关）
- 工具（进程内调用 `app.Service`）：`list_videos`、`get_video`、`list_tv_series`、`version_info`、`scan_status`、`scan_files`、`discover_directories`、`read_subtitle_content`、`delete_subtitle`、`convert_subtitle_to_ass`、`offset_subtitle_timing`、`normalize_plan_video` / `normalize_apply_video`、`normalize_plan_season` / `normalize_apply_season`、`install_subtitle_from_path`、`read_subtitle_cues`、`install_translated_cues`（agent 双语 SRT，时间轴锁定源轨）、`subhd_search`、`subhd_download`、`subhd_season_packs`、`subhd_season_prepare`、`subhd_season_install`
- Agent 翻译：`read_subtitle_cues` → 只译正文 → 一次 `install_translated_cues`（默认 `label=zh&en`）
- 连接示例：URL `http://127.0.0.1:9307/mcp`，Header `Authorization: Bearer <ADMIN_TOKEN>`

### 核心

- `GET /api/health`
- `GET /api/version`
- `POST /api/scan/directories` — 发现包含视频/元数据文件的媒体子目录
- `GET /api/scan/directories` — 最近一次目录发现结果
- `POST /api/scan/files` — body: `movieDirs[]`, `tvDirs[]`；空 body 扫描全部
- `GET /api/scan/status`
- `GET /api/logs` — 可选 `page`, `pageSize`
- `DELETE /api/logs`

### 配置

- `GET|PUT /api/config/subtitle-conversion` — `{ assTemplate, defaultAssTemplate, sourceEncodingDefault, updatedAt }`
- `GET|PUT /api/config/subhd` — `{ enabled, baseUrl, proxy }`
- `GET|PUT /api/config/sonarr` — `{ enabled, url, apiKey }`（GET 不返回完整 key，仅 `apiKeySet`；PUT 空 key 保留已存密钥）
- `POST /api/config/sonarr/test`
- `GET|PUT /api/config/jellyfin` — `{ enabled, url, apiKey, pathMap }`（同样脱敏）
- `POST /api/config/jellyfin/test`

### 媒体库

- `GET /api/videos` — `mediaType=movie|tv`，可选 `q`, `dir`, `page`, `pageSize`, `sortBy`, `sortOrder`
- `GET /api/videos/{videoId}`
- `GET /api/videos/{videoId}/poster`
- `GET /api/tv/series` — 可选 `q`, `page`, `pageSize`, `sortYear`, `sortOrder`
- `GET /api/tv/series/completeness` — `path` 或 `key`，必填 `season`（Sonarr）
- `POST /api/tv/series/sonarr/search` — body：`path`/`key`、`season`，可选 `episodes[]` 或 `allMissing`

### 字幕

- `POST /api/videos/{videoId}/subtitles` — multipart `file`，可选 `label`、`replaceId`；可选 `convertTo=ass`、`sourceEncoding`
- `GET /api/videos/{videoId}/subtitles/{subtitleId}/content`
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/convert` — body: `targetFormat=ass`，可选 `sourceEncoding`
- `POST /api/videos/{videoId}/subtitles/{subtitleId}/timing/offset` — body: `offsetMs`
- `DELETE /api/videos/{videoId}/subtitles/{subtitleId}`
- `POST /api/videos/{videoId}/subtitles/normalize/plan|apply`
- `POST /api/tv/series/subtitles/normalize/plan|apply` — body 指定剧集与季
- `GET /api/videos/{videoId}/subtitles/embedded` — Jellyfin 内嵌轨（未启用时 503）

### SubHD

- `GET /api/videos/{videoId}/subtitles/providers/subhd/search?q=&page=`
- `POST /api/videos/{videoId}/subtitles/providers/subhd/download` — JSON `{ sid, label?, replaceId?, archiveEntry? }`
- `GET /api/videos/{videoId}/subtitles/providers/subhd/season-packs`
- `POST /api/subtitles/providers/subhd/season-prepare`
- `POST /api/subtitles/providers/subhd/season-install`

### 归档

- `POST /api/archives/subtitle-entries` — multipart `file` → `{ entries }`
- `POST /api/archives/extract` — multipart `file` + `entry` / `archiveEntry`
- `POST /api/subtitles/batch-from-archive` — multipart `file` + JSON `mappings`

### 播放预览（Jellyfin）

- `POST /api/videos/{videoId}/stream-ticket` → `{ ticket, expiresAt, url, kind }`（`progressive`|`hls`）
- `GET|HEAD /api/videos/{videoId}/stream?ticket=`
- `GET|HEAD /api/videos/{videoId}/hls/master?ticket=`
- `GET|HEAD /api/videos/{videoId}/hls/seg?ticket=&u=`

## 媒体库目录结构

每个被扫描到的视频需要可解析的侧车 NFO（电视剧也可依赖从分集目录向上找到的 `tvshow.nfo`）。海报可选。NFO 中 `<title>`、`<originaltitle>`、`<year>`、`<imdb_id>`、`<tmdbid>` **任一非空即可**；标题为空时回退为视频文件名；**不要求 year**。

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
    tvshow.nfo                 # 可选但推荐（剧名 / ID；也会向上查找）
    poster.png                 # 可选（poster / folder / fanart）
    Season 1/
      Chronicle of Lanterns S01E01.mkv
      Chronicle of Lanterns S01E01.nfo   # 和/或剧根 tvshow.nfo
```

识别的视频扩展：`.mp4 .mkv .avi .mov .wmv .flv .m4v .mpeg .mpg`。
识别的字幕扩展：`.srt .ass .ssa .vtt .sub`。

## 本地运行（macOS）

依赖要求：
- macOS 自带 `bash` 与 `lsof`
- 本地已安装 `go`、`bun`（`frontend/package.json` 当前指定 `bun@1.3.14`）

### 一键启动

```bash
cp scripts/.env.example scripts/.env   # 首次：填入密钥（scripts/.env 已被 gitignore）
./scripts/dev-up.sh
```

- 自动加载 `scripts/.env`，再加载 `scripts/.env.local`（已在 shell 中 export 的变量优先）。见 `scripts/.env.example`。

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
- 触发条件：推送到 `main` 或手动执行 `workflow_dispatch`
- 流程：单元测试（`go test ./...`）→ 解析 patch 版本 → 构建/推送镜像 → 同步版本文件 → 打标签
- bot 的版本同步提交不会再次触发发版
- 镜像仓库：`ghcr.io/john5du/subtitle-ui`
- 发布标签：
  - 语义版本标签（`vX.Y.Z`）
  - 纯语义版本标签（`X.Y.Z`）
  - 滚动标签（`latest`）
  - 提交 SHA 标签（`sha-<short>`）
- 发布流程会在构建上下文中写入版本文件并先构建/推送镜像；成功后再将版本文件提交回默认分支并在该提交上打标签，确保仓库与容器内版本一致。

## 配置项

核心：

- `SERVER_ADDR` 默认 `:9307`
- `MOVIE_MEDIA_ROOT` 默认 `./media/movies`
- `TV_MEDIA_ROOT` 默认 `./media/tv`
- `MEDIA_ROOT` 旧版兜底（若设置且 `MOVIE_MEDIA_ROOT`/`TV_MEDIA_ROOT` 未设置，则两者都使用它）
- `DB_PATH` 默认 `./tmp/subtitle_manager.sqlite3`；SQLite 路径，设置 `DATABASE_URL` 时也作为迁移源
- `DATABASE_URL` 可选 PostgreSQL DSN；设置后使用 PostgreSQL 而不是 SQLite
- `UI_DIST` 默认 `./frontend/out`
- `CORS_ALLOWED_ORIGINS` 逗号分隔的允许来源列表，用于跨来源写入类 API 请求
- `ADMIN_TOKEN` 管理员 API 令牌（未设置时默认 `change-me`）。不安全默认值会被拒绝，除非改为强密钥，或（仅非 production）设置 `ALLOW_INSECURE_DEFAULT_ADMIN_TOKEN=true`（`./scripts/dev-up.sh` 在未设置时会自动打开该开关）。除「后端 API」一节列出的公开路径外，全部 `/api/*` 与 `/mcp` 需 Bearer（health、poster、带 ticket 的 stream/HLS）。前端登录页会把令牌保存在 `localStorage`。
- `MCP_ENABLED` 默认关闭；设为 `true` 启动时开启 `/mcp`（也可在设置页 / `PUT /api/config/mcp` 开关）
- `TRUST_FORWARDED_HEADERS` 设置为 `1`、`true`、`yes` 或 `on` 后，会基于 `X-Forwarded-Proto` / `X-Forwarded-Host` 生成绝对海报 URL
- `NEXT_PUBLIC_API_BASE`（前端开发）— 覆盖 API 主机地址，例如 `http://localhost:9307`

SubHD（默认**开启**；运行时 `GET/PUT /api/config/subhd` 覆盖 env，无需重启）：

- `SUBHD_ENABLED` — 设为 `false` 关闭
- `SUBHD_BASE_URL` 默认 `https://subhd.tv`
- `SUBHD_PROXY` 例如 `socks5://host:port`
- `SUBHD_MIN_INTERVAL` 默认 `3s`（下载节流）
- `SUBHD_SEARCH_MAX_PAGES` 默认 `1`

Sonarr（可选；URL+key 已配置则启用，除非 `SONARR_ENABLED=false`）：

- `SONARR_URL` 例如 `http://127.0.0.1:8989`
- `SONARR_API_KEY`
- `SONARR_ENABLED`

Jellyfin（可选；字幕通知 + 播放预览；URL+key 已配置则启用，除非 `JELLYFIN_ENABLED=false`）：

- `JELLYFIN_URL` 例如 `http://127.0.0.1:8096`
- `JELLYFIN_API_KEY`
- `JELLYFIN_ENABLED`
- `JELLYFIN_PATH_MAP` 形如 `local:jellyfin,...`（两边挂载根不同时）
- `JELLYFIN_USER_ID` 可选 PlaybackInfo 用户 GUID；空则自动选管理员
- `STREAM_TICKET_SECRET` 可选（否则用 `ADMIN_TOKEN`）
- `STREAM_TICKET_TTL` 默认 `15m`

更多示例见 `scripts/.env.example`；面向开发代理的细节见 [`AGENTS.md`](./AGENTS.md)。前端 UI 约定：[`docs/frontend-ui.md`](./docs/frontend-ui.md)、[`docs/frontend-dialogs.md`](./docs/frontend-dialogs.md)。

## 注意事项

- 上传入口支持字幕文件与归档（`.zip`、`.7z`、`.rar`）；归档列举/解压在服务端完成；归档内仅处理字幕格式：`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`。
- SRT 转 ASS 支持 `auto`、`utf-8`、`utf-16le`、`utf-16be`、`gb18030`、`big5` 源编码。
- 扫描器：电影使用 `{base}.nfo` / `movie.nfo`；电视剧还会向上查找 `tvshow.nfo`。没有可用 NFO 的视频会被跳过。
- 海报查找顺序 — 电影：`poster`、`movie`、`folder`、`<base>-poster`、`<base>`、`cover`；电视剧（剧根目录）：`poster`、`folder`、`fanart`。
- 替换与删除操作会先备份原字幕文件再写入。
- 首次连接 PostgreSQL 时，会从 `DB_PATH` 指向的 SQLite 数据库导入一次数据。在打开或升级 SQLite 源库前，应用会先在同目录创建 `<db>.backup-<UTC 时间戳>` 形式的备份；如果存在 `-wal`/`-shm` 旁路文件，也会一起复制。如果 PostgreSQL 业务表已有数据且没有导入标记，启动会失败，避免自动合并或覆盖数据。
- 本项目尚未达到生产级硬化。
