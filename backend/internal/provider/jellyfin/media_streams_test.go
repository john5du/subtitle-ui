package jellyfin_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"subtitle-ui/backend/internal/provider/jellyfin"
)

func TestListMediaStreams(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/Items/item-1" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("Fields") != "MediaStreams" {
			t.Errorf("Fields=%q want MediaStreams", r.URL.Query().Get("Fields"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"Id": "item-1",
			"MediaStreams": []map[string]any{
				{"Index": 0, "Type": "Video", "Codec": "h264"},
				{"Index": 1, "Type": "Audio", "Codec": "aac", "Language": "eng"},
				{
					"Index": 2, "Type": "Subtitle", "Codec": "ass", "Language": "chi",
					"Title": "简体", "IsExternal": false, "IsTextSubtitleStream": true,
				},
				{
					"Index": 3, "Type": "Subtitle", "Codec": "subrip", "Language": "eng",
					"IsExternal": true, "IsTextSubtitleStream": true,
				},
				{
					"Index": 4, "Type": "Subtitle", "Codec": "pgssub", "Language": "jpn",
					"IsExternal": false, "IsTextSubtitleStream": false, "IsForced": true,
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := jellyfin.New(jellyfin.Options{
		Enabled: true, BaseURL: srv.URL, APIKey: "k", HTTPClient: srv.Client(),
	})
	streams, err := c.ListMediaStreams(context.Background(), "item-1")
	if err != nil {
		t.Fatalf("ListMediaStreams: %v", err)
	}
	if len(streams) != 5 {
		t.Fatalf("streams len=%d", len(streams))
	}

	embedded := jellyfin.EmbeddedSubtitleStreams(streams)
	if len(embedded) != 2 {
		t.Fatalf("embedded len=%d want 2", len(embedded))
	}
	if embedded[0].Language != "chi" || embedded[0].Codec != "ass" {
		t.Fatalf("track0=%+v", embedded[0])
	}
	if embedded[1].Language != "jpn" || !embedded[1].IsForced || embedded[1].IsTextSubtitle {
		t.Fatalf("track1=%+v", embedded[1])
	}
}

func TestListMediaStreamsDisabled(t *testing.T) {
	c := jellyfin.New(jellyfin.Options{Enabled: false})
	_, err := c.ListMediaStreams(context.Background(), "x")
	if !errors.Is(err, jellyfin.ErrDisabled) {
		t.Fatalf("got %v", err)
	}
}

func TestEmbeddedSubtitleStreamsEmpty(t *testing.T) {
	if got := jellyfin.EmbeddedSubtitleStreams(nil); len(got) != 0 {
		t.Fatalf("got %d", len(got))
	}
}
