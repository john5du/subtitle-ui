package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
)

// OpRecord is an extended operation log write.
type OpRecord struct {
	Action     string
	VideoID    string
	TargetPath string
	BackupPath string
	Status     string
	Message    string
	Source     string
	Tool       string
	OpGroup    string
	Meta       map[string]any
}

// OpAudit overrides source/tool for subsequent recordOp/recordOpEx on this call stack
// when passed via WithOpAudit into service methods.
type OpAudit struct {
	Source string
	Tool   string
}

type opAuditKey struct{}

// WithOpAudit attaches MCP/REST audit metadata to ctx for recordOp.
func WithOpAudit(ctx context.Context, source, tool string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, opAuditKey{}, OpAudit{Source: source, Tool: tool})
}

func opAuditFrom(ctx context.Context) OpAudit {
	if ctx == nil {
		return OpAudit{}
	}
	if a, ok := ctx.Value(opAuditKey{}).(OpAudit); ok {
		return a
	}
	return OpAudit{}
}

func (s *Service) ListLogsPage(page int, pageSize int) domain.OperationLogPage {
	return s.ListLogsPageFiltered(page, pageSize, domain.OperationLogFilter{})
}

func (s *Service) ListLogsPageFiltered(page int, pageSize int, filter domain.OperationLogFilter) domain.OperationLogPage {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = defaultLogPageSize
	}
	if pageSize > 200 {
		pageSize = 200
	}

	logs, total, err := s.store.ListLogsFiltered(page, pageSize, filter)
	if err != nil {
		return domain.OperationLogPage{
			Items:      []domain.OperationLog{},
			Total:      0,
			Page:       page,
			PageSize:   pageSize,
			TotalPages: 0,
		}
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}

	return domain.OperationLogPage{
		Items:      logs,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}
}

func (s *Service) ListLogs(limit int) []domain.OperationLog {
	if limit <= 0 {
		limit = 50
	}
	return s.ListLogsPage(1, limit).Items
}

func (s *Service) GetOperationLog(id string) (domain.OperationLog, error) {
	log, err := s.store.GetLog(id)
	if err != nil {
		if err == sql.ErrNoRows || strings.Contains(err.Error(), "no rows") {
			return domain.OperationLog{}, ErrNotFound
		}
		// sqlite driver may wrap no rows
		if errors.Is(err, sql.ErrNoRows) {
			return domain.OperationLog{}, ErrNotFound
		}
		return domain.OperationLog{}, err
	}
	return log, nil
}

func (s *Service) ClearLogs() error {
	if err := s.store.ClearLogs(); err != nil {
		s.recordOp("clear_logs", systemOperationVideoID, "", "", "error", err.Error())
		return err
	}
	s.recordOp("clear_logs", systemOperationVideoID, "", "", "ok", "operation logs cleared")
	return nil
}

// ClearLogsOlderThanDays deletes logs older than keepDays (minimum 1 day retained window for “older than”).
// keepDays=0 means delete all then write clear_logs marker (same as ClearLogs for full wipe via before=now).
func (s *Service) ClearLogsOlderThanDays(keepDays int) (domain.ClearLogsResult, error) {
	if keepDays < 0 {
		return domain.ClearLogsResult{}, fmt.Errorf("%w: keepDays must be >= 0", ErrBadRequest)
	}
	var before time.Time
	if keepDays == 0 {
		before = time.Now().UTC().Add(time.Second)
	} else {
		before = time.Now().UTC().AddDate(0, 0, -keepDays)
	}
	n, err := s.store.ClearLogsBefore(before)
	if err != nil {
		s.recordOpEx(OpRecord{
			Action:  "clear_logs",
			VideoID: systemOperationVideoID,
			Status:  "error",
			Message: err.Error(),
			Source:  domain.OpSourceSystem,
		})
		return domain.ClearLogsResult{}, err
	}
	s.recordOpEx(OpRecord{
		Action:  "clear_logs",
		VideoID: systemOperationVideoID,
		Status:  "ok",
		Message: fmt.Sprintf("deleted=%d keepDays=%d", n, keepDays),
		Source:  domain.OpSourceSystem,
		Meta:    map[string]any{"deleted": n, "keepDays": keepDays},
	})
	return domain.ClearLogsResult{Deleted: n}, nil
}

