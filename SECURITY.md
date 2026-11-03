# Security

HaggleBot is a hackathon project that runs against the **PayPal Sandbox only**. It never handles real money, and the server refuses to start with any other `PAYPAL_ENVIRONMENT`.

## Secrets

- No secret is stored in this repository. PayPal credentials, AI keys, `SELLER_KEY` and `SESSION_SECRET` are read from the environment (`.env`, which is git-ignored, or the host's dashboard).
- `.env.example` contains empty values only.
- Commit hooks (`scripts/hooks/`, `.githooks/`) scan changed files for key shapes and block the commit; they print only the file name and rule, never a value.
- If you find a credential in this repository or its history, please report it and rotate it.

## Design choices that limit damage

- The seller's floor price is computed and enforced in code; the AI never sees it, and its replies are re-checked before a buyer sees them.
- The payment amount sent to PayPal comes from the stored deal, never from the browser.
- Money-moving actions suggested by the Copilot are proposals that only a human **Confirm** click can execute.
- PayPal webhooks are verified through PayPal's signature API and handled idempotently; forged events are rejected.
- Login uses signed HttpOnly cookies, a lockout after repeated wrong seller keys, and rate limits.

## Known limits

Buyer sign-in is a demo (the one-time code is shown on screen) and is not production authentication. State is in memory plus a local JSON file. See "Honest limitations" in the README.

## Reporting

Open a private security advisory on the GitHub repository (Security tab), or an issue that does not include any secret.
