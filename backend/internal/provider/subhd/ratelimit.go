package subhd

import (
	"sync"
	"time"
)

// limiter is a simple process-wide minimum-interval gate for download API calls.
type limiter struct {
	mu          sync.Mutex
	minInterval time.Duration
	last        time.Time
	backoffUntil time.Time
	backoffStep  time.Duration
	maxBackoff   time.Duration
}

func newLimiter(minInterval time.Duration) *limiter {
	if minInterval <= 0 {
		minInterval = 3 * time.Second
	}
	return &limiter{
		minInterval: minInterval,
		backoffStep: 30 * time.Second,
		maxBackoff:  10 * time.Minute,
	}
}

// wait blocks until the next download attempt is allowed.
func (l *limiter) wait() {
	l.mu.Lock()
	now := time.Now()
	var sleep time.Duration
	if now.Before(l.backoffUntil) {
		sleep = l.backoffUntil.Sub(now)
	}
	if !l.last.IsZero() {
		elapsed := now.Add(sleep).Sub(l.last)
		if elapsed < l.minInterval {
			extra := l.minInterval - elapsed
			if extra > sleep {
				sleep = extra
			}
		}
	}
	l.mu.Unlock()
	if sleep > 0 {
		time.Sleep(sleep)
	}
	l.mu.Lock()
	l.last = time.Now()
	l.mu.Unlock()
}

func (l *limiter) markRateLimited() {
	l.mu.Lock()
	defer l.mu.Unlock()
	step := l.backoffStep
	if step <= 0 {
		step = 30 * time.Second
	}
	// escalate from previous remaining window
	until := time.Now().Add(step)
	if l.backoffUntil.After(time.Now()) {
		// double remaining-ish by adding another step, capped
		next := l.backoffUntil.Add(step)
		if next.After(until) {
			until = next
		}
	}
	maxUntil := time.Now().Add(l.maxBackoff)
	if until.After(maxUntil) {
		until = maxUntil
	}
	l.backoffUntil = until
	if l.backoffStep < l.maxBackoff {
		l.backoffStep *= 2
		if l.backoffStep > l.maxBackoff {
			l.backoffStep = l.maxBackoff
		}
	}
}

func (l *limiter) markSuccess() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.backoffStep = 30 * time.Second
	l.backoffUntil = time.Time{}
}

func (l *limiter) blocked() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return time.Now().Before(l.backoffUntil)
}
