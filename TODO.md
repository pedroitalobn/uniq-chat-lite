# Asaas Transparent Checkout Integration - TODO

## Tasks

### 1. Add Asaas payment check/status endpoint in asaas.go for FinalizeRegistration fallback
- [ ] Add `GetPaymentStatus` method to AsaasHandler to check payment via Asaas API
- [ ] This is needed so `FinalizeRegistration` can confirm payment when webhook hasn't fired

### 2. Implement Asaas fallback in PaymentHandler.FinalizeRegistration (payment.go)
- [ ] Add Asaas case in `FinalizeRegistration` that calls the new Asaas status check
- [ ] Should follow same pattern as Stripe's `confirmAndMaterializeFromAPI`

### 3. Update frontend checkout page to handle CPF input for Asaas and fix response field mapping
- [ ] Add CPF input field when Asaas is selected
- [ ] Fix API response field mapping (the API returns `checkout_type: "subscription"` not `"transparent"`)
- [ ] Wire up proper API call to `/v1/asaas/checkout`

### 4. Update payment success page to handle Asaas flow
- [ ] The success page currently only handles Stripe `session_id` and `payment_intent` params
- [ ] Need to support Asaas `subscription_id` param for auto-login

### 5. Verify router has all required Asaas routes
- [ ] Check `/v1/asaas/checkout`, `/v1/asaas/subscription`, `/v1/asaas/webhook` are registered