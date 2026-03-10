# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS frontend-builder
WORKDIR /workspace/frontend

COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts/ ./scripts/
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS backend-builder
WORKDIR /workspace

COPY go.mod go.sum ./
RUN go mod download

COPY backend/ ./backend/
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/server ./backend/cmd/server

FROM alpine:3.20
WORKDIR /app

RUN apk add --no-cache ca-certificates \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /app/frontend/out /data/media/movies /data/media/tv \
    && chown -R app:app /app /data

COPY --from=backend-builder /out/server /app/server
COPY --from=frontend-builder /workspace/frontend/out /app/frontend/out

ENV SERVER_ADDR=:8080 \
    MOVIE_MEDIA_ROOT=/data/media/movies \
    TV_MEDIA_ROOT=/data/media/tv \
    DB_PATH=/data/subtitle_manager.sqlite3 \
    UI_DIST=/app/frontend/out

EXPOSE 8080

USER app
ENTRYPOINT ["/app/server"]
