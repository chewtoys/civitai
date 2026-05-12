# Scanner Prompt Tuning — Context

This doc captures the moving pieces involved in tuning the prompts/policies we send to our content-moderation scanners. It's written as orientation for future Claude sessions — read this before touching scanner code or designing review/analysis tooling.

The **goal of this project**: record scanner inputs + outputs in a structured way so moderators can mark false positives and we (or an AI) can analyze patterns to adjust the scanner prompts/policies.

This is logically a **separate project** from operational moderation — different audience (tuning team vs. trust & safety operators), different data shape (append-only analytics vs. low-latency operational state), different storage tech. It will live inside the civitai repo for now (no standalone service), but with isolated boundaries so it can be extracted later.

---

## The two scanners

We operate two independent scanner pipelines. They share **no code** today and store results in different tables.

### 1. XGuard text moderation (YuFeng XGuard Reason 8B)

A classifier we run via vLLM as an OpenAI-compatible chat completion model in the orchestrator. It is **not** used conversationally — it's a per-label binary classifier.

**How it works** (logical, not code):

- One model call per label. The call includes the user content + one policy string for one label.
- `chatTemplateKwargs.policy` = wrapped policy, `reason_first = false`, `temperature = 0`, `topLogprobs = 20`, `maxTokens = 1` in prod.
- Only the first generated token matters: `x` = label applies / unsafe, `sec` = safe.
- Orchestrator computes a score from the first-token probability of `x` and compares to the label's threshold.
- Explanation generation is disabled in prod → **policy prompt quality has to make the first-token decision reliable on its own.**

**Two input modes:**

- **Prompt mode** — evaluates AI image generation prompts (structured text with fields)
- **Text mode** — evaluates site/user text (comments, messages, bios, model descriptions, support impersonation attempts)

**Per-label, per-call**: every label is a self-contained binary policy. The call shape includes the labels we want checked.

### 2. Image ingestion classifier

A pipeline of vision models the orchestrator runs over uploaded images. Returns per-image classification across multiple dimensions.

**`mediaRating` step output was expanded — not replaced.** The orchestrator request in [orchestrator.service.ts](src/server/services/orchestrator/orchestrator.service.ts) → `createImageIngestionRequest` now passes new input flags on the existing `mediaRating` step:

```ts
input: {
  mediaUrl: { $ref: '$arguments', path: 'mediaUrl' },
  engine: 'civitai',
  includeAgeClassification: true,
  includeAIRecognition: true,
  includeFaceRecognition: true,
  includeAnimeRecognition: true,
}
```

The `$type` discriminator is unchanged. The output schema gained four optional fields.

**Expanded `mediaRating.output` shape** (new fields are optional — old in-flight workflows return only `nsfwLevel`/`isBlocked`/`blockedReason?`):

```json
{
  "nsfwLevel": "x",
  "isBlocked": false,
  "ageClassification": {
    "detections": [{
      "boundingBox": {...},
      "ageLabel": "Teenager 13-20",
      "confidence": 0.653,
      "isMinor": false,
      "topK": { "Teenager 13-20": 0.653, "Adult 21-44": 0.252, ... }
    }]
  },
  "faceRecognition": { "faces": [{ "boundingBox": {...} }] },
  "aiRecognition":    { "label": "AI",    "confidence": 0.998 },
  "animeRecognition": { "label": "anime", "confidence": 0.992 }
}
```

Each new field becomes a **tag** on the image (full per-detection data goes to the audit log — see Proposed data layer):

- `nsfwLevel` value (e.g., `x`) → tag, already done today via `SpineRating` source
- `minor` → tag, source `MinorDetection`, when `ageClassification.detections.some(d => d.isMinor)`
- `ai` → tag, new source `AiRecognition`, when `aiRecognition.label === 'AI'`
- `anime` → tag, new source `AnimeRecognition`, when `animeRecognition.label === 'anime'`

The `topK` distributions, bounding boxes, face geometry, and confidences for non-triggered classifications go to the audit log raw — that's where prompt-tuning analysis pulls near-miss signal from. The flat tag rows are just the booleans.

**Video pipeline also gets the new fields.** The `repeat → mediaRating` block in `createImageIngestionRequest` for `type !== 'image'` passes the same `include*` flags as the image path. The repeater aggregator (`aggregateMediaRatingRepeater`) merges per-frame results: detections/faces are unioned across frames; `aiRecognition`/`animeRecognition` collapse to the per-frame result with the highest confidence.

