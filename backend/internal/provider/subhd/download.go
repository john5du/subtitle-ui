package subhd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
		log.Printf("subhd prime token failed url=%s err=%v", truncateForLog(detailURL, 120), err)
		return wrapProvider(err)
	}
	c.setCommonHeaders(req, c.baseURL+"/")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	res, err := httpClient.Do(req)
	if err != nil {
		log.Printf("subhd prime token failed url=%s err=%v", truncateForLog(detailURL, 120), err)
		return wrapProvider(err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		log.Printf("subhd prime token failed url=%s http=%d", truncateForLog(detailURL, 120), res.StatusCode)
		return fmt.Errorf("%w: detail http %d", ErrProvider, res.StatusCode)
	}
	return nil
}

func (c *Client) resolveDownloadURL(ctx context.Context, httpClient *http.Client, sid, referer string) (string, error) {
	const maxCaptchaAttempts = 3
	capCode := ""
	var lastSubmittedCap string
	for attempt := 0; attempt < maxCaptchaAttempts; attempt++ {
		apiRes, err := c.postDownAPI(ctx, httpClient, sid, capCode, referer)
		if err != nil {
			return "", err
		}
		if apiRes.Message != "" && strings.Contains(apiRes.Message, "服务器内部错误") {
			log.Printf("subhd down api rate limited sid=%s attempt=%d reason=message message=%q",
				sid, attempt+1, truncateForLog(apiRes.Message, 120))
			c.limiter.markRateLimited()
			return "", ErrRateLimited
		}
		if apiRes.Error != "" && strings.Contains(strings.ToLower(apiRes.Error), "internal") {
			log.Printf("subhd down api rate limited sid=%s attempt=%d reason=error error=%q",
				sid, attempt+1, truncateForLog(apiRes.Error, 120))
			c.limiter.markRateLimited()
			return "", ErrRateLimited
		}
		if apiRes.Success && apiRes.Pass && apiRes.URL != nil && strings.TrimSpace(*apiRes.URL) != "" {
			if lastSubmittedCap != "" {
				log.Printf("subhd captcha ok sid=%s attempt=%d cap=%q", sid, attempt+1, lastSubmittedCap)
			}
			return strings.TrimSpace(*apiRes.URL), nil
		}
		msg := strings.TrimSpace(apiRes.Msg)
		if strings.Contains(msg, "临时页面已经失效") || strings.Contains(msg, "时间过长") {
			log.Printf("subhd download token expired sid=%s attempt=%d msg=%q submittedCap=%q; re-priming",
				sid, attempt+1, truncateForLog(msg, 120), capCode)
			// re-prime once
			if err := c.primeToken(ctx, httpClient, referer); err != nil {
				return "", err
			}
			// retry without counting as captcha failure fully
			capCode = ""
			lastSubmittedCap = ""
			continue
		}
		if !apiRes.Pass && looksLikeSVG(msg) {
			if lastSubmittedCap != "" {
				log.Printf("subhd captcha rejected sid=%s attempt=%d submittedCap=%q success=%v pass=%v msgBytes=%d",
					sid, attempt+1, lastSubmittedCap, apiRes.Success, apiRes.Pass, len(msg))
			}
			diag := solveSVGDetailed(msg)
			if diag.Code == "" {
				log.Printf("subhd captcha solve failed sid=%s attempt=%d reason=empty_code pathCount=%d pathLens=%v unknownLens=%v emptyChars=%d msgBytes=%d svgSample=%q",
					sid, attempt+1, diag.PathCount, diag.PathLens, diag.UnknownLens, diag.EmptyChars, len(msg), truncateForLog(msg, 200))
				return "", ErrCaptchaFailed
			}
			if diag.EmptyChars > 0 || len(diag.UnknownLens) > 0 {
				log.Printf("subhd captcha partial sid=%s attempt=%d cap=%q pathCount=%d pathLens=%v unknownLens=%v emptyChars=%d",
					sid, attempt+1, diag.Code, diag.PathCount, diag.PathLens, diag.UnknownLens, diag.EmptyChars)
			} else {
				log.Printf("subhd captcha solved sid=%s attempt=%d cap=%q pathCount=%d pathLens=%v",
					sid, attempt+1, diag.Code, diag.PathCount, diag.PathLens)
			}
			capCode = diag.Code
			lastSubmittedCap = diag.Code
			continue
		}
		if msg != "" {
			log.Printf("subhd download rejected sid=%s attempt=%d success=%v pass=%v error=%q message=%q msg=%q submittedCap=%q",
				sid, attempt+1, apiRes.Success, apiRes.Pass, apiRes.Error, apiRes.Message, truncateForLog(msg, 200), lastSubmittedCap)
			return "", fmt.Errorf("%w: %s", ErrProvider, msg)
		}
		log.Printf("subhd download rejected sid=%s attempt=%d success=%v pass=%v error=%q message=%q submittedCap=%q",
			sid, attempt+1, apiRes.Success, apiRes.Pass, apiRes.Error, apiRes.Message, lastSubmittedCap)
		return "", fmt.Errorf("%w: download api rejected request", ErrProvider)
	}
	log.Printf("subhd captcha failed sid=%s reason=max_attempts attempts=%d lastCap=%q", sid, maxCaptchaAttempts, lastSubmittedCap)
	return "", ErrCaptchaFailed
}

