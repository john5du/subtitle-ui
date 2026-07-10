package subhd

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

var (
	reTitlePageH1     = regexp.MustCompile(`(?is)<h1[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)`)
	rePackSectionHead = regexp.MustCompile(`(?is)bg-light[^"']*text-danger[^"']*"[^>]*>\s*合集\s*</div>`)
	reRelatedSeries   = regexp.MustCompile(`同系列作品`)
	reTitleRow        = regexp.MustCompile(`(?is)<div class="row pt-2 mb-2">`)
	reViewTextLink    = regexp.MustCompile(`(?is)class="view-text"[^>]*>\s*<a[^>]*href=['"]/a/([A-Za-z0-9]+)['"][^>]*>([^<]*)</a>`)
)

// TitlePage is a SubHD /d/{doubanId} media detail page.
type TitlePage struct {
	DoubanID string         `json:"doubanId"`
	Title    string         `json:"title,omitempty"`
	Packs    []SearchResult `json:"packs"`
}

// ListTitlePacks fetches /d/{doubanID} and returns only the 「合集」 section listings.
func (c *Client) ListTitlePacks(ctx context.Context, doubanID string) (*TitlePage, error) {
	if err := c.requireEnabled(); err != nil {
		return nil, err
	}
	doubanID = strings.TrimSpace(doubanID)
	if doubanID == "" || !isDigits(doubanID) {
		return nil, fmt.Errorf("%w: invalid douban id", ErrEmptyQuery)
	}
	body, err := c.getHTML(ctx, "/d/"+doubanID, c.baseURL+"/")
	if err != nil {
		return nil, err
	}
	page := parseTitlePage(body, doubanID)
	return page, nil
}

func parseTitlePage(html, doubanID string) *TitlePage {
	page := &TitlePage{
		DoubanID: strings.TrimSpace(doubanID),
		Packs:    []SearchResult{},
	}
	if m := reTitlePageH1.FindStringSubmatch(html); len(m) >= 2 {
		page.Title = cleanHTMLText(m[1])
	}
	section := extractPackSection(html)
	if section == "" {
		return page
	}
	page.Packs = parseTitlePackRows(section, page.DoubanID)
	return page
}

func extractPackSection(html string) string {
	loc := rePackSectionHead.FindStringIndex(html)
	if loc == nil {
		return ""
	}
	start := loc[1]
	rest := html[start:]

	// End at related series block if present.
	end := len(rest)
	if m := reRelatedSeries.FindStringIndex(rest); m != nil && m[0] < end {
		end = m[0]
	}
	return rest[:end]
}

func parseTitlePackRows(section, doubanID string) []SearchResult {
	parts := reTitleRow.Split(section, -1)
	if len(parts) <= 1 {
		// fallback: whole section as one blob if structure differs
		if item, ok := parseTitlePackCard(section, doubanID); ok {
			return []SearchResult{item}
		}
		return nil
	}
	out := make([]SearchResult, 0, len(parts)-1)
	seen := map[string]struct{}{}
	for _, part := range parts[1:] {
		item, ok := parseTitlePackCard(part, doubanID)
		if !ok {
			continue
		}
		if _, exists := seen[item.SID]; exists {
			continue
		}
		seen[item.SID] = struct{}{}
		out = append(out, item)
	}
	return out
}

func parseTitlePackCard(card, doubanID string) (SearchResult, bool) {
	// Prefer view-text link (version line on title page).
	sid, version := "", ""
	if m := reViewTextLink.FindStringSubmatch(card); len(m) >= 3 {
		sid = m[1]
		version = cleanHTMLText(m[2])
	}
	if sid == "" {
		if m := reSID.FindStringSubmatch(card); len(m) >= 2 {
			sid = m[1]
		}
	}
	if sid == "" {
		return SearchResult{}, false
	}
	if version == "" {
		if m := reTitleLink.FindStringSubmatch(card); len(m) >= 3 && m[1] == sid {
			version = cleanHTMLText(m[2])
		}
	}
	if version == "" {
		version = sid
	}

	sourceTag := ""
	if m := reSourceTag.FindStringSubmatch(card); len(m) >= 2 {
		sourceTag = cleanHTMLText(m[1])
	}

	var langs []string
	langSeen := map[string]struct{}{}
	for _, m := range reLangBold.FindAllStringSubmatch(card, -1) {
		if len(m) < 2 {
			continue
		}
		l := m[1]
		if _, ok := langSeen[l]; ok {
			continue
		}
		langSeen[l] = struct{}{}
		langs = append(langs, l)
	}

	format := ""
	if m := reFormat.FindStringSubmatch(card); len(m) >= 2 {
		format = strings.ToUpper(strings.TrimSpace(m[1]))
	}

	// On title page, downloads often appear as plain text-end number (col-2).
	downloads := ""
	if m := regexp.MustCompile(`(?is)text-end text-secondary">\s*(\d+)\s*<`).FindStringSubmatch(card); len(m) >= 2 {
		downloads = m[1]
	}
	if downloads == "" {
		for _, m := range reAlignTop.FindAllStringSubmatch(card, -1) {
			if len(m) < 2 {
				continue
			}
			v := cleanHTMLText(m[1])
			if isDigits(v) {
				downloads = v
				break
			}
		}
	}

	publisher := ""
	if m := rePublisher.FindStringSubmatch(card); len(m) >= 2 {
		publisher = cleanHTMLText(m[1])
	}

	return SearchResult{
		SID:         sid,
		Title:       version,
		Version:     version,
		Langs:       langs,
		Format:      format,
		SourceTag:   sourceTag,
		Downloads:   downloads,
		Publisher:   publisher,
		DoubanID:    doubanID,
		Installable: isInstallableFormat(format),
	}, true
}
