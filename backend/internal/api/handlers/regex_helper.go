package handlers

import (
	"regexp"
	"sync"
)

// regexCache evita re-compile do mesmo pattern em cada inbound.
var (
	regexCache   = map[string]*regexp.Regexp{}
	regexCacheMu sync.RWMutex
)

func compileRegex(pattern string) (*regexp.Regexp, error) {
	regexCacheMu.RLock()
	re, ok := regexCache[pattern]
	regexCacheMu.RUnlock()
	if ok {
		return re, nil
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	regexCacheMu.Lock()
	regexCache[pattern] = compiled
	regexCacheMu.Unlock()
	return compiled, nil
}
