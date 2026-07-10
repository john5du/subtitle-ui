package subhd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"path"
	"strings"
)

type downAPIResponse struct {
	Success bool    `json:"success"`
	Pass    bool    `json:"pass"`
	Msg     string  `json:"msg"`
	URL     *string `json:"url"`
	Error   string  `json:"error"`
	Message string  `json:"message"`
}

// Download fetches a subtitle payload for sid (handles token cookie + captcha).
func (c *Client) Download(ctx context.Context, sid string) (*DownloadedFile, error) {
	if err := c.requireEnabled(); err != nil {
		return nil, err
	}
	sid = strings.TrimSpace(sid)
	if sid == "" {
		return nil, ErrEmptySID
	}

	c.limiter.wait()

	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, wrapProvider(err)
	}
	httpClient := &http.Client{
		Timeout:   c.client.Timeout,
		Jar:       jar,
		Transport: c.client.Transport,
	}

	detailURL := c.absURL("/a/" + sid)
	if err := c.primeToken(ctx, httpClient, detailURL); err != nil {
		return nil, err
	}

	fileURL, err := c.resolveDownloadURL(ctx, httpClient, sid, detailURL)
	if err != nil {
		return nil, err
	}

	data, fileName, err := c.fetchFile(ctx, httpClient, fileURL, detailURL)
	if err != nil {
		return nil, err
	}
	c.limiter.markSuccess()
	if fileName == "" {
		fileName = path.Base(fileURL)
	}
	return &DownloadedFile{
		SID:      sid,
		URL:      fileURL,
		FileName: fileName,
		Data:     data,
	}, nil
}

func (c *Client) primeToken(ctx context.Context, httpClient *http.Client, detailURL string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, detailURL, nil)
	if err != nil {
		return wrapProvider(err)
	}
	c.setCommonHeaders(req, c.baseURL+"/")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	res, err := httpClient.Do(req)
	if err != nil {
		return wrapProvider(err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: detail http %d", ErrProvider, res.StatusCode)
	}
	return nil
}

func (c *Client) resolveDownloadURL(ctx context.Context, httpClient *http.Client, sid, referer string) (string, error) {
	const maxCaptchaAttempts = 3
	capCode := ""
	for attempt := 0; attempt < maxCaptchaAttempts; attempt++ {
		apiRes, err := c.postDownAPI(ctx, httpClient, sid, capCode, referer)
		if err != nil {
			return "", err
		}
		if apiRes.Message != "" && strings.Contains(apiRes.Message, "服务器内部错误") {
			c.limiter.markRateLimited()
			return "", ErrRateLimited
		}
		if apiRes.Error != "" && strings.Contains(strings.ToLower(apiRes.Error), "internal") {
			c.limiter.markRateLimited()
			return "", ErrRateLimited
		}
		if apiRes.Success && apiRes.Pass && apiRes.URL != nil && strings.TrimSpace(*apiRes.URL) != "" {
			return strings.TrimSpace(*apiRes.URL), nil
		}
		msg := strings.TrimSpace(apiRes.Msg)
		if strings.Contains(msg, "临时页面已经失效") || strings.Contains(msg, "时间过长") {
			// re-prime once
			if err := c.primeToken(ctx, httpClient, referer); err != nil {
				return "", err
			}
			// retry without counting as captcha failure fully
			continue
		}
		if !apiRes.Pass && looksLikeSVG(msg) {
			code := SolveSVG(msg)
			if code == "" {
				return "", ErrCaptchaFailed
			}
			capCode = code
			continue
		}
		if msg != "" {
			return "", fmt.Errorf("%w: %s", ErrProvider, msg)
		}
		return "", fmt.Errorf("%w: download api rejected request", ErrProvider)
	}
	return "", ErrCaptchaFailed
}

func (c *Client) postDownAPI(ctx context.Context, httpClient *http.Client, sid, cap, referer string) (*downAPIResponse, error) {
	payload := map[string]string{"sid": sid, "cap": cap}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, wrapProvider(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.absURL("/api/sub/down"), bytes.NewReader(body))
	if err != nil {
		return nil, wrapProvider(err)
	}
	c.setCommonHeaders(req, referer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", c.baseURL)
	req.Header.Set("Accept", "application/json")

	res, err := httpClient.Do(req)
	if err != nil {
		return nil, wrapProvider(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return nil, wrapProvider(err)
	}
	if res.StatusCode == http.StatusInternalServerError {
		c.limiter.markRateLimited()
		return nil, ErrRateLimited
	}
	var parsed downAPIResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("%w: down api http %d", ErrProvider, res.StatusCode)
		}
		return nil, wrapProvider(err)
	}
	if res.StatusCode != http.StatusOK && !parsed.Success {
		if res.StatusCode >= 500 {
			c.limiter.markRateLimited()
			return nil, ErrRateLimited
		}
	}
	return &parsed, nil
}

func (c *Client) fetchFile(ctx context.Context, httpClient *http.Client, fileURL, referer string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		return nil, "", wrapProvider(err)
	}
	c.setCommonHeaders(req, referer)
	req.Header.Set("Accept", "*/*")

	res, err := httpClient.Do(req)
	if err != nil {
		return nil, "", wrapProvider(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return nil, "", wrapProvider(err)
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("%w: file http %d", ErrProvider, res.StatusCode)
	}
	name := filenameFromDisposition(res.Header.Get("Content-Disposition"))
	if name == "" {
		if u, err := url.Parse(fileURL); err == nil {
			name = path.Base(u.Path)
		}
	}
	return data, name, nil
}

func filenameFromDisposition(cd string) string {
	if cd == "" {
		return ""
	}
	_, params, err := mime.ParseMediaType(cd)
	if err != nil {
		return ""
	}
	if name := params["filename"]; name != "" {
		return name
	}
	return ""
}

func looksLikeSVG(s string) bool {
	lower := strings.ToLower(s)
	return strings.Contains(lower, "<svg") || strings.Contains(lower, `d="`)
}
