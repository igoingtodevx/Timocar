# DigitalOcean App Platform runbook

This release is intentionally designed so the operator only uses `https://<domain>/admin`. They never need DigitalOcean, SSH, GitHub deployment, DNS, or database credentials.

## Preconditions

1. Create a **Managed PostgreSQL** cluster in the DigitalOcean control plane (Frankfurt / `fra` to match the app) with backups and point-in-time recovery enabled.
2. Connect that database to the App Platform application in the control plane. App Platform supplies `DATABASE_URL` to the component; do not paste that value into Git or an app spec.
3. Keep the existing live Vercel project in place until the DigitalOcean smoke test is complete. No DNS cutover is part of this repository change.

## Create the application

The declarative baseline is `.do/app.yaml`. It intentionally points to `main`, triggers after a merge, and has no credentials.

Create it after GitHub has been connected to the DigitalOcean account:

```bash
# Requires a DigitalOcean token in the operator/infra-owner shell, never in this repo.
doctl apps create --spec .do/app.yaml
```

In the App Platform UI, add the encrypted variables below. `VITE_*` values must be present during the **build** as well as runtime. All other sensitive values are runtime-only.

| Variable | Scope | Notes |
| --- | --- | --- |
| `APP_URL` | runtime | Canonical HTTPS URL, no trailing slash |
| `DATABASE_URL` | attached database | Provided through the managed database attachment |
| `DATABASE_SSL=true` | runtime | Required for managed Postgres |
| `STRIPE_SECRET_KEY` | runtime secret | Existing Stripe key |
| `STRIPE_WEBHOOK_SECRET` | runtime secret | New endpoint-specific Stripe signing secret |
| `VITE_STRIPE_PUBLISHABLE_KEY` | build + runtime | Existing public Stripe key |
| `CHECKOUT_MODE=embedded`, `VITE_CHECKOUT_MODE=embedded` | build + runtime | Preserves TikTok in-app flow |
| SMTP variables and `OWNER_EMAIL` | runtime secret | Required for magic links and order emails |
| `ADMIN_OWNER_EMAILS` | runtime secret | Comma-separated Owner email addresses |
| `ADMIN_STAFF_EMAILS` | runtime secret | Optional comma-separated staff addresses |
| `GEMINI_API_KEY`, `EXA_API_KEY` | runtime secret | Only if AI analysis stays enabled |

## Apply the schema

From a trusted administrator shell that has the temporary `DATABASE_URL` provided by the attached database:

```bash
npm ci
DATABASE_URL='[REDACTED]' DATABASE_SSL=true npm run db:migrate
```

The migration is idempotent and creates `orders`, session/magic-link records, storefront settings, and the audit log. Do **not** put the URI in `.env` committed to the repository.

## Cutover and verification

1. Use the generated `*.ondigitalocean.app` domain first; set `APP_URL` to that HTTPS URL.
2. Register the matching Stripe webhook URL `https://<app-domain>/api/stripe-webhook` for `checkout.session.completed`; retain the old endpoint during the overlap.
3. In a browser, request an Owner magic link at `/admin`, open it once, confirm that `/api/admin/bootstrap` works, and verify a Staff account cannot pause the shop.
4. Use only Stripe test mode or a clearly cancelled test checkout. Confirm the order appears and that the pause switch refuses a **new** checkout while the webhook endpoint stays healthy.
5. Only then attach production DNS and make the new Stripe webhook endpoint primary. Keep Vercel available for rollback until one successful production operational cycle.

## Rollback

Use App Platform's deployment rollback for application code. To rollback DNS, point the host back to Vercel. Do not stop the app or delete its database: Stripe webhooks and already-started embedded checkout sessions must remain reachable.
