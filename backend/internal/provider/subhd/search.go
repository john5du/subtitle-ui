package subhd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var (
	reCardSplit   = regexp.MustCompile(`(?i)<div class="bg-white shadow-sm rounded-3 mb-4">`)
	reSID         = regexp.MustCompile(`(?i)href=['"]/a/([A-Za-z0-9]+)['"]`)
	reTitleLink   = regexp.MustCompile(`(?i)href=['"]/a/([A-Za-z0-9]+)['"][^>]*>([^<]+)</a>`)
	reViewText    = regexp.MustCompile(`(?is)class="view-text[^"]*"[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+)`)
	reSourceTag   = regexp.MustCompile(`(?is)class="[^"]*text-white[^"]*"[^>]*>\s*([^<]+?)\s*<`)
	reLangBold    = regexp.MustCompile(`(?is)class="[^"]*fw-bold[^"]*"[^>]*>\s*(简体|繁体|英语|双语)\s*<`)
	reFormat      = regexp.MustCompile(`(?is)class="[^"]*text-secondary[^"]*"[^>]*>\s*(ASS|SRT|SUP|SSA|VTT|SUB)\s*<`)
	reAlignTop    = regexp.MustCompile(`(?is)class="align-text-top me-3"[^>]*>\s*([^<]+?)\s*<`)
	rePublisher   = regexp.MustCompile(`(?i)href=['"]/u/([^'"]+)['"]`)
	reDouban    = regexp.MustCompile(`(?i)douban/(\d+)`)
	reTotalPage = regexp.MustCompile(`共\s*(\d+)\s*条`)
)

// Search fetches and parses SubHD search results.
func (c *Client) Search(ctx context.Context, query string, page int) (*SearchPage, error) {
	if err := c.requireEnabled(); err != nil {
		return nil, err
	}
	if page < 1 {
		page = 1
	}
	enc, err := encodeSearchPath(query)
	if err != nil {
		return nil, err
	}
	path := "/search/" + enc
	if page > 1 {
		path = fmt.Sprintf("/search/%s/%d", enc, page)
	}

	body, err := c.getHTML(ctx, path, c.baseURL+"/")
	if err != nil {
		return nil, err
	}

	items := parseSearchHTML(body)
	if items == nil {
		items = []SearchResult{}
	}
	total := ""
	if m := reTotalPage.FindStringSubmatch(body); len(m) > 1 {
		total = m[1]
	}
	return &SearchPage{
		Query: strings.TrimSpace(query),
		Page:  page,
		Total: total,
		Items: items,
	}, nil
}

func (c *Client) getHTML(ctx context.Context, path, referer string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.absURL(path), nil)
	if err != nil {
		return "", wrapProvider(err)
	}
	c.setCommonHeaders(req, referer)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	res, err := c.client.Do(req)
	if err != nil {
		return "", wrapProvider(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return "", wrapProvider(err)
	}
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: search http %d", ErrProvider, res.StatusCode)
	}
	return string(data), nil
}

func parseSearchHTML(html string) []SearchResult {
	parts := reCardSplit.Split(html, -1)
	if len(parts) <= 1 {
		return nil
	}
	out := make([]SearchResult, 0, len(parts)-1)
	seen := make(map[string]struct{})
	for _, part := range parts[1:] {
		item, ok := parseSearchCard(part)
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

func parseSearchCard(card string) (SearchResult, bool) {
	sidMatch := reSID.FindStringSubmatch(card)
	if len(sidMatch) < 2 {
		return SearchResult{}, false
	}
	sid := sidMatch[1]

	title := ""
	version := ""
	// Prefer title from first /a/ link text; version from view-text
	if m := reTitleLink.FindStringSubmatch(card); len(m) >= 3 {
		if m[1] == sid {
			title = cleanHTMLText(m[2])
		}
	}
	// second /a/ often has version title too — use view-text
	if m := reViewText.FindStringSubmatch(card); len(m) >= 2 {
		version = cleanHTMLText(m[1])
	}
	// fallback: all title links for this sid
	if title == "" || version == "" {
		for _, m := range reTitleLink.FindAllStringSubmatch(card, -1) {
			if len(m) < 3 || m[1] != sid {
				continue
			}
			text := cleanHTMLText(m[2])
			if title == "" {
				title = text
			} else if version == "" && text != title {
				version = text
			}
		}
	}
	if version == "" {
		version = title
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

	size, downloads := "", ""
	aligns := reAlignTop.FindAllStringSubmatch(card, -1)
	// Card typically: size, downloads, datetime — size may be like 220k; downloads pure digits
	for _, m := range aligns {
		if len(m) < 2 {
			continue
		}
		v := cleanHTMLText(m[1])
		if v == "" {
			continue
		}
		if size == "" && looksLikeSize(v) {
			size = v
			continue
		}
		if downloads == "" && isDigits(v) {
			downloads = v
		}
	}
	// if only one numeric-ish field captured as downloads, ok
	if size == "" && len(aligns) >= 1 {
		// sometimes order differs; leave empty
	}

	publisher := ""
	if m := rePublisher.FindStringSubmatch(card); len(m) >= 2 {
		publisher = cleanHTMLText(m[1])
	}

	doubanID := ""
	if m := reDouban.FindStringSubmatch(card); len(m) >= 2 {
		doubanID = m[1]
	}

	return SearchResult{
		SID:         sid,
		Title:       title,
		Version:     version,
		Langs:       langs,
		Format:      format,
		SourceTag:   sourceTag,
		Size:        size,
		Downloads:   downloads,
		Publisher:   publisher,
		DoubanID:    doubanID,
		Installable: isInstallableFormat(format),
	}, true
}

func isInstallableFormat(format string) bool {
	switch strings.ToUpper(strings.TrimSpace(format)) {
	case "SRT", "ASS", "SSA", "VTT", "SUB", "":
		// empty: may be archive of installable files — allow attempt
		return true
	default:
		// SUP etc.
		return false
	}
}

func looksLikeSize(v string) bool {
	lower := strings.ToLower(v)
	if strings.HasSuffix(lower, "k") || strings.HasSuffix(lower, "m") || strings.HasSuffix(lower, "g") || strings.HasSuffix(lower, "b") {
		return true
	}
	// pure digits more likely download count
	return false
}

func isDigits(v string) bool {
	if v == "" {
		return false
	}
	for _, r := range v {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func cleanHTMLText(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", `"`)
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	s = strings.Join(strings.Fields(s), " ")
	return s
}
