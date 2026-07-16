import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import {
  CONSENT_VERSION,
  PRODUCT_NAME,
  PRODUCT_PRICE_CENTS,
  type OrderFormData,
  validateOrderForm,
  hasOrderFormErrors,
} from "../shared/order.ts";

process.env.VERCEL = "1";
process.env.GEMINI_API_KEY = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_123";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
process.env.OWNER_EMAIL = "owner@example.com";
process.env.SMTP_HOST = "smtp.example.com";
process.env.SMTP_USER = "smtp-user";
process.env.SMTP_PASS = "smtp-pass";
process.env.APP_URL = "https://example.com";

const validOrder: OrderFormData = {
  budget: "25000",
  brand: "Volkswagen",
  model: "Golf",
  maxMileage: "80000",
  bodyType: "Kombi",
  transmission: "Automatik",
  drive: "Frontantrieb",
  accidentFree: "Ja",
  color: "Grau",
  notes: "Alltagstauglich, sparsam, gute Historie.",
  email: "kunde@example.com",
  acceptTerms: true,
  startBeforeWithdrawal: true,
  acknowledgeWithdrawalLoss: true,
};

test("shared validator accepts a complete premium order", () => {
  const errors = validateOrderForm(validOrder);

  assert.equal(hasOrderFormErrors(errors), false);
  assert.deepEqual(errors, {});
});

test("shared validator rejects missing legal consents and invalid choices", () => {
  const errors = validateOrderForm({
    ...validOrder,
    transmission: "egal",
    acceptTerms: false,
    startBeforeWithdrawal: false,
    acknowledgeWithdrawalLoss: false,
  });

  assert.equal(errors.transmission, "Bitte Getriebe auswählen.");
  assert.equal(errors.acceptTerms, "Bitte Pflichtinformation bestätigen.");
  assert.equal(errors.startBeforeWithdrawal, "Bitte vorzeitigen Leistungsbeginn ausdrücklich bestätigen.");
  assert.equal(
    errors.acknowledgeWithdrawalLoss,
    "Bitte Kenntnis vom möglichen Erlöschen des Widerrufsrechts bestätigen.",
  );
});

test("backend order normalization trims text and metadata stores criteria and consents", async () => {
  const { buildOrderMetadata, normalizeOrderFormData, validateAndNormalizeOrder } = await import("../api/index.ts");
  const normalized = normalizeOrderFormData({
    ...validOrder,
    email: "  KUNDE@EXAMPLE.COM  ",
    brand: "  Volkswagen  ",
    notes: "  Bitte nur gepflegte Fahrzeuge.  ",
  });

  assert.equal(normalized.email, "kunde@example.com");
  assert.equal(normalized.brand, "Volkswagen");
  assert.equal(normalized.notes, "Bitte nur gepflegte Fahrzeuge.");

  const result = validateAndNormalizeOrder(normalized);
  assert.equal(result.valid, true);

  const metadata = buildOrderMetadata(normalized, "2026-07-13T12:00:00.000Z");
  assert.equal(metadata.service, PRODUCT_NAME);
  assert.equal(metadata.price_eur, String(PRODUCT_PRICE_CENTS / 100));
  assert.equal(metadata.email, "kunde@example.com");
  assert.equal(metadata.brand, "Volkswagen");
  assert.equal(metadata.model, "Golf");
  assert.equal(metadata.acceptTerms, "true");
  assert.equal(metadata.startBeforeWithdrawal, "true");
  assert.equal(metadata.acknowledgeWithdrawalLoss, "true");
  assert.equal(metadata.consent_version, CONSENT_VERSION);
  assert.equal(metadata.ordered_at, "2026-07-13T12:00:00.000Z");
});

test("backend withdrawal normalization accepts only Stripe checkout references", async () => {
  const { normalizeWithdrawalInput } = await import("../api/index.ts");

  assert.deepEqual(normalizeWithdrawalInput({
    name: " Max Mustermann ",
    email: " MAX@EXAMPLE.COM ",
    reference: "cs_test_1234567890ABCDEF",
    declaration: "Hiermit widerrufe ich meinen Vertrag.",
  }).data, {
    name: "Max Mustermann",
    email: "max@example.com",
    reference: "cs_test_1234567890ABCDEF",
    declaration: "Hiermit widerrufe ich meinen Vertrag.",
  });

  assert.equal(normalizeWithdrawalInput({
    name: "Max Mustermann",
    email: "max@example.com",
    reference: "ORDER-2026-0001",
    declaration: "Hiermit widerrufe ich meinen Vertrag.",
  }).error, "Widerruf konnte nicht verarbeitet werden.");

  assert.equal(normalizeWithdrawalInput({
    name: "",
    email: "nope",
    reference: "x",
    declaration: "",
  }).error, "Widerruf konnte nicht verarbeitet werden.");
});