func truncateForLog(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func (c *Client) postDownAPI(ctx context.Context, httpClient *http.Client, sid, cap, referer string) (*downAPIResponse, error) {
	payload := map[string]string{"sid": sid, "cap": cap}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("subhd down api marshal failed sid=%s err=%v", sid, err)
		return nil, wrapProvider(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.absURL("/api/sub/down"), bytes.NewReader(body))
	if err != nil {
		log.Printf("subhd down api request failed sid=%s err=%v", sid, err)
		return nil, wrapProvider(err)
	}
	c.setCommonHeaders(req, referer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", c.baseURL)
	req.Header.Set("Accept", "application/json")

	res, err := httpClient.Do(req)
	if err != nil {
		log.Printf("subhd down api network failed sid=%s err=%v", sid, err)
		return nil, wrapProvider(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		log.Printf("subhd down api read failed sid=%s err=%v", sid, err)
		return nil, wrapProvider(err)
	}
	if res.StatusCode == http.StatusInternalServerError {
		log.Printf("subhd down api rate limited sid=%s http=%d bodySample=%q",
			sid, res.StatusCode, truncateForLog(string(data), 200))
		c.limiter.markRateLimited()
		return nil, ErrRateLimited
	}
	var parsed downAPIResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		log.Printf("subhd down api json failed sid=%s http=%d bodySample=%q err=%v",
			sid, res.StatusCode, truncateForLog(string(data), 200), err)
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("%w: down api http %d", ErrProvider, res.StatusCode)
		}
		return nil, wrapProvider(err)
	}
	if res.StatusCode != http.StatusOK && !parsed.Success {
		if res.StatusCode >= 500 {
			log.Printf("subhd down api rate limited sid=%s http=%d error=%q message=%q",
				sid, res.StatusCode, truncateForLog(parsed.Error, 120), truncateForLog(parsed.Message, 120))
			c.limiter.markRateLimited()
			return nil, ErrRateLimited
		}
		log.Printf("subhd down api http failed sid=%s http=%d success=%v pass=%v error=%q message=%q msg=%q",
			sid, res.StatusCode, parsed.Success, parsed.Pass,
			truncateForLog(parsed.Error, 120), truncateForLog(parsed.Message, 120), truncateForLog(parsed.Msg, 120))
	}
	return &parsed, nil
}

func (c *Client) fetchFile(ctx context.Context, httpClient *http.Client, fileURL, referer string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		log.Printf("subhd fetch file failed url=%s err=%v", redactURLForLog(fileURL), err)
		return nil, "", wrapProvider(err)
	}
	c.setCommonHeaders(req, referer)
	req.Header.Set("Accept", "*/*")

	res, err := httpClient.Do(req)
	if err != nil {
		log.Printf("subhd fetch file failed url=%s err=%v", redactURLForLog(fileURL), err)
		return nil, "", wrapProvider(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		log.Printf("subhd fetch file read failed url=%s err=%v", redactURLForLog(fileURL), err)
		return nil, "", wrapProvider(err)
	}
	if res.StatusCode != http.StatusOK {
		log.Printf("subhd fetch file failed url=%s http=%d bodyBytes=%d",
			redactURLForLog(fileURL), res.StatusCode, len(data))
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

// redactURLForLog keeps host+path for diagnostics without query tokens.
func redactURLForLog(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return truncateForLog(raw, 120)
	}
	u.RawQuery = ""
	u.Fragment = ""
	return truncateForLog(u.String(), 160)
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
