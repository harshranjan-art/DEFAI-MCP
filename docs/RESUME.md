# DeFAI — Resume Bullet Bank

Curated bullet variants for the DeFAI project, tuned for the **Google
Forward Deployed Engineer (Gen AI), fresher** role. Each bullet hits one
of the three pillars in the JD: agentic AI engineering depth, GCP / Vertex
AI surface, and production reliability craft.

Pick 3-5 bullets for the resume itself; keep the rest in the cover letter
and interview talk-track.

## Headline (top of project)

**DeFAI — Autonomous DeFi agent on BNB Chain (BSC), running on GCP Cloud
Run + Cloud SQL + Vertex AI (Gemini 3 Pro/Flash). Telegram bot, MCP server
(Claude Desktop tool), REST API, React dashboard. ~5,000 lines TypeScript,
296 unit/integration tests, eval-suite-gated CI.**

## Agentic AI engineering (lead with these)

- **Built a 3-layer defense-in-depth agentic AI system on Gemini 3 Pro (planner) + Flash (verifier/classifier): deterministic sanitizer, fresh-context verifier sub-agent with JSON-only output, and engine-level zod boundary checks — successfully blocks prompt-injection attempts the planner alone misses, validated against an adversarial eval suite.**
- **Designed a finite-state-machine layer for arb-session lifecycle (6 states / 9 events) + per-user execution locks (SQLite-backed, 30 s TTL, atomic), eliminating the race-condition class of bugs where two transports could execute concurrent trades for the same user.**
- **Implemented an LLM-provider abstraction (Groq Llama ↔ Vertex Gemini 3) that swaps the entire AI stack via a one-line env flip; tool-call shape, usage extraction, and cost tracking are normalized across SDKs.**
- **Tiered model routing — intent classifier (Llama-8B / Gemini 3 Flash, ~$0.0001/turn) labels each user message as read-only vs write-action, then routes to the cheap or flagship planner: confirmed ~30% cost reduction on read-heavy traffic.**
- **Built an LLM-as-judge eval gate (3 rubrics, 0-3 scale, zod-validated structured output) integrated into GitHub Actions; fails the build if trajectory pass-rate drops below 90%. Calibration script measures judge-vs-human agreement on a hand-scored ground truth so model swaps don't silently degrade the gate.**

## GCP / Vertex AI surface (recruiter signal)

- **Production deployment on Cloud Run with Cloud SQL Postgres (Auth Proxy sidecar via service annotation), Vertex AI for Gemini 3 chat + `gemini-embedding-001` for episodic memory, and Secret Manager (11 secrets via `--set-secrets`). Multi-stage Docker build, min-instances=1 to keep Telegram webhook p95 under 1 s.**
- **Cloud Build pipeline (cloudbuild.yaml): build → push to Artifact Registry → `gcloud run deploy` with explicit IAM (dedicated service account scoped to `roles/aiplatform.user`, `roles/cloudsql.client`, `roles/secretmanager.secretAccessor` only).**
- **Vertex AI tool-calling translation layer: `messages → contents`, `tools → functionDeclarations`, `tool_choice → toolConfig.functionCallingConfig`, `responseFormat:'json_object' → responseMimeType`, with normalized usage extraction from `usageMetadata.{prompt,candidates,cachedContent}TokenCount`.**
- **Designed Postgres schema migrated verbatim from SQLite (9 tables, partial unique indexes for idempotency, JSONB for nested metadata, `schema_migrations` for versioned migrations); validated against pg-mem in tests so the schema gate runs without Docker.**

## Production reliability craft

- **Hand-rolled `EngineResult<T>` discriminated-union envelope (ok / err / needsConfirmation) is the single boundary between transports (MCP, Telegram, REST) and the engine — eliminates the "did the call succeed?" ambiguity that breaks LLM tool-calling agents.**
- **Idempotency via `client_op_id` + Postgres partial unique indexes (where col is not null): on retry, the second insert hits the index and returns the original row instead of double-executing — verified by 9 unit tests covering exact-match, missing-id, and concurrent-write semantics.**
- **Bait-and-switch detection on user-confirmation: after the user approves a previewed action, the engine deep-diffs the args before execution and rejects if they changed — closes the gap where a hijacked planner could rewrite a 0.1 BNB swap to 100 BNB between confirmation and execution.**
- **Per-call LLM cost ledger (`llm_costs` table) with daily-budget gate — caps user spend at $2/day default; verified pricing precision to 9 decimal places because Llama-8B verifier calls are ~$0.00001 and 6dp underreported by ~3%.**
- **Vol-adjusted position sizing using log-returns + sqrt-time scaling over `market_snapshots`, clamped [0.01, 5.0]; cooldowns after consecutive losses; daily-loss cap with action-type exemptions for sends.**
- **Lifecycle: `onShutdown` registry + SIGTERM handler with 15 s drain timeout — Cloud Run sends SIGTERM before evicting an instance; we close the pg.Pool and flush the WAL cleanly.**

## Numbers you can quote

- **5 sub-phases of the GCP pivot shipped as separate PRs** (provider abstraction → Vertex AI → Cloud SQL foundation → Vector Search memory → Cloud Run deploy → eval re-baseline → docs).
- **296 tests across 30 files** — unit, integration, and 5 golden-trajectory eval cases.
- **~30% LLM cost reduction** on read-heavy traffic via intent-routed model tiering (vs always-flagship baseline).
- **<1 s p95** Telegram webhook latency target on Cloud Run with min-instances=1.
- **Zero data loss on retry** under idempotency: the partial-UNIQUE index admits duplicate rows by design when `client_op_id IS NULL` (legacy paths) but rejects duplicates when set.

## Interview talking points (don't put on resume, hold in reserve)

- Why **no LangChain / LangGraph**: the entire agent loop is ~400 lines hand-rolled. LangGraph would obscure the FSM transitions; LangChain's tool-calling wrapper hides the verifier-rejection edge cases. The point of building this from scratch is showing what a production agent actually looks like underneath the framework abstraction.
- Why **Cloud Run over Cloud Functions**: long-running connections (MCP SSE + Telegram webhook + REST API on one container), and Cloud Functions doesn't support multi-endpoint deployments cleanly.
- Why **Postgres over Firestore**: schema-on-write matters (the existing FSM transitions + idempotency invariants need ACID, not eventual consistency); Firestore would force a redesign for nested JSON fields like `risk_config` and `metadata`.
- **What I'd add with another week**: production Vector Search index provisioning (replaces the in-process Map in `vectorMemory.ts`), pg-vector for cosine search at scale, Cloud Trace integration in place of Langfuse, BigQuery export for cost-rollup analytics.

## Citations / links (for the resume header)

- GitHub: `github.com/<your-handle>/defai-bharat`
- Live demo URL: (after Cloud Run deploy)
- Architecture doc: `docs/architecture.md` in the repo
- Deploy runbook: `docs/DEPLOY.md` in the repo
