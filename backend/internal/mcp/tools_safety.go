package mcp

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"subtitle-ui/backend/internal/app"
	"subtitle-ui/backend/internal/domain"
)

type listLogsIn struct {
	Page     int    `json:"page,omitempty" jsonschema:"page (default 1)"`
	PageSize int    `json:"pageSize,omitempty" jsonschema:"page size (default 30, max 200)"`
	Action   string `json:"action,omitempty" jsonschema:"filter by action e.g. delete, offset, upload"`
	VideoID  string `json:"videoId,omitempty" jsonschema:"filter by video id"`
	Source   string `json:"source,omitempty" jsonschema:"filter rest|mcp|system"`
	Tool     string `json:"tool,omitempty" jsonschema:"filter by MCP tool name"`
}

type getLogIn struct {
	OpID string `json:"opId" jsonschema:"operation log id"`
}

type rollbackPreviewIn struct {
	OpID string `json:"opId" jsonschema:"operation log id to rollback"`
}

type rollbackIn struct {
	OpID         string `json:"opId" jsonschema:"operation log id"`
	ConfirmToken string `json:"confirmToken,omitempty" jsonschema:"from rollback_operation_preview"`
}

type listBackupsIn struct {
	VideoID       string `json:"videoId,omitempty" jsonschema:"optional video id to scope directory"`
	OlderThanDays int    `json:"olderThanDays,omitempty" jsonschema:"only backups older than N days"`
}

type cleanupBackupsPreviewIn struct {
	OlderThanDays int      `json:"olderThanDays,omitempty" jsonschema:"only backups older than N days (0 = all listed)"`
	Paths         []string `json:"paths,omitempty" jsonschema:"optional explicit backup paths"`
}

type cleanupBackupsIn struct {
	OlderThanDays int      `json:"olderThanDays,omitempty"`
	Paths         []string `json:"paths,omitempty"`
	ConfirmToken  string   `json:"confirmToken,omitempty" jsonschema:"from cleanup_subtitle_backups_preview"`
}

type clearLogsPreviewIn struct {
	KeepDays int `json:"keepDays" jsonschema:"delete logs older than this many days; 0 = all"`
}

type clearLogsIn struct {
	KeepDays     int    `json:"keepDays" jsonschema:"same as preview"`
	ConfirmToken string `json:"confirmToken,omitempty" jsonschema:"from clear_operation_logs_preview"`
}

