package mcp

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/domain"
)

type scanFilesIn struct {
	MovieDirs []string `json:"movieDirs,omitempty" jsonschema:"optional movie subdirs; empty = full movie root"`
	TVDirs    []string `json:"tvDirs,omitempty" jsonschema:"optional TV subdirs; empty = full TV root"`
}

func registerScanTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "scan_status",
		Description: "Current library scan status (running, last times, videoCount, error).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, domain.ScanStatus, error) {
		return nil, svc.ScanStatus(), nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "scan_files",
		Description: "Rescan media directories into the DB. May take a while on large libraries. Empty movieDirs/tvDirs means full scan of both roots. On failure the tool returns IsError (also check status.error).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in scanFilesIn) (*mcp.CallToolResult, domain.ScanStatus, error) {
		status := svc.RunFileScan(ctx, in.MovieDirs, in.TVDirs)
		if strings.TrimSpace(status.Error) != "" {
			return nil, status, fmt.Errorf("%s", status.Error)
		}
		return nil, status, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "discover_directories",
		Description: "Discover movie folders and TV series directories under media roots (does not rescan all files). On failure check result.errors.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, domain.DirectoryScanResult, error) {
		result := svc.DiscoverDirectories(ctx)
		if len(result.Errors) > 0 {
			return nil, result, fmt.Errorf("%s", strings.Join(result.Errors, "; "))
		}
		return nil, result, nil
	})
}