`wdTagging` and `mediaHash` are unchanged.

**Code changes required in [image-scan-result.service.ts](src/server/services/image-scan-result.service.ts):**

1. Extend the `MediaRatingStep` TypeScript type (line 74) — add the four new optional output fields.
2. Extend `tagsWithSource` (line 251) to emit `minor`/`ai`/`anime` tags from the new fields when present.
3. Add `AiRecognition` + `AnimeRecognition` to the `TagSource` Prisma enum (or accept lossy provenance and reuse `Computed`).
4. Decide whether `auditScanResults` branches on the new `MinorDetection`-sourced `minor` tag (stronger signal than the hand-curated `tagsNeedingReview` list) or just appends `minor` to that list.
5. Forward the full untruncated `mediaRating.output` to the audit log so the per-detection / topK / non-triggered confidences are preserved for tuning.

---

## Glossary (terms get reused with different meanings — watch out)

| Term | Meaning |
| --- | --- |
| **Label** | An XGuard policy name. One label = one binary classifier call. E.g., `nsfw`, `csam`, `impersonation`. |
| **Policy** | The natural-language prompt text describing what makes the label apply (`x`) vs. not (`sec`). This is what we're trying to tune. |
| **Tag** | A token attached to an image after ingestion classification. Stored in `TagsOnImageDetails`. Different concept from XGuard "label" — but for this project we treat both as flat string keys per scan result. |
| **nsfwLevel** | On the `Image` table: numeric enum (`1=PG, 2=PG13, 4=R, 8=X, 16=XXX, 32=Blocked`). In the `mediaRating` output: a string (`"x"`, `"r"`, etc.). |
| **Source** | `TagSource` enum: `WD14`, `Clavata`, `Hive`, `SpineRating`, `MinorDetection`, `HiveDemographics`, `Computed`, `User`. Identifies which model/process produced a tag. |
| **Prompt mode / Text mode** | XGuard input modes (image-gen prompt vs. site text). |

---

## Where things live today

### XGuard text moderation

- **Caller**: [orchestrator.service.ts](src/server/services/orchestrator/orchestrator.service.ts) → `createTextModerationRequest`
- **Service wrapper**: [text-moderation.service.ts](src/server/services/text-moderation.service.ts) → `submitTextModeration` (hashes content for dedup, writes pending row)
- **Webhook**: [src/pages/api/webhooks/text-moderation-result.ts](src/pages/api/webhooks/text-moderation-result.ts)
- **Storage**: `EntityModeration` table ([prisma/schema.prisma](prisma/schema.prisma)) — fields: `entityType`, `entityId`, `workflowId`, `status`, `blocked`, `triggeredLabels[]`, `result` (slimmed JSON), `contentHash`
- **Slimming**: `slimTextModerationOutput` / `slimPromptModerationOutput` in [entity-moderation.service.ts](src/server/services/entity-moderation.service.ts) — drops internal fields, **keeps only triggered labels**. ⚠️ Lossy for tuning; we want non-triggered scores too to find near-misses. Slimming happens **in civitai**, not the orchestrator — so the webhook handler has access to the full payload before it's discarded.
- **Retry job**: [src/server/jobs/text-moderation-retry.ts](src/server/jobs/text-moderation-retry.ts)
- **Currently used by**: `Article` entity type only.

### Image ingestion

- **Webhook**: [src/pages/api/webhooks/image-scan-result.ts](src/pages/api/webhooks/image-scan-result.ts) — handles legacy POST + new orchestrator workflow format
- **Processor**: [image-scan-result.service.ts](src/server/services/image-scan-result.service.ts) → `processImageScanWorkflow` — parses `wdTagging`/`mediaRating`/`mediaHash` steps. The `mediaRating` type definition is what needs to be extended for the new fields.
- **Storage**:
  - `Image` table: `nsfwLevel: Int`, `minor: Boolean`, `poi: Boolean`, `needsReview: String?`, `blockedFor: String?`, `ingestion: ImageIngestionStatus`, `scanJobs: Json?`
  - `TagsOnImageDetails`: `automated`, `disabled`, `needsReview`, `confidence`, `source: TagSource`
  - `ImageTagForReview`: review queue (per-image, per-tag)