func registerSafetyTools(s *mcp.Server, svc *app.Service) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_operation_logs",
		Description: "List operation audit logs (newest first). Use to find opId/backupPath for rollback. Filter by action, videoId, source (mcp|rest), tool.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in listLogsIn) (*mcp.CallToolResult, domain.OperationLogPage, error) {
		page := in.Page
		if page < 1 {
			page = 1
		}
		pageSize := in.PageSize
		if pageSize < 1 {
			pageSize = 30
		}
		pageData, err := svc.ListLogsPageFiltered(page, pageSize, domain.OperationLogFilter{
			Action:  in.Action,
			VideoID: in.VideoID,
			Source:  in.Source,
			Tool:    in.Tool,
		})
		if err != nil {
			return nil, domain.OperationLogPage{}, err
		}
		return nil, pageData, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_operation_log",
		Description: "Get one operation log by opId (includes backupPath, meta, source, tool).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in getLogIn) (*mcp.CallToolResult, domain.OperationLog, error) {
		log, err := svc.GetOperationLog(in.OpID)
		return nil, log, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "rollback_operation_preview",
		Description: "Preview rollback for a successful opId and issue confirmToken. Required before rollback_operation.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in rollbackPreviewIn) (*mcp.CallToolResult, map[string]any, error) {
		log, err := svc.GetOperationLog(in.OpID)
		if err != nil {
			return nil, nil, err
		}
		params := map[string]any{"opId": in.OpID}
		tok, err := svc.IssueMCPConfirmToken("rollback_operation", params)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{
			"op":           log,
			"confirmToken": tok.ConfirmToken,
			"expiresAt":    tok.ExpiresAt,
			"ttlSeconds":   tok.TTLSeconds,
			"note":         "Call rollback_operation with the same opId and confirmToken.",
		}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "rollback_operation",
		Description: "Rollback a successful operation by opId (requires confirmToken from rollback_operation_preview). Restores from backup_path or removes created files.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in rollbackIn) (*mcp.CallToolResult, domain.RollbackResult, error) {
		params := map[string]any{"opId": in.OpID}
		if err := svc.ValidateMCPConfirmToken("rollback_operation", params, in.ConfirmToken); err != nil {
			return nil, domain.RollbackResult{}, err
		}
		result, err := svc.RollbackOperation(in.OpID)
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_subtitle_backups",
		Description: "List .bak.* sidecar backups under media roots (optional videoId scope, olderThanDays filter).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in listBackupsIn) (*mcp.CallToolResult, map[string]any, error) {
		list, err := svc.ListSubtitleBackups(in.VideoID, in.OlderThanDays)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{"backups": list, "count": len(list)}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "cleanup_subtitle_backups_preview",
		Description: "Dry-run backup cleanup and issue confirmToken. Prefer olderThanDays to avoid deleting recent rollback material.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in cleanupBackupsPreviewIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"olderThanDays": in.OlderThanDays, "paths": in.Paths}
		tok, err := svc.IssueMCPConfirmToken("cleanup_subtitle_backups", params)
		if err != nil {
			return nil, nil, err
		}
		preview, err := svc.CleanupSubtitleBackups(true, in.OlderThanDays, in.Paths)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{
			"preview":      preview,
			"confirmToken": tok.ConfirmToken,
			"expiresAt":    tok.ExpiresAt,
			"ttlSeconds":   tok.TTLSeconds,
		}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "cleanup_subtitle_backups",
		Description: "Delete subtitle .bak.* files (requires confirmToken from cleanup_subtitle_backups_preview with identical args).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in cleanupBackupsIn) (*mcp.CallToolResult, domain.CleanupBackupsResult, error) {
		params := map[string]any{"olderThanDays": in.OlderThanDays, "paths": in.Paths}
		if err := svc.ValidateMCPConfirmToken("cleanup_subtitle_backups", params, in.ConfirmToken); err != nil {
			return nil, domain.CleanupBackupsResult{}, err
		}
		result, err := svc.CleanupSubtitleBackups(false, in.OlderThanDays, in.Paths)
		return nil, result, err
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "clear_operation_logs_preview",
		Description: "Preview deleting operation logs older than keepDays (0=all). Issues confirmToken. Warning: clearing logs removes rollback indexes (disk .bak files remain).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in clearLogsPreviewIn) (*mcp.CallToolResult, map[string]any, error) {
		params := map[string]any{"keepDays": in.KeepDays}
		tok, err := svc.IssueMCPConfirmToken("clear_operation_logs", params)
		if err != nil {
			return nil, nil, err
		}
		n, err := svc.CountLogsOlderThanDays(in.KeepDays)
		if err != nil {
			return nil, nil, err
		}
		return nil, map[string]any{
			"wouldDelete":  n,
			"keepDays":     in.KeepDays,
			"confirmToken": tok.ConfirmToken,
			"expiresAt":    tok.ExpiresAt,
			"ttlSeconds":   tok.TTLSeconds,
			"warning":      "Clearing logs removes opId-based rollback indexes; .bak files on disk are not deleted.",
		}, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "clear_operation_logs",
		Description: "Delete operation logs older than keepDays (requires confirmToken from clear_operation_logs_preview).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in clearLogsIn) (*mcp.CallToolResult, domain.ClearLogsResult, error) {
		params := map[string]any{"keepDays": in.KeepDays}
		if err := svc.ValidateMCPConfirmToken("clear_operation_logs", params, in.ConfirmToken); err != nil {
			return nil, domain.ClearLogsResult{}, err
		}
		result, err := svc.ClearLogsOlderThanDays(in.KeepDays)
		return nil, result, err
	})
}
