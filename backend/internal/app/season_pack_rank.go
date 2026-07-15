package app

import (
	"fmt"
	"strings"

	"subtitle-ui/backend/internal/provider/subhd"
)

func pickDoubanIDFromSearch(items []subhd.SearchResult, query string, season int) string {
	type scored struct {
		id    string
		score int
	}
	counts := map[string]int{}
	best := scored{}
	qLower := strings.ToLower(query)
	for _, item := range items {
		id := strings.TrimSpace(item.DoubanID)
		if id == "" {
			continue
		}
		counts[id]++
		score := counts[id] * 2
		text := strings.ToLower(item.Title + " " + item.Version)
		if season >= 0 {
			token := fmt.Sprintf("s%02d", season)
			tokenAlt := fmt.Sprintf("s%d", season)
			if strings.Contains(text, token) || strings.Contains(text, tokenAlt) {
				score += 5
			}
			// Chinese season markers
			if strings.Contains(item.Title, fmt.Sprintf("第%d季", season)) ||
				strings.Contains(item.Title, fmt.Sprintf("第%02d季", season)) ||
				strings.Contains(item.Title, "第一季") && season == 1 {
				score += 4
			}
		}
		// Prefer titles overlapping query tokens
		for _, part := range strings.Fields(qLower) {
			if len(part) >= 3 && strings.Contains(text, part) {
				score++
			}
		}
		if score > best.score || (score == best.score && (best.id == "" || id < best.id)) {
			best = scored{id: id, score: score}
		}
	}
	if best.id != "" {
		return best.id
	}
	// majority vote fallback
	var majID string
	majN := 0
	for id, n := range counts {
		if n > majN || (n == majN && (majID == "" || id < majID)) {
			majID = id
			majN = n
		}
	}
	return majID
}

func sortPacksForSeason(items []subhd.SearchResult, season int) []subhd.SearchResult {
	if len(items) <= 1 {
		return items
	}
	type ranked struct {
		item  subhd.SearchResult
		score int
	}
	rankedItems := make([]ranked, 0, len(items))
	for _, item := range items {
		rankedItems = append(rankedItems, ranked{item: item, score: ScoreSubHDSeasonPack(item, season)})
	}
	// simple insertion sort by score desc
	for i := 1; i < len(rankedItems); i++ {
		j := i
		for j > 0 && rankedItems[j].score > rankedItems[j-1].score {
			rankedItems[j], rankedItems[j-1] = rankedItems[j-1], rankedItems[j]
			j--
		}
	}
	out := make([]subhd.SearchResult, len(rankedItems))
	for i, r := range rankedItems {
		out[i] = r.item
	}
	return out
}

// ScoreSubHDSeasonPack ranks a search result as a likely season pack (higher is better).
func ScoreSubHDSeasonPack(item subhd.SearchResult, season int) int {
	if !item.Installable {
		return -1000
	}
	text := strings.ToLower(item.Title + " " + item.Version + " " + item.Format)
	score := 0
	for _, lang := range item.Langs {
		l := strings.ToLower(lang)
		if strings.Contains(l, "简") || strings.Contains(l, "双") || strings.Contains(l, "中") {
			score += 3
		}
		if strings.Contains(l, "英") {
			score += 1
		}
	}
	packHints := []string{"合集", "整季", "pack", "complete", "season", "全集"}
	for _, h := range packHints {
		if strings.Contains(text, h) || strings.Contains(item.Title, h) || strings.Contains(item.Version, h) {
			score += 4
		}
	}
	if season >= 0 {
		token := fmt.Sprintf("s%02d", season)
		tokenAlt := fmt.Sprintf("s%d", season)
		if strings.Contains(text, token) || strings.Contains(text, tokenAlt) {
			score += 5
		}
		// Penalize clear single-episode markers for other episodes.
		if reSE.MatchString(text) && !strings.Contains(text, "合集") && !strings.Contains(text, "pack") {
			score -= 2
		}
	}
	format := strings.ToLower(strings.TrimSpace(item.Format))
	switch format {
	case "", "zip", "rar", "7z":
		score += 2
	case "ass", "ssa", "srt":
		score += 1
	case "sup":
		score -= 5
	}
	return score
}