- **Review trigger conditions** (current logic in [image-scan-result.ts](src/pages/api/webhooks/image-scan-result.ts:697-733)): `child-10/13/15` + realistic, POI word-list match, `nsfwLevel === Blocked`, moderator-specific tags.
- **Tag rules**: [src/server/utils/tag-rules.ts](src/server/utils/tag-rules.ts) — replacements, appends, computed combos.

### Cross-cutting

- **Moderation word blocklists**: loaded from Redis `ENTITY_MODERATION` cache via [moderation-utils.ts](src/server/utils/moderation-utils.ts).
- **Moderation rules** (Approve/Block/Hold): `ModerationRule` Prisma model + [src/server/utils/mod-rules.ts](src/server/utils/mod-rules.ts).
- **Existing moderator review surfaces**: [src/pages/moderator/images.tsx](src/pages/moderator/images.tsx), [image-rating-review.tsx](src/pages/moderator/image-rating-review.tsx), [prompt-audit-test.tsx](src/pages/moderator/prompt-audit-test.tsx). New tuning-review UI will also live under `/moderator/*`.
- **ClickHouse**: [src/server/clickhouse/client.ts](src/server/clickhouse/client.ts) `Tracker` class — currently used for analytics events. We'll add a `scanner_label_results` table here for per-label scan score indexing (not raw outputs — those stay in the orchestrator and snapshot to Postgres on review).

---

## What's missing for prompt tuning

The current storage is optimized for **acting on** scanner results (block, hold, tag the image), not for **studying** them to tune the scanners. Specifically:

1. **No raw input record.** `EntityModeration` stores content hashes, not the content itself. For image ingestion, the original orchestrator response isn't preserved verbatim — it's normalized into tag rows and discarded.
2. **Slimmed/lossy output.** `slimTextModerationOutput` discards non-triggered label details. We can't see which labels almost-fired (near-misses), which is critical for finding false negatives and threshold tuning.
3. **No false-positive feedback loop.** `ImageTagForReview` exists for image tags but there's no analogous structure for "moderator says this XGuard label was wrong" or "this whole ingestion classification was a false positive."
4. **No per-policy versioning.** When we change a policy, we have no way to compare results before/after. Need a `policyVersion` (or hash of the policy string) recorded with each scan.
5. **Hard to slice for AI analysis.** Mixed across `EntityModeration.result` JSON blobs, `TagsOnImageDetails` rows, and `Image` flags. No single table where each row = one scanner decision an AI can chew on.

---

## XGuard policy management

XGuard policies are owned by civitai and stored in Redis, not in the orchestrator. This gives the tuning team iteration speed — edit a policy in the moderator UI, the next scan call uses the new text — without redeploying the orchestrator. It also gives us an exact, civitai-side `policyVersion` to record in the audit log: the hash of the string we sent.

**Redis schema** — one hash field per label:

```text
Key:    xguard:policies
Field:  <labelName>            // e.g. 'csam', 'impersonation'
Value:  JSON {
  policy: string,              // the policy text sent to the model
  threshold: number,           // score cutoff (0-1)
  action: string,              // 'Block' | 'Hold' | etc.
  policyHash: string,          // self-describing format: 'sha256-8:a3f5b2c8'
  updatedAt: string,           // ISO timestamp
  updatedBy: number,           // moderator userId
}
```

`policyHash` uses a **self-describing format** (`<algo>-<length>:<hex>`) so if we ever change the algorithm or hash length later, old entries are still parseable and new entries are unambiguous — no backfill.

**At XGuard request time** (inside `createXGuardModerationRequest`):

1. `HMGET xguard:policies <labels...>` to fetch any configured entries.
2. For each label with a Redis entry: include in `labelOverrides` (using all four fields: label, policy, threshold, action).
3. **Labels without a Redis entry are dropped.** They are not passed in the `labels` filter either. Civitai is the source of truth for which XGuard labels run via this code path — if a label isn't configured, it isn't evaluated.
4. Compute the `policyVersions` map: `{ [label]: policyHash }` for each overridden label. Stash in workflow metadata.
5. Also stamp `modelVersion = '1'` in workflow metadata (hardcoded for now; will become configurable later when XGuard model versioning is needed).
6. If no labels have Redis entries, short-circuit — don't submit a no-op workflow.

**At webhook time** (audit writer):

- For each label result in the response, read `workflow.metadata.policyVersions[label]` to populate the `policyVersion` column.
- Read `workflow.metadata.modelVersion` for the `modelVersion` column.
- These values come from what civitai actually sent, so the audit log is honest about the policy text used — even if a mod edits the policy between scan submit and webhook callback.

