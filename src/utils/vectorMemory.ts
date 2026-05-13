/**
 * Episodic memory — Vertex AI Vector Search-backed (Phase 7D).
 *
 * Replaces the unused Supermemory wrapper. The shape (`remember` /
 * `recall`) is preserved so the planner can pull "past decisions for this
 * user" context without any caller knowing which backend is underneath.
 *
 * ARCHITECTURE
 * ────────────
 * Three pieces:
 *   1. Embedder — converts text → number[]. Two implementations:
 *        VertexEmbedder uses gemini-embedding-001 via the Vertex predict
 *        endpoint when LLM_PROVIDER=vertex AND GCP_PROJECT_ID is set.
 *        StubEmbedder uses a deterministic hash-based bag-of-words vector
 *        (768-dim, matches gemini-embedding-001 width) so dev + tests work
 *        without GCP creds. The stub is intentionally NOT semantic — it
 *        proves the recall path returns the right shape but cannot meet a
 *        real eval threshold.
 *   2. Store — keeps {content, vector, timestamp} keyed by userId.
 *        Phase 7D ships an in-process Map. Production-grade persistence
 *        (Vertex Vector Search index) is wired in Phase 7D.1 once the
 *        Cloud Run deploy is live; the index needs gcloud-side
 *        provisioning before any caller can write to it.
 *   3. Public API — remember(userId, content) + recall(userId, query, topK).
 *
 * COSINE SIMILARITY
 * ─────────────────
 * recall() ranks stored entries by cosine similarity against the query
 * embedding. For low-volume per-user memory (a few dozen entries) this is
 * sub-millisecond in TypeScript. At scale (>10k entries / user) the right
 * answer is Vertex Vector Search OR pg-vector — both swap into this
 * module by replacing the Store implementation.
 *
 * Fail-soft: every public function catches and returns a safe default so
 * an observability/network failure can never break the user-facing turn.
 */

import { logger } from './logger';

export interface EpisodicEntry {
  content: string;
  vector: number[];
  recorded_at: number; // epoch ms
}

export interface Embedder {
  /** Returns a fixed-width vector. Width is implementation-specific. */
  embed(text: string): Promise<number[]>;
  /** Vector dimensionality, used to validate cross-implementation calls. */
  readonly dim: number;
  readonly name: 'vertex' | 'stub';
}

/* ─── Vertex embedder ────────────────────────────────────────────────── */

const VERTEX_EMBED_MODEL = 'gemini-embedding-001';
const VERTEX_EMBED_DIM = 768;

/**
 * Calls the Vertex AI text-embedding endpoint. Lazy-loads the
 * @google-cloud/vertexai client so this file doesn't pull in the SDK in
 * dev/test paths that don't need it.
 *
 * Note: Vertex AI embeddings live on `aiplatform.googleapis.com`, not
 * `generativelanguage.googleapis.com`. The endpoint shape is different
 * from chat completions — we use the raw REST API via a thin wrapper
 * rather than getGenerativeModel().
 */
export class VertexEmbedder implements Embedder {
  readonly name = 'vertex' as const;
  readonly dim = VERTEX_EMBED_DIM;
  private readonly project: string;
  private readonly location: string;
  private auth: import('google-auth-library').GoogleAuth | null = null;

  constructor(opts: { project?: string; location?: string } = {}) {
    this.project = opts.project ?? process.env.GCP_PROJECT_ID ?? '';
    this.location = opts.location ?? process.env.GCP_LOCATION ?? 'us-central1';
    if (!this.project) {
      throw new Error('GCP_PROJECT_ID is not set — VertexEmbedder needs a project.');
    }
  }

  private async getToken(): Promise<string> {
    if (!this.auth) {
      // Imported lazily so this module can load even when google-auth-library
      // isn't transitively reachable (e.g. in pure unit tests using StubEmbedder).
      const { GoogleAuth } = await import('google-auth-library');
      this.auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    }
    const client = await this.auth.getClient();
    const tok = await client.getAccessToken();
    if (!tok.token) throw new Error('VertexEmbedder: failed to obtain access token');
    return tok.token;
  }

  async embed(text: string): Promise<number[]> {
    const token = await this.getToken();
    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}` +
      `/locations/${this.location}/publishers/google/models/${VERTEX_EMBED_MODEL}:predict`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ content: text }],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Vertex embed failed: ${response.status} ${body.slice(0, 200)}`);
    }
    const json = (await response.json()) as {
      predictions?: Array<{ embeddings?: { values?: number[] } }>;
    };
    const values = json.predictions?.[0]?.embeddings?.values;
    if (!values || values.length === 0) {
      throw new Error('Vertex embed returned no values');
    }
    return values;
  }
}