// CountLogsOlderThanDays returns how many logs would be deleted for keepDays.
func (s *Service) CountLogsOlderThanDays(keepDays int) (int, error) {
	if keepDays < 0 {
		return 0, fmt.Errorf("%w: keepDays must be >= 0", ErrBadRequest)
	}
	var before time.Time
	if keepDays == 0 {
		before = time.Now().UTC().Add(time.Second)
	} else {
		before = time.Now().UTC().AddDate(0, 0, -keepDays)
	}
	return s.store.CountLogsBefore(before)
}

// recordOp appends a domain operation log row for user-facing audit.
// Pass context via recordOpCtx when MCP/source attribution is needed.
func (s *Service) recordOp(action, videoID, targetPath, backupPath, status, message string) {
	s.recordOpEx(OpRecord{
		Action:     action,
		VideoID:    videoID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     status,
		Message:    message,
		Source:     domain.OpSourceREST,
	})
}

func (s *Service) recordOpCtx(ctx context.Context, action, videoID, targetPath, backupPath, status, message string) {
	audit := opAuditFrom(ctx)
	source := audit.Source
	if source == "" {
		source = domain.OpSourceREST
	}
	s.recordOpEx(OpRecord{
		Action:     action,
		VideoID:    videoID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     status,
		Message:    message,
		Source:     source,
		Tool:       audit.Tool,
	})
}

func (s *Service) recordOpExCtx(ctx context.Context, rec OpRecord) string {
	audit := opAuditFrom(ctx)
	if rec.Source == "" {
		if audit.Source != "" {
			rec.Source = audit.Source
		} else {
			rec.Source = domain.OpSourceREST
		}
	}
	if rec.Tool == "" {
		rec.Tool = audit.Tool
	}
	return s.recordOpEx(rec)
}

// RecordMCPOp records an operation originating from MCP (source=mcp).
func (s *Service) RecordMCPOp(action, videoID, targetPath, backupPath, status, message, tool string, meta map[string]any) string {
	return s.recordOpEx(OpRecord{
		Action:     action,
		VideoID:    videoID,
		TargetPath: targetPath,
		BackupPath: backupPath,
		Status:     status,
		Message:    message,
		Source:     domain.OpSourceMCP,
		Tool:       tool,
		Meta:       meta,
	})
}

// recordOpEx appends an extended operation log and returns its id (empty on failure).
func (s *Service) recordOpEx(rec OpRecord) string {
	videoID := rec.VideoID
	if videoID == "" {
		videoID = systemOperationVideoID
	}
	status := rec.Status
	if status == "" {
		status = "ok"
	}
	source := rec.Source
	if source == "" {
		source = domain.OpSourceREST
	}
	meta := ""
	if len(rec.Meta) > 0 {
		if raw, err := json.Marshal(rec.Meta); err == nil {
			meta = string(raw)
		}
	}
	seed := fmt.Sprintf("%s-%s-%s-%d", rec.Action, videoID, rec.TargetPath, time.Now().UnixNano())
	id := makeID(seed)
	_ = s.store.AppendLog(domain.OperationLog{
		ID:         id,
		Timestamp:  time.Now().UTC(),
		Action:     rec.Action,
		VideoID:    videoID,
		TargetPath: rec.TargetPath,
		BackupPath: rec.BackupPath,
		Status:     status,
		Message:    rec.Message,
		Source:     source,
		Tool:       rec.Tool,
		OpGroup:    rec.OpGroup,
		Meta:       meta,
	})
	return id
}
