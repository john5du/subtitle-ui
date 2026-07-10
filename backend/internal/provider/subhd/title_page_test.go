package subhd

import (
	"os"
	"strings"
	"testing"
)

func TestParseTitlePagePacksOnly(t *testing.T) {
	data, err := os.ReadFile("testdata/title_page_packs.html")
	if err != nil {
		t.Fatal(err)
	}
	page := parseTitlePage(string(data), "35908203")
	if page.DoubanID != "35908203" {
		t.Fatalf("douban %q", page.DoubanID)
	}
	if len(page.Packs) != 4 {
		t.Fatalf("want 4 packs, got %d: %+v", len(page.Packs), page.Packs)
	}
	// Must not include single-episode S01E09 from the episode section above packs.
	for _, p := range page.Packs {
		if strings.Contains(strings.ToUpper(p.Version), "S01E") {
			t.Fatalf("pack list leaked episode entry: %+v", p)
		}
	}
	if page.Packs[0].SID != "gbuvsH" {
		t.Fatalf("first pack sid %q", page.Packs[0].SID)
	}
	if !strings.Contains(page.Packs[0].Version, "全9集") {
		t.Fatalf("version %q", page.Packs[0].Version)
	}
	if !page.Packs[0].Installable {
		t.Fatal("ASS pack should be installable")
	}
	// Second pack has 合集 in title
	found := false
	for _, p := range page.Packs {
		if p.SID == "HZEiWV" {
			found = true
			if !strings.Contains(p.Version, "合集") {
				t.Fatalf("HZEiWV version %q", p.Version)
			}
		}
	}
	if !found {
		t.Fatal("missing HZEiWV")
	}
}

func TestParseTitlePageNoPackSection(t *testing.T) {
	html := `<html><body>
<div class="px-3 py-1 f12 bg-light bg-gradient text-danger fw-bold">第 1 集</div>
<div class="row pt-2 mb-2"><div class="view-text"><a href="/a/abc123">Show.S01E01.srt</a></div></div>
<div class="pt-3 mb-3">同系列作品</div>
</body></html>`
	page := parseTitlePage(html, "1")
	if len(page.Packs) != 0 {
		t.Fatalf("want empty packs, got %+v", page.Packs)
	}
}

func TestExtractDoubanIDFromHTML(t *testing.T) {
	html := `<a href="/d/35908203"><img src="https://img.subhd.me/poster/douban/35908203_600.webp"></a>`
	if got := ExtractDoubanIDFromHTML(html); got != "35908203" {
		t.Fatalf("got %q", got)
	}
}

func TestParseSearchCardDoubanFromDLink(t *testing.T) {
	card := `
<div class="row">
  <div class="col-2"><a href="/d/35575567"><img src="x"></a></div>
  <div class="col-lg-10">
    <a href='/a/bqpxFZ'>沙丘2</a>
    <div class="view-text"><a href='/a/bqpxFZ'>ver</a></div>
    <span class="p-1 text-secondary">ASS</span>
  </div>
</div>`
	item, ok := parseSearchCard(card)
	if !ok || item.DoubanID != "35575567" {
		t.Fatalf("got %+v ok=%v", item, ok)
	}
}
