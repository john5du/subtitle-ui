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
	MovieDirs    []string `json:"movieDirs,omitempty"`
	TVDirs       []string `json:"tvDirs,omitempty"`
	ConfirmToken string   `json:"confirmToken,omitempty" jsonschema:"required for scan_files apply; from scan_files_preview"`
}

func registerScanTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "scan_status",
		Description: "Current library scan status (running, last times, videoCount, error).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, domain.ScanStatus, error) {
		return nil, svc.ScanStatus(), nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "scan_files_preview",
		Description: "Issue confirmToken for scan_files (same movieDirs/tvDirs).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in scanFilesIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"movieDirs": in.MovieDirs, "tvDirs": in.TVDirs}
		tok, err := svc.IssueMCPConfirmToken("scan_files", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"confirmToken": tok.ConfirmToken, "expiresAt": tok.ExpiresAt, "ttlSeconds": tok.TTLSeconds}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "scan_files",
		Description: "Rescan media directories. Requires confirmToken from scan_files_preview. May take a while.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in scanFilesIn) (*mcp.CallToolResult, domain.ScanStatus, error) {
		params := map[string]any{"movieDirs": in.MovieDirs, "tvDirs": in.TVDirs}
		if err := svc.ValidateMCPConfirmToken("scan_files", params, in.ConfirmToken); err != nil {
			return nil, domain.ScanStatus{}, err
		}
		ctx = app.WithOpAudit(ctx, domain.OpSourceMCP, "scan_files")
		status := svc.RunFileScan(ctx, in.MovieDirs, in.TVDirs)
		if strings.TrimSpace(status.Error) != "" {
			return nil, status, fmt.Errorf("%s", status.Error)
		}
		return nil, status, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "discover_directories",
		Description: "Discover movie folders and TV series directories (read-mostly). On failure check result.errors.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, domain.DirectoryScanResult, error) {
		result := svc.DiscoverDirectories(ctx)
		if len(result.Errors) > 0 {
			return nil, result, fmt.Errorf("%s", strings.Join(result.Errors, "; "))
		}
		return nil, result, nil
	})
}
