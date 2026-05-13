# Cloud Run Deployment Guide

This guide walks through deploying DeFAI to Cloud Run with Cloud SQL (Postgres),
Vertex AI (Gemini 3), and Secret Manager. It assumes a GCP project with
billing enabled.

## One-time setup

Set environment variables for the rest of the commands. Replace placeholders
with your values.

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"            # or asia-south1 for India latency
export SERVICE="defai"
export REPO="defai"                    # Artifact Registry repo name
export CLOUDSQL_INSTANCE="defai-pg"    # short instance name (not the connection name)
```

### 1. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  --project=$PROJECT_ID
```

### 2. Create Artifact Registry repo

```bash
gcloud artifacts repositories create $REPO \
  --repository-format=docker \
  --location=$REGION \
  --project=$PROJECT_ID
```

### 3. Create the runtime service account

```bash
gcloud iam service-accounts create ${SERVICE}-sa \
  --display-name="DeFAI Cloud Run runtime" \
  --project=$PROJECT_ID

SA="${SERVICE}-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Vertex AI for Gemini 3 + embeddings
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/aiplatform.user"

# Cloud SQL via Auth Proxy
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/cloudsql.client"

# Read secrets at boot
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"

# Logging + monitoring
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/logging.logWriter"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/monitoring.metricWriter"
```

### 4. Provision Cloud SQL (Postgres 16)

```bash
gcloud sql instances create $CLOUDSQL_INSTANCE \
  --database-version=POSTGRES_16 \
  --region=$REGION \
  --cpu=1 --memory=3840MiB \
  --root-password="$(openssl rand -base64 24)" \
  --project=$PROJECT_ID

gcloud sql databases create defai --instance=$CLOUDSQL_INSTANCE --project=$PROJECT_ID

gcloud sql users create defai \
  --instance=$CLOUDSQL_INSTANCE \
  --password="$(openssl rand -base64 24)" \
  --project=$PROJECT_ID

# The full connection name is "PROJECT:REGION:INSTANCE" — keep it for later.
export CONNECTION_NAME="${PROJECT_ID}:${REGION}:${CLOUDSQL_INSTANCE}"
```

### 5. Create secrets in Secret Manager

Each secret is a separate resource. Don't bundle them — the IAM grant is
per-secret in production.

```bash
echo -n "$(openssl rand -hex 32)" | gcloud secrets create defai-encryption-key --data-file=- --project=$PROJECT_ID
echo -n "$(openssl rand -hex 32)" | gcloud secrets create defai-jwt-secret    --data-file=- --project=$PROJECT_ID
echo -n "$(openssl rand -hex 16)" | gcloud secrets create defai-telegram-webhook-secret --data-file=- --project=$PROJECT_ID

# Provided by you:
echo -n "<your eoa private key, 0x-prefixed>" | gcloud secrets create defai-private-key --data-file=- --project=$PROJECT_ID
echo -n "<pimlico api key>"                    | gcloud secrets create defai-pimlico-key --data-file=- --project=$PROJECT_ID
echo -n "<telegram bot token from BotFather>"  | gcloud secrets create defai-telegram-token --data-file=- --project=$PROJECT_ID
echo -n "<groq api key, optional fallback>"    | gcloud secrets create defai-groq-key --data-file=- --project=$PROJECT_ID

# Cloud SQL credentials (from step 4)
echo -n "defai"                       | gcloud secrets create defai-postgres-user     --data-file=- --project=$PROJECT_ID
echo -n "<the password you set>"      | gcloud secrets create defai-postgres-password --data-file=- --project=$PROJECT_ID
echo -n "defai"                       | gcloud secrets create defai-postgres-database --data-file=- --project=$PROJECT_ID
```

## Deploying

### Option A — Cloud Build (recommended)

One command builds, pushes, and deploys.

```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=$REGION,_SERVICE=$SERVICE,_REPO=$REPO,_CLOUDSQL_INSTANCE=$CONNECTION_NAME \
  --project=$PROJECT_ID
```

### Option B — service.yaml (gitops)

After filling in the placeholders in `service.yaml`:

```bash
gcloud run services replace service.yaml --region=$REGION --project=$PROJECT_ID
```

## Post-deploy steps

### Register the Telegram webhook

After Cloud Run prints the service URL (e.g. `https://defai-xxx-uc.a.run.app`):

```bash
SERVICE_URL=$(gcloud run services describe $SERVICE --region=$REGION --format='value(status.url)')
TELEGRAM_TOKEN=$(gcloud secrets versions access latest --secret=defai-telegram-token)
WEBHOOK_SECRET=$(gcloud secrets versions access latest --secret=defai-telegram-webhook-secret)

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${SERVICE_URL}/webhook/${TELEGRAM_TOKEN}\",\"secret_token\":\"${WEBHOOK_SECRET}\"}"
```

### Smoke-test

```bash
curl ${SERVICE_URL}/api/health      # → 200 with {"status":"ok",...}
```

Then send your bot a `/start` message on Telegram; the response should land
within a few seconds.

## Verifying the Vertex AI path

Tail logs and look for `intent classified` with `llm_provider:"vertex"`:

```bash
gcloud run services logs read $SERVICE --region=$REGION --limit=50
```

If you see `llm_provider:"groq"` instead, the `LLM_PROVIDER` env var didn't
land — re-check `--set-env-vars` in cloudbuild.yaml.

## Local dev against Cloud SQL (optional)

To exercise the Postgres path locally before deploying:

```bash
# Local postgres in docker
docker compose -f docker-compose.postgres.yml up -d
export POSTGRES_URL="postgres://defai:defai@localhost:5432/defai"
npm run dev
```

Or use the Cloud SQL Auth Proxy from your laptop:

```bash
cloud-sql-proxy --port 5432 $CONNECTION_NAME &
export POSTGRES_URL="postgres://defai:<password>@localhost:5432/defai"
npm run dev
```

## Cost notes

- **Cloud Run**: minScale=1 keeps one warm instance running 24/7. At 1 vCPU
  / 1 GiB this is ~$25/month before traffic. Drop `minScale=1` to fall back
  to scale-to-zero — but Telegram webhook latency will suffer (~1-3 s cold
  start).
- **Cloud SQL**: db-custom-1-3840 instance is ~$50/month base.
- **Vertex AI Gemini 3 Pro / Flash**: usage-billed; see `src/observability/cost.ts`
  for the pricing table (verified against the live Vertex pricing page before
  enabling the daily-budget gate).
- **Secret Manager**: $0.06 per active secret per month — negligible.

## Rollback

Cloud Run keeps every deployed revision. To roll back to the prior one:

```bash
gcloud run services update-traffic $SERVICE --to-revisions=PRIOR_REVISION=100 \
  --region=$REGION --project=$PROJECT_ID
```

Get the revision name from `gcloud run revisions list --service=$SERVICE`.
