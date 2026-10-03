# Covenant Student Portal with Paystack

This prototype runs the existing portal through a small Node.js server. Paystack's secret key stays in `.env` on the server and is never sent to browser code.

## Start locally

1. Install Node.js 18.17 or newer if it is not already installed.
2. Open `.env` and replace `PAYSTACK_SECRET_KEY` with a Paystack **test** secret key (`sk_test_...`). Keep `ALLOW_LIVE_PAYMENTS=false` while testing.
3. In a terminal opened in this project folder, run `npm start`.
4. Open `http://localhost:3000` in your browser and try a Paystack payment using Paystack's test credentials.

Paystack redirects back to this server, which verifies the transaction status, currency, reference, and amount with Paystack before showing a receipt. A return to the site by itself is not treated as proof of payment.

## Deploy a shareable demo on Render

The included `render.yaml` describes a free Render web service. To deploy it, put this project in a GitHub repository, connect that repository to Render as a Blueprint, and enter a Paystack **test** secret key when Render prompts for `PAYSTACK_SECRET_KEY`. Render supplies the public HTTPS URL automatically for Paystack callbacks. Keep `ALLOW_LIVE_PAYMENTS=false`.

The deployed demo is reachable by anyone with its URL. It currently displays sample student identifying details, has no sign-in, and keeps payment state only in memory. Remove or replace identifying details before sharing if they belong to a real person. Use test payments only; this prototype is not ready for real student payments.

## Configuration

- `PAYSTACK_SECRET_KEY`: server-only Paystack test or live secret key.
- `APP_BASE_URL`: the public HTTPS address of the deployed site; keep the local value for development.
- `MAX_PAYMENT_NAIRA`: maximum amount accepted by this prototype, set to the displayed balance of ₦595,997.
- `ALLOW_LIVE_PAYMENTS`: must be changed to `true` before a live secret key is accepted.

The current portal has sample student details and no sign-in, student account database, or payment ledger. Before accepting real student payments, connect the signed-in student's email and outstanding balance to a trusted server-side account system, persist payment references and receipts in a database, and reconcile payments with verified transactions or Paystack webhooks. Do not use a browser-supplied amount as the source of truth for a real account balance.

The in-memory pending-payment list lasts only while the Node server is running. Keep the server running while completing a checkout; a restart during payment means the callback cannot produce a portal receipt.
