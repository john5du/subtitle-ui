package mcp

import (
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/version"
)

// NewServer builds an MCP server exposing subtitle-ui tools against app.Service.
func NewServer(svc *app.Service) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{
		Name:    "subtitle-ui",
		Version: version.Value,
	}, nil)
	registerLibraryTools(s, svc)
	registerScanTools(s, svc)
	registerSubtitleTools(s, svc)
	registerSubHDTools(s, svc)
	return s
}

// NewHTTPHandler serves Streamable MCP over HTTP (mount at /mcp).
func NewHTTPHandler(svc *app.Service) http.Handler {
	server := NewServer(svc)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, nil)
}
