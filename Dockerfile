# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-alpine AS frontend-builder
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

RUN apk add --no-cache ca-certificates ffmpeg \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /app/frontend/out /data/media/movies /data/media/tv \
    && chown -R app:app /app /data

COPY --from=backend-builder /out/server /app/server
COPY --from=frontend-builder /workspace/frontend/out /app/frontend/out

ENV SERVER_ADDR=:9307 \
    MOVIE_MEDIA_ROOT=/data/media/movies \
    TV_MEDIA_ROOT=/data/media/tv \
    DB_PATH=/data/subtitle_manager.sqlite3 \
    UI_DIST=/app/frontend/out

EXPOSE 9307

USER app
ENTRYPOINT ["/app/server"]
