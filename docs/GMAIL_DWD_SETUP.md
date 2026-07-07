# Gmail Domain-Wide Delegation Setup (one-time)

The outreach email generator (`scripts/generate-outreach-email.ts`) creates
drafts in matt@forgegrowth.ai's Gmail via the existing `fg-analytics` service
account, **keylessly** (org policy `iam.disableServiceAccountKeyCreation`
blocks SA key files). The auth chain is:

```
ADC user token (GOOGLE_ADC_JSON / gcloud ADC)
  → IAM Credentials signJwt (sign a DWD assertion as fg-analytics)
    → token endpoint jwt-bearer exchange
      → user-delegated access token acting as matt@forgegrowth.ai
        → Gmail API drafts.create / drafts.update  (never send)
```

`signJwt` uses the same `roles/iam.serviceAccountTokenCreator` grant that
`generateAccessToken` (GA4/GSC) already uses — no new IAM grants needed.
What IS needed is a one-time Workspace admin authorization:

## Steps

1. **Get the service account's OAuth2 client ID** (numeric "Unique ID"):

   ```bash
   gcloud iam service-accounts describe \
     fg-analytics@concise-vertex-490015-d0.iam.gserviceaccount.com \
     --format='value(oauth2ClientId)'
   ```

2. **Authorize it for domain-wide delegation** (as a forgegrowth.ai super
   admin): [admin.google.com](https://admin.google.com) → Security → Access
   and data control → API Controls → **Domain-wide Delegation** → Add new:
   - Client ID: the numeric ID from step 1
   - OAuth scopes: exactly `https://www.googleapis.com/auth/gmail.compose`
     — the **full URL**. The console rejects the short form (`gmail.compose`)
     with "invalid scope".

   (`gmail.compose` is the narrowest scope that can create drafts — there is
   no drafts-only scope. The codebase contains no send call; see DECISIONS.md.)

3. **Enable the Gmail API** on the project if not already enabled:

   ```bash
   gcloud services enable gmail.googleapis.com --project=concise-vertex-490015-d0
   ```

4. **Smoke test** (locally or in a Railway shell — no new env vars needed;
   `GOOGLE_ADC_JSON` is already set on Railway):

   ```bash
   npx tsx -e "import('./scripts/google-auth.js').then(async m => console.log((await m.getDelegatedUserAccessToken('matt@forgegrowth.ai', ['https://www.googleapis.com/auth/gmail.compose'])).slice(0, 20) + '...'))"
   ```

   Prints a token prefix on success.

## Failure signatures

- `Delegated token exchange failed (400/401): ... unauthorized_client` —
  DWD is not configured (step 2), the scope doesn't match exactly, or the
  change hasn't propagated yet (**can take ~10 minutes**).
- `SA signJwt failed (403)` — the ADC identity lost
  `roles/iam.serviceAccountTokenCreator` on fg-analytics (would also break
  GA4/GSC).
- Gmail API `403 accessNotConfigured` — step 3 not done.

When the Gmail step fails, the generator still persists the email copy to
`prospects.outreach_subject/outreach_body` with `outreach_status='generated'`;
re-run with `--force` after fixing to retry the draft creation.
