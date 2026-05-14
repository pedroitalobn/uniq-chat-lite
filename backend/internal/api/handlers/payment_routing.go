package handlers

import (
	"encoding/json"
	"strings"

	"github.com/uniq-chat/backend/internal/models"
)

func normalizeCountryCode(raw string) string {
	raw = strings.TrimSpace(strings.ToUpper(raw))
	var b strings.Builder
	for _, r := range raw {
		if r >= 'A' && r <= 'Z' {
			b.WriteRune(r)
		}
		if b.Len() == 2 {
			break
		}
	}
	if b.Len() != 2 {
		return ""
	}
	return b.String()
}

func inferCountryFromPhone(phone string) string {
	digits := strings.TrimLeft(strings.TrimSpace(phone), "+")
	switch {
	case strings.HasPrefix(digits, "55"):
		return "BR"
	case strings.HasPrefix(digits, "1"):
		return "US"
	default:
		return ""
	}
}

func normalizeCountryList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" {
		return nil
	}
	var arr []string
	if strings.HasPrefix(raw, "[") && json.Unmarshal([]byte(raw), &arr) == nil {
		return cleanCountryCodes(arr)
	}
	return cleanCountryCodes(strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\t' || r == ' '
	}))
}

func cleanCountryCodes(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		code := normalizeCountryCode(value)
		if code == "" || seen[code] {
			continue
		}
		seen[code] = true
		out = append(out, code)
	}
	return out
}

// splitCSV — helper pequeno usado pelas configs de billing methods.
func splitCSV(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(strings.ToLower(p))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func encodeCountryCodes(values []string) string {
	clean := cleanCountryCodes(values)
	if len(clean) == 0 {
		return "[]"
	}
	b, _ := json.Marshal(clean)
	return string(b)
}

func countryListContains(raw string, country string) bool {
	country = normalizeCountryCode(country)
	if country == "" {
		return false
	}
	for _, code := range normalizeCountryList(raw) {
		if code == country {
			return true
		}
	}
	return false
}

func resolvePaymentProviderForCountry(settings models.PaymentSettings, country string) models.PaymentProvider {
	active := settings.ActiveProvider
	if active == "" {
		active = models.PaymentProviderStripe
	}
	providers := []models.PaymentProvider{active, models.PaymentProviderStripe, models.PaymentProviderAsaas, models.PaymentProviderAbacatePay}
	seen := map[models.PaymentProvider]bool{}
	for _, provider := range providers {
		if seen[provider] {
			continue
		}
		seen[provider] = true
		switch provider {
		case models.PaymentProviderStripe:
			if countryListContains(settings.StripeCountryCodes, country) {
				return provider
			}
		case models.PaymentProviderAsaas:
			if countryListContains(settings.AsaasCountryCodes, country) {
				return provider
			}
		case models.PaymentProviderAbacatePay:
			if countryListContains(settings.AbacatepayCountryCodes, country) {
				return provider
			}
		}
	}
	return active
}