test("backend safe session projection excludes criteria metadata", async () => {
  const { buildSafeCheckoutSessionResponse, isPaidCompleteSession } = await import("../api/index.ts");
  const session = {
    id: "cs_test_1234567890",
    customer_email: "kunde@example.com",
    customer_details: null,
    amount_total: 4900,
    currency: "eur",
    status: "complete" as const,
    payment_status: "paid" as const,
    metadata: {
      service: PRODUCT_NAME,
      notes: "private wishes",
      budget: "25000",
    },
  };

  assert.equal(isPaidCompleteSession(session), true);
  assert.deepEqual(buildSafeCheckoutSessionResponse(session as never), {
    reference: "cs_test_1234567890",
    amount: 4900,
    currency: "eur",
    status: "complete",
    paymentStatus: "paid",
    product: PRODUCT_NAME,
  });
});

test("vehicle analysis accepts bounded text input only", async () => {
  const { normalizeVehicleAnalysisInput } = await import("../api/index.ts");

  assert.deepEqual(normalizeVehicleAnalysisInput("  BMW M3 (G80)  "), {
    value: "BMW M3 (G80)",
    cacheKey: "bmw m3 (g80)",
  });
  assert.equal(normalizeVehicleAnalysisInput(" ").error, "Bitte gib ein Automodell ein.");
  assert.equal(normalizeVehicleAnalysisInput({ model: "BMW" }).error, "Bitte gib ein gültiges Automodell ein.");
  assert.equal(normalizeVehicleAnalysisInput("A".repeat(121)).error, "Bitte beschränke die Anfrage auf 120 Zeichen.");
});

test("signed checkout webhooks persist a new event before acknowledging it", async (t) => {
  const { default: app, setCheckoutPostProcessorForTests, setWebhookOutboxForTests } = await import("../api/index.ts");
  const reservations: { eventId: string; sessionId: string }[] = [];
  setWebhookOutboxForTests({
    async reserve(eventId, sessionId) {
      reservations.push({ eventId, sessionId });
      return "created";
    },
    async updateStatus() {},
  });
  setCheckoutPostProcessorForTests(async () => {});
  t.after(() => setWebhookOutboxForTests());
  t.after(() => setCheckoutPostProcessorForTests());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const payload = JSON.stringify({
    id: "evt_test_immediate_ack",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_immediateack" } },
  });
  const signature = new Stripe(process.env.STRIPE_SECRET_KEY!).webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });

  const response = await fetch(`http://127.0.0.1:${address.port}/api/stripe-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
  assert.deepEqual(reservations, [{ eventId: "evt_test_immediate_ack", sessionId: "cs_test_immediateack" }]);
});

test("duplicate checkout events are acknowledged without a second processing reservation", async (t) => {
  const { default: app, setCheckoutPostProcessorForTests, setWebhookOutboxForTests } = await import("../api/index.ts");
  const seen = new Set<string>();
  let reserveCalls = 0;
  setWebhookOutboxForTests({
    async reserve(eventId) {
      reserveCalls += 1;
      if (seen.has(eventId)) return "duplicate";
      seen.add(eventId);
      return "created";
    },
    async updateStatus() {},
  });
  setCheckoutPostProcessorForTests(async () => {});
  t.after(() => setWebhookOutboxForTests());
  t.after(() => setCheckoutPostProcessorForTests());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const payload = JSON.stringify({
    id: "evt_test_duplicate",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_duplicate" } },
  });
  const signature = new Stripe(process.env.STRIPE_SECRET_KEY!).webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const request = () => fetch(`http://127.0.0.1:${address.port}/api/stripe-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });

  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  assert.equal(reserveCalls, 2);
});

test("checkout events are not acknowledged when durable reservation fails", async (t) => {
  const { default: app, setWebhookOutboxForTests } = await import("../api/index.ts");
  setWebhookOutboxForTests({
    async reserve() {
      throw new Error("storage unavailable");
    },
    async updateStatus() {},
  });
  t.after(() => setWebhookOutboxForTests());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const payload = JSON.stringify({
    id: "evt_test_storage_failure",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_storagefailure" } },
  });
  const signature = new Stripe(process.env.STRIPE_SECRET_KEY!).webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  const response = await fetch(`http://127.0.0.1:${address.port}/api/stripe-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
    body: payload,
  });

  assert.equal(response.status, 503);
});

test("HTTP boundary rejects invalid checkout, lookup and withdrawal requests", async (t) => {
  const { default: app } = await import("../api/index.ts");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const checkoutResponse = await fetch(`${origin}/api/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(checkoutResponse.status, 400);
  const checkoutBody = await checkoutResponse.json() as { errors: Record<string, string> };
  assert.equal(checkoutBody.errors.brand, "Marke ist erforderlich.");
  assert.equal(checkoutBody.errors.acceptTerms, "Bitte Pflichtinformation bestätigen.");

  const lookupResponse = await fetch(`${origin}/api/checkout-session?session_id=not-a-session`);
  assert.equal(lookupResponse.status, 400);

  const withdrawalResponse = await fetch(`${origin}/api/withdrawal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Max Mustermann",
      email: "max@example.com",
      reference: "ORDER-2026-0001",
      declaration: "Hiermit widerrufe ich meinen Vertrag.",
    }),
  });
  assert.equal(withdrawalResponse.status, 400);

  const healthResponse = await fetch(`${origin}/api/health`);
  assert.equal(healthResponse.status, 200);
  const healthBody = await healthResponse.json() as Record<string, unknown>;
  assert.ok(Object.values(healthBody).every((value) => typeof value === "boolean"));
});
