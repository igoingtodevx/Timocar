# AutoWunsch.com deployment handoff

## Current delivery

The application is linked to the Vercel project `auto-beratung-award`. Vercel remains the active runtime until the Hetzner cutover is completed. Do not change the privacy notice to Hetzner before traffic actually moves.

Required runtime variables:

- `APP_URL`: canonical public origin, without a trailing slash
- `STRIPE_SECRET_KEY`: live key only in the production environment
- `STRIPE_WEBHOOK_SECRET`: secret for the environment-specific webhook endpoint
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: transactional mail transport
- `OWNER_EMAIL`: internal order and withdrawal notifications
- `SUPPORT_EMAIL`: public customer support and withdrawal contact
- `GEMINI_API_KEY`: optional vehicle-analysis endpoint

The production launch is blocked until the owner has supplied and verified the live values. Never copy preview or test values into production without checking the Stripe mode and webhook endpoint.

## Stripe launch checklist

1. Create the production webhook endpoint at `https://autowunsch.com/api/stripe-webhook`.
2. Subscribe to `checkout.session.completed` and copy its signing secret to the production environment.
3. Confirm that the configured key starts in Stripe live mode and that the 49 EUR charge is shown before payment.
4. Run one low-value controlled live purchase, confirm both emails, then refund it in Stripe.
5. Verify that a checkout session cannot be viewed with a mismatched customer email through the withdrawal flow.

## Hetzner target

Use a current Ubuntu LTS VPS with Docker Compose, Caddy or nginx as TLS reverse proxy, the Node application, and PostgreSQL. The production version must replace warm-process webhook deduplication with a database-backed event ledger and persist orders, consent records, mail-delivery state, withdrawal receipts, and admin audit events.

Minimum services:

- `web`: built frontend plus Node API
- `postgres`: private network only, encrypted backups
- `reverse-proxy`: HTTPS, HSTS after validation, request limits
- `backup`: daily encrypted database backup with restore test

The customer dashboard should not be opened until authentication, role checks, audit logging, password reset, session revocation, and data-retention rules are implemented and tested. For the first launch, Stripe plus transactional email is the safer operational workflow.

## DNS cutover

1. Lower the existing DNS TTL at least 24 hours before migration.
2. Deploy and test the Hetzner origin on a temporary hostname.
3. Configure `autowunsch.com` and `www.autowunsch.com`, issue TLS certificates, and verify health checks.
4. Change the A/AAAA or proxy records, then verify both hostnames, checkout callbacks, webhook delivery, mail links, and legal pages.
5. Keep the Vercel deployment available for rollback until logs and payments remain clean for at least 24 hours.

## Legal release gate

The included legal text is an implementation based on the supplied business data and current statutory structure. Before commercial launch, a German lawyer or qualified legal service should review the imprint, privacy notice, terms, withdrawal policy, consent wording, and the exact business classification. The domestic tax number is intentionally not published; add a valid VAT ID or business identification number only if one is actually assigned and legally required.
