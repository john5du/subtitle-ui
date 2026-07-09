package app

import (
	"fmt"
	"strings"
	"time"

	"subtitle-ui/backend/internal/domain"
	"subtitle-ui/backend/internal/subtitle"
)

func (s *Service) GetSubtitleConversionConfig() (domain.SubtitleConversionConfig, error) {
	settings, err := s.store.GetAppSettings([]string{settingASSTemplate, settingSourceEncoding})
	if err != nil {
		return domain.SubtitleConversionConfig{}, err
	}

	template := subtitle.DefaultASSTemplate
	updatedAt := time.Time{}
	if setting, ok := settings[settingASSTemplate]; ok && strings.TrimSpace(setting.Value) != "" {
		template = setting.Value
		updatedAt = setting.UpdatedAt
	}

	sourceEncodingDefault := subtitle.DefaultSourceEncoding
	if setting, ok := settings[settingSourceEncoding]; ok && strings.TrimSpace(setting.Value) != "" {
		normalized, err := subtitle.NormalizeSourceEncoding(setting.Value)
		if err == nil {
			sourceEncodingDefault = normalized
			if setting.UpdatedAt.After(updatedAt) {
				updatedAt = setting.UpdatedAt
			}
		}
	}

	return domain.SubtitleConversionConfig{
		ASSTemplate:           template,
		DefaultASSTemplate:    subtitle.DefaultASSTemplate,
		SourceEncodingDefault: sourceEncodingDefault,
		UpdatedAt:             updatedAt,
	}, nil
}

func (s *Service) UpdateSubtitleConversionConfig(req domain.SubtitleConversionConfigUpdate) (domain.SubtitleConversionConfig, error) {
	template := strings.TrimSpace(req.ASSTemplate)
	if err := subtitle.ValidateASSTemplate(template); err != nil {
		return domain.SubtitleConversionConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}
	sourceEncodingDefault, err := subtitle.NormalizeSourceEncoding(req.SourceEncodingDefault)
	if err != nil {
		return domain.SubtitleConversionConfig{}, fmt.Errorf("%w: %s", ErrBadRequest, err.Error())
	}

	updatedAt := time.Now().UTC()
	err = s.store.SetAppSettings(map[string]string{
		settingASSTemplate:    template,
		settingSourceEncoding: sourceEncodingDefault,
	}, updatedAt)
	if err != nil {
		return domain.SubtitleConversionConfig{}, err
	}

	return domain.SubtitleConversionConfig{
		ASSTemplate:           template,
		DefaultASSTemplate:    subtitle.DefaultASSTemplate,
		SourceEncodingDefault: sourceEncodingDefault,
		UpdatedAt:             updatedAt,
	}, nil
}