/* ─── Stub embedder (dev + tests) ────────────────────────────────────── */

const STUB_DIM = 768;

/**
 * Deterministic bag-of-words → 768-dim vector via FNV-1a hashing into
 * buckets. Not semantically meaningful, but stable: the same text always
 * produces the same vector, and texts that share tokens have higher
 * cosine similarity than texts that don't.
 *
 * Good enough for: tests, dev demos, sanity checks. NOT good enough for
 * production-grade recall — that needs real embeddings (VertexEmbedder).
 */
export class StubEmbedder implements Embedder {
  readonly name = 'stub' as const;
  readonly dim = STUB_DIM;

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(STUB_DIM).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const tok of tokens) {
      const h = fnv1a32(tok) % STUB_DIM;
      v[h] += 1;
    }
    // L2-normalize so cosine === dot product downstream.
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }
}

function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ─── Module-level factory ──────────────────────────────────────────── */

let cachedEmbedder: Embedder | null = null;
export function getEmbedder(): Embedder {
  if (cachedEmbedder) return cachedEmbedder;
  if (process.env.VECTOR_MEMORY_PROVIDER === 'vertex' || process.env.LLM_PROVIDER === 'vertex') {
    try {
      cachedEmbedder = new VertexEmbedder();
      return cachedEmbedder;
    } catch (e: any) {
      logger.warn(
        { err: e?.message },
        'VertexEmbedder construct failed; falling back to StubEmbedder',
      );
    }
  }
  cachedEmbedder = new StubEmbedder();
  return cachedEmbedder;
}

/** Test-only: drop the cached embedder so the next call re-resolves env. */
export function _resetEmbedder(): void {
  cachedEmbedder = null;
}

/* ─── In-process store + public API ─────────────────────────────────── */

const store = new Map<string, EpisodicEntry[]>();
const MAX_PER_USER = 100; // cap to keep per-user search bounded

/**
 * Cosine similarity between two equal-length vectors. Both inputs are
 * assumed already L2-normalized when produced by an Embedder — that lets
 * cosine collapse to a plain dot product. We still compute the safe form
 * here in case a caller hands us raw vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Record an episodic entry for the user. Fail-soft — never throws.
 *
 * If the embedder is configured for Vertex and the call fails (network,
 * 429, auth), we log a warn and drop the entry rather than block the
 * caller. The user-facing path is more important than a complete
 * memory log.
 */
export async function remember(userId: string, content: string): Promise<void> {
  if (!content.trim()) return;
  try {
    const embedder = getEmbedder();
    const vector = await embedder.embed(content);
    const entries = store.get(userId) ?? [];
    entries.push({ content, vector, recorded_at: Date.now() });
    if (entries.length > MAX_PER_USER) entries.splice(0, entries.length - MAX_PER_USER);
    store.set(userId, entries);
  } catch (e: any) {
    logger.warn({ err: e?.message, user_id: userId }, 'vectorMemory.remember failed; dropping entry');
  }
}

/**
 * Return the topK most-similar entries to `query`, joined by '\n'.
 * Caller treats this as untrusted context (it came from prior model
 * turns / tool outputs); never inject it as system instructions.
 *
 * Returns '' on any failure (embed error, empty store, etc.) so callers
 * can compose with || fallback strings.
 */
export async function recall(userId: string, query: string, topK = 3): Promise<string> {
  if (!query.trim()) return '';
  const entries = store.get(userId);
  if (!entries || entries.length === 0) return '';
  try {
    const embedder = getEmbedder();
    const qv = await embedder.embed(query);
    const scored = entries
      .map((e) => ({ entry: e, score: cosineSimilarity(qv, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored
      .filter((s) => s.score > 0)
      .map((s) => s.entry.content)
      .join('\n');
  } catch (e: any) {
    logger.warn({ err: e?.message, user_id: userId }, 'vectorMemory.recall failed; returning empty');
    return '';
  }
}

/** Test-only: drop all entries for a user (or globally if userId omitted). */
export function _clearMemory(userId?: string): void {
  if (userId) store.delete(userId);
  else store.clear();
}

/** Test-only: peek at stored entries without making an embed call. */
export function _peekMemory(userId: string): EpisodicEntry[] {
  return store.get(userId) ?? [];
}
