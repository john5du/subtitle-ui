# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.0-alpine AS frontend-builder
WORKDIR /workspace/frontend

COPY frontend/package.json frontend/bun.lock ./
COPY frontend/scripts/ ./scripts/
RUN bun ci

COPY frontend/ ./
RUN bun run build

FROM golang:1.26-alpine AS backend-builder
WORKDIR /workspace

COPY go.mod go.sum ./
RUN go mod download

COPY backend/ ./backend/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/server ./backend/cmd/server

FROM alpine:3.23
WORKDIR /app

# ca-certificates + wget (HEALTHCHECK). Video preview proxies Jellyfin (no local ffmpeg).
RUN apk add --no-cache ca-certificates wget \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /app/frontend/out /data/media/movies /data/media/tv \
    && chown -R app:app /app /data

COPY --from=backend-builder /out/server /app/server
COPY --from=frontend-builder /workspace/frontend/out /app/frontend/out

ENV APP_ENV=production \
    SERVER_ADDR=:9307 \
    MOVIE_MEDIA_ROOT=/data/media/movies \
    TV_MEDIA_ROOT=/data/media/tv \
    UI_DIST=/app/frontend/out

EXPOSE 9307

# /api/health is the public probe and Pings PostgreSQL (503 if the DB is down).
# There is no separate /ready endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9307/api/health >/dev/null || exit 1

USER app
ENTRYPOINT ["/app/server"]
