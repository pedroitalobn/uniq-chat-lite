# Asaas Transparent Checkout Integration - TODO

## Tasks

### 1. Add Asaas payment check/status endpoint in asaas.go for FinalizeRegistration fallback
- [x] Add `GetPaymentStatus` method to AsaasHandler to check payment via Asaas API
- [x] This is needed so `FinalizeRegistration` can confirm payment when webhook hasn't fired

### 2. Implement Asaas fallback in PaymentHandler.FinalizeRegistration (payment.go)
- [x] Add Asaas case in `FinalizeRegistration` that calls the new Asaas status check
- [x] Should follow same pattern as Stripe's `confirmAndMaterializeFromAPI`

### 3. Update frontend checkout page to handle CPF input for Asaas and fix response field mapping
- [x] Add CPF input field when Asaas is selected (TaxID field already exists in register/verify form)
- [x] Fix API response field mapping (the API returns `checkout_type: "subscription"` not `"transparent"`)
- [x] Wire up proper API call to `/v1/asaas/checkout`

### 4. Update payment success page to handle Asaas flow
- [x] The success page currently only handles Stripe `session_id` and `payment_intent` params
- [x] Need to support Asaas `subscription_id` param for auto-login

### 5. Verify router has all required Asaas routes
- [x] Check `/v1/asaas/checkout`, `/v1/asaas/subscription`, `/v1/asaas/webhook` are registered
