package jellyfin

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"strings"
)

// ReportMediaUpdated notifies Jellyfin that media paths changed.
func (c *Client) ReportMediaUpdated(ctx context.Context, paths []string) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	updates := make([]mediaUpdatePath, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		mapped := c.MapPath(p)
		if _, ok := seen[mapped]; ok {
			continue
		}
		seen[mapped] = struct{}{}
		updates = append(updates, mediaUpdatePath{
			Path:       mapped,
			UpdateType: "Modified",
		})
	}
	if len(updates) == 0 {
		return fmt.Errorf("no paths to report")
	}
	body := mediaUpdateInfo{Updates: updates}
	return c.postJSON(ctx, "/Library/Media/Updated", body, nil)
}

// RefreshItem queues a ValidationOnly metadata refresh for one item.
func (c *Client) RefreshItem(ctx context.Context, itemID string) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return fmt.Errorf("item id required")
	}
	q := url.Values{}
	q.Set("metadataRefreshMode", "ValidationOnly")
	q.Set("imageRefreshMode", "None")
	return c.postJSON(ctx, "/Items/"+url.PathEscape(itemID)+"/Refresh?"+q.Encode(), nil, nil)
}

// NotifyVideoChanged reports a video path change; falls back to item refresh.
func (c *Client) NotifyVideoChanged(ctx context.Context, localVideoPath string) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	localVideoPath = strings.TrimSpace(localVideoPath)
	if localVideoPath == "" {
		return fmt.Errorf("empty video path")
	}
	if err := c.ReportMediaUpdated(ctx, []string{localVideoPath}); err == nil {
		return nil
	} else {
		log.Printf("jellyfin Media/Updated failed path=%s err=%v; trying Items/Refresh", localVideoPath, err)
		mediaErr := err
		itemID, findErr := c.FindItemIDByPath(ctx, localVideoPath)
		if findErr != nil {
			return fmt.Errorf("media updated: %v; find item: %w", mediaErr, findErr)
		}
		if err := c.RefreshItem(ctx, itemID); err != nil {
			return fmt.Errorf("media updated: %v; refresh %s: %w", mediaErr, itemID, err)
		}
		return nil
	}
}

type mediaUpdateInfo struct {
	Updates []mediaUpdatePath `json:"Updates"`
}

type mediaUpdatePath struct {
	Path       string `json:"Path"`
	UpdateType string `json:"UpdateType"`
}
