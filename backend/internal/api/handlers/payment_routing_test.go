package handlers

import (
	"testing"

	"github.com/uniq-chat/backend/internal/models"
)

func TestResolvePaymentProviderForCountry(t *testing.T) {
	settings := models.PaymentSettings{
		ActiveProvider:         models.PaymentProviderAbacatePay,
		StripeCountryCodes:     `["US","CA"]`,
		AsaasCountryCodes:      `["PT"]`,
		AbacatepayCountryCodes: `["BR"]`,
	}

	tests := []struct {
		name    string
		country string
		want    models.PaymentProvider
	}{
		{name: "routes Brazil to AbacatePay", country: "br", want: models.PaymentProviderAbacatePay},
		{name: "routes United States to Stripe", country: "US", want: models.PaymentProviderStripe},
		{name: "routes Portugal to Asaas", country: " pt ", want: models.PaymentProviderAsaas},
		{name: "falls back to active provider when no country rule matches", country: "ES", want: models.PaymentProviderAbacatePay},
		{name: "falls back to active provider when country is empty", country: "", want: models.PaymentProviderAbacatePay},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolvePaymentProviderForCountry(settings, tt.country); got != tt.want {
				t.Fatalf("resolvePaymentProviderForCountry(%q) = %q, want %q", tt.country, got, tt.want)
			}
		})
	}
}

func TestNormalizeCountryList(t *testing.T) {
	got := normalizeCountryList(`["br","US","br","usa","1"]`)
	want := []string{"BR", "US"}
	if len(got) != len(want) {
		t.Fatalf("normalizeCountryList length = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeCountryList[%d] = %q, want %q (%v)", i, got[i], want[i], got)
		}
	}
}
