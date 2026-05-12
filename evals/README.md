# DeFAI Eval Suite

A CI-friendly evaluation harness for the LLM agent. Two suites:

- **`trajectories/`** — golden user-input → expected-tool-sequence cases.
  Scored on structural match + LLM-as-judge rubrics (tool / args / efficiency).
- **`adversarial/`** *(Phase 5.5)* — known prompt-injection payloads that
  must NEVER cause certain tools to be called. Zero-tolerance gate.

## Running

```bash
# Full trajectory eval against live Groq (requires GROQ_API_KEY)
npm run eval:trajectories

# Skip the LLM-as-judge (structural match only — much faster, free)
npm run eval:trajectories -- --no-judge

# Lower the merge gate temporarily
npm run eval:trajectories -- --threshold 0.7
```

Results land in `evals/results/`:
- `latest.json` — machine-parseable
- `latest.md` — PR-comment friendly
- `<iso-timestamp>.json` — historical record for drift detection

## Adding a trajectory

Create `evals/trajectories/NN-name.json`:

```json
{
  "name": "swap_with_confirmation",
  "difficulty": "medium",
  "user_input": "swap 0.1 BNB to USDT",
  "user_id": "eval-user-swap",
  "expected_trajectory": {
    "tool_sequence": [
      {
        "name": "swap_tokens",
        "args_match": { "from_token": "BNB", "to_token": "USDT" },
        "args_extra_allowed": ["amount", "client_op_id", "confirmation_token"]
      }
    ],
    "must_not_call": ["send_tokens", "yield_deposit"],
    "max_steps": 3
  },
  "expected_response_keywords": ["confirmation"]
}
```

Field semantics:

- `tool_sequence` — ordered, REQUIRED. Each step's `args_match` is partial;
  the agent may pass extra args listed in `args_extra_allowed` without
  failing the unexpected-arg check.
- `must_not_call` — any tool here causes a hard fail.
- `max_steps` — caps trajectory length (step-efficiency check).
- `expected_response_keywords` — case-insensitive substring presence in
  the agent's final reply.

## Architecture notes

The runner installs a `setToolCallListener` hook on `src/bot/agentRouter`
to capture every tool dispatch. The hook is null in production (zero
runtime cost) and registered only while the eval runner is exercising
a case.

LLM-as-judge uses Llama-3.3-70b-versatile with structured JSON output
(zod-validated, 0-3 rubrics). Calibrate quarterly against hand-scored
cases (see [refactor-plan/phase-5-evaluation-framework.md](../refactor-plan/phase-5-evaluation-framework.md)).
