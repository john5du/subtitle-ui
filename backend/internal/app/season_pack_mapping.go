package app

import (
	"fmt"
	"path"
	"strings"

	"subtitle-ui/backend/internal/archive"
	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

func seKey(s, e int) string {
	return fmt.Sprintf("S%02dE%02d", s, e)
}

func detectLanguageType(name string) string {
	return subtitle.DetectLanguageType(name)
}

func entryFormat(name string) string {
	return strings.ToLower(path.Ext(name))
}

func choosePreferredArchiveEntry(entries []archive.Entry, langPref, formatPref string) archive.Entry {
	pool := append([]archive.Entry(nil), entries...)
	if formatPref != "" && formatPref != "any" {
		var byFormat []archive.Entry
		for _, e := range pool {
			if entryFormat(e.FileName) == formatPref {
				byFormat = append(byFormat, e)
			}
		}
		if len(byFormat) > 0 {
			pool = byFormat
		}
	}
	if langPref != "" && langPref != "any" {
		var byLang []archive.Entry
		for _, e := range pool {
			if detectLanguageType(e.Path+" "+e.FileName) == langPref {
				byLang = append(byLang, e)
			}
		}
		if len(byLang) > 0 {
			pool = byLang
		} else if langPref == "bilingual" {
			// Fall back through simplified → any when no bilingual entry.
			var simplified []archive.Entry
			for _, e := range pool {
				if detectLanguageType(e.Path+" "+e.FileName) == "simplified" {
					simplified = append(simplified, e)
				}
			}
			if len(simplified) > 0 {
				pool = simplified
			}
		}
	} else {
		// Prefer bilingual when preference is unrestricted.
		var bilingual []archive.Entry
		for _, e := range pool {
			if detectLanguageType(e.Path+" "+e.FileName) == "bilingual" {
				bilingual = append(bilingual, e)
			}
		}
		if len(bilingual) > 0 {
			pool = bilingual
		}
	}
	if len(pool) == 0 {
		return archive.Entry{}
	}
	best := pool[0]
	for _, e := range pool[1:] {
		if e.Path < best.Path {
			best = e
		}
	}
	return best
}

func suggestSeasonPackMappings(
	videos []domain.Video,
	entries []archive.Entry,
	langPref, formatPref, label string,
	skipExisting bool,
	defaultSeason int,
) ([]SubHDSeasonSuggestedMapping, []string) {
	notices := make([]string, 0)
	// Group entries by SxxExx (episode-only names use defaultSeason when set).
	bySE := map[string][]archive.Entry{}
	unparsed := 0
	for _, e := range entries {
		se := parseSeasonEpisodeNumbersWithDefault(e.Path+" "+e.FileName, defaultSeason)
		if se == nil {
			unparsed++
			continue
		}
		// When scoped to a season, ignore pack entries that clearly belong to another season.
		if defaultSeason > 0 && se.Season != defaultSeason {
			continue
		}
		key := seKey(se.Season, se.Episode)
		bySE[key] = append(bySE[key], e)
	}
	if unparsed > 0 {
		notices = append(notices, fmt.Sprintf("%d archive entries have no detectable episode number", unparsed))
	}

	// Index videos by SxxExx; optionally keep only the selected season.
	videosBySE := map[string][]domain.Video{}
	for _, v := range videos {
		se := parseSeasonEpisodeNumbersWithDefault(v.FileName+" "+v.Title, defaultSeason)
		if se == nil {
			continue
		}
		if defaultSeason > 0 && se.Season != defaultSeason {
			continue
		}
		key := seKey(se.Season, se.Episode)
		videosBySE[key] = append(videosBySE[key], v)
	}

	suggested := make([]SubHDSeasonSuggestedMapping, 0)
	for key, vids := range videosBySE {
		entryList := bySE[key]
		if len(entryList) == 0 {
			continue
		}
		chosen := choosePreferredArchiveEntry(entryList, langPref, formatPref)
		if chosen.Path == "" {
			continue
		}
		// Prefer first video for that episode (stable by path)
		video := vids[0]
		for _, v := range vids[1:] {
			if v.Path < video.Path {
				video = v
			}
		}
		entryLabel := label
		if entryLabel == "" {
			entryLabel = inferLabelFromName(chosen.Path + " " + chosen.FileName)
		}
		if skipExisting && videoHasBilingualSubtitle(video) {
			suggested = append(suggested, SubHDSeasonSuggestedMapping{
				VideoID:      video.ID,
				ArchiveEntry: chosen.Path,
				Label:        entryLabel,
				Skipped:      true,
				Reason:       "already has bilingual subtitle",
			})
			continue
		}
		if skipExisting && len(video.Subtitles) > 0 && !subtitle.IsBilingualLanguage(entryLabel) {
			// Mono install into a video that already has any track — skip to avoid clutter.
			suggested = append(suggested, SubHDSeasonSuggestedMapping{
				VideoID:      video.ID,
				ArchiveEntry: chosen.Path,
				Label:        entryLabel,
				Skipped:      true,
				Reason:       "already has subtitles",
			})
			continue
		}
		suggested = append(suggested, SubHDSeasonSuggestedMapping{
			VideoID:      video.ID,
			ArchiveEntry: chosen.Path,
			Label:        entryLabel,
		})
	}

	if len(suggested) == 0 {
		notices = append(notices, "no episode mappings could be auto-suggested")
	}
	return suggested, notices
}

func inferLabelFromName(name string) string {
	return inferSubtitleLanguageLabel(name)
}