**UI / tRPC layer** (`/moderator/xguard-policies`, admin-gated):

- `list()` — paginated list of configured labels for browsing.
- `get(label)` — fetch a single entry for editing.
- `upsert(label, { policy, threshold, action })` — set/update; the route computes `policyHash` at write time and stamps `updatedAt`/`updatedBy`.
- `delete(label)` — remove the override (effectively disables the label, since labels without Redis entries are dropped from scan requests).

---

## Proposed data layer — ClickHouse + Postgres

**Constraint**: high scan volume + low write overhead. ClickHouse is already running in civitai (the `Tracker` class in [src/server/clickhouse/client.ts](src/server/clickhouse/client.ts)), so it's existing infra, not a new dependency. Webhook handlers receive the full un-slimmed scanner output before any operational consumer discards non-triggered details, so we can capture everything without orchestrator-team coordination.

**Split by access pattern:**

- **Orchestrator API** — source of truth for raw scanner outputs. 30-day TTL. Fetched on demand when a moderator opens a scan for review.
- **ClickHouse `scanner_label_results`** — append-only index of per-label scores. Drives queue filtering ("show me recent scans where label X triggered"), near-miss FN browsing (`triggered = false ORDER BY score DESC`), and corpus-wide distribution analysis. One small row per (scan, label).
- **Postgres `ScannerScanReview` + `ScannerReview`** — moderator review state. Only contains data for reviewed scans. `ScannerScanReview.rawOutput` snapshots the orchestrator output on submit, so reviewed scans are durable past the 30-day orchestrator window.

We do **not** store raw scanner outputs in ClickHouse. Orchestrator + on-review Postgres snapshot covers that need; ClickHouse is the index, not the corpus.

### ClickHouse: `scanner_label_results` — one row per label evaluated

```sql
CREATE TABLE scanner_label_results (
  workflowId     String,
  scanner        LowCardinality(String),    -- 'image_ingestion' | 'xguard_text' | 'xguard_prompt'
  entityType     LowCardinality(String),    -- 'image' | 'article' | 'comment' | ...
  entityId       String,
  createdAt      DateTime,
  label          LowCardinality(String),    -- 'nsfw_level' | 'minor' | 'ai' | 'anime' | 'is_blocked' | 'csam' | 'impersonation' | ...
  labelValue     LowCardinality(String),    -- multi-class value (e.g. 'x' for nsfw_level); empty for binary labels
  score          Float32,                   -- confidence or first-token prob, 0-1
  threshold      Nullable(Float32),
  triggered      UInt8,                     -- did this signal fire
  policyVersion  LowCardinality(String),    -- per-label policy hash (e.g. 'sha256-8:a3f5b2c8') or 'default' when no override
  modelVersion   LowCardinality(String),    -- workflow-level model version; hardcoded '1' for now
  modelReason    String                     -- only populated when triggered = 1; empty otherwise
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(createdAt)
ORDER BY (scanner, label, triggered, createdAt)
```

`modelReason` is the XGuard per-label explanation text. It's disabled by default in prod and can be a wall of text when enabled — so the write path only populates it on rows where `triggered = 1`, leaving it empty for the (much more numerous) non-triggered rows. This keeps the long-text rows confined to the small fraction of scans where the explanation actually carries signal. ClickHouse compresses empty `String` columns near-zero cost.

The `(scanner, label, triggered, createdAt)` sort key makes the mod queue's primary query — "recent scans of scanner S where label L is in state T" — a tiny range scan. Same shape powers near-miss FN browse: `WHERE scanner='xguard_text' AND label='csam' AND triggered=0 ORDER BY score DESC`.

### Write paths

**Image ingestion** (`mediaRating` step) — in [processImageScanWorkflow](src/server/services/image-scan-result.service.ts), after operational work completes, emit one batched insert of ~4-5 rows (one per `mediaRating` signal):

| label | labelValue | score | triggered |
| --- | --- | --- | --- |
| `nsfw_level` | `'x'` | 1 (from rating) | always 1 |
| `is_blocked` | `''` | 1 if blocked else 0 | `isBlocked` |
| `minor` | `''` | max `topK` minor-band prob across detections | any detection `isMinor` |
| `ai` | `'AI'` or `'real'` | `aiRecognition.confidence` | `label === 'AI'` |
| `anime` | `'anime'` or `'non-anime'` | `animeRecognition.confidence` | `label === 'anime'` |

**XGuard text/prompt** — in [text-moderation-result.ts](src/pages/api/webhooks/text-moderation-result.ts), **before** `slimTextModerationOutput` runs (the slimmer drops non-triggered scores). One batched insert of N rows, one per label evaluated. The existing slim+persist flow into `EntityModeration` continues unchanged for operational consumers.

Both writes are fire-and-forget with retry — a ClickHouse failure must not block the operational webhook.

**Volume:** writing every row (not just "interesting" ones) keeps the logic simple and gives the tuning team distribution data for free. ClickHouse compresses well on the highly repetitive per-label rows, so the cost is small.

### Postgres: two tables for moderator verdicts

Two-table design separates "this scan has been reviewed by mod X" from "mod X had a specific verdict on label Y." This matters because moderators won't review every scan, work in intermittent sessions, and need to be able to pick up with the latest items without needing continuity from a prior session.

```prisma
model ScannerScanReview {
  id         Int      @id @default(autoincrement())
  workflowId String   // links to ClickHouse scanner_label_results.workflowId
  reviewedBy Int      // userId of moderator
  reviewedAt DateTime @default(now())
  note       String?

  @@unique([workflowId, reviewedBy])
  @@index([reviewedAt])
}

model ScannerReview {
  id         Int           @id @default(autoincrement())
  workflowId String        // links to ClickHouse scanner_label_results.workflowId
  label      String        // the specific label being verdict'd
  reviewedBy Int           // userId of moderator
  reviewedAt DateTime      @default(now())
  verdict    ReviewVerdict // true_positive | false_positive | true_negative | false_negative | unsure
  note       String?

  @@unique([workflowId, label, reviewedBy])
  @@index([workflowId])
  @@index([verdict, label])
}
```

Semantics:

- `ScannerScanReview` row = "moderator X completed reviewing scan Y." Written when the mod hits Submit. One row per (scan, mod) lets multiple mods review the same scan for inter-rater reliability.
- `ScannerReview` row = "moderator X had verdict V on label L for scan Y." Only written when the mod explicitly clicks a verdict — labels they didn't touch have **no row**.
- An untriggered label with no `ScannerReview` row but a corresponding `ScannerScanReview` row = confirmed-correct-by-omission. The completion row implies "I looked at the whole scan and didn't flag this label as a miss."

Why this shape works:

- Moderator UI default queue: `scanner_label_results` rows (deduped by workflowId) with no matching `ScannerScanReview` for the current mod, ordered by `createdAt DESC` (latest-first). Mod works through what they can, comes back later, picks up from the new latest.
- `policyVersion` makes A/B'ing policy changes trivial: group verdicts and completions by `(label, policyVersion)`.
- Raw operational tables (`Image`, `EntityModeration`, etc.) stay untouched.

**Multi-moderator and `unsure` defaults:**

- Multi-mod is supported by default (the `(workflowId, reviewedBy)` unique constraint, not `workflowId` alone). Two mods reviewing the same scan is allowed and useful for inter-rater agreement metrics.
- `unsure` is a valid verdict but must be excluded from FP/FN rate denominators in analysis queries (it inflates uncertainty rather than indicating ground truth).

### Service interface

All writes to ClickHouse + Postgres go through a single `scanner-audit.service.ts`. Webhook handlers call it; nothing else does. Keeps the boundary clean for a future extraction to a standalone service.

---

## Open questions

- **Policy versioning source of truth.** Where do XGuard label policies live today? In the orchestrator config, or are they sent from this repo? Need to know to record a meaningful `policyVersion`.
- **Retention.** Raw scanner inputs (especially full image-gen prompts) can be sensitive. Do we PII-scrub before storing, or partition by retention class?
- **Existing `EntityModeration` rows.** Do we backfill them into `scanner_label_results` or keep parallel histories?
- **`AiRecognition` / `AnimeRecognition` TagSource enum values.** Add to the Prisma enum, or reuse `Computed` and accept lossy provenance?
- **`tagsNeedingReview` interaction.** New `minor` tag from `MinorDetection` source is a stronger signal than the hand-curated list. Should the audit logic branch on source, or just append `minor` to the list?
- **Transition: old workflows still in flight.** Code must treat the four new `mediaRating.output` fields as optional. Worth confirming whether to log a "missing-new-fields" metric so we can tell when the transition window closes.
