# Scanner Prompt Tuning — Context

This doc captures the moving pieces involved in tuning the prompts/policies we send to our content-moderation scanners. It's written as orientation for future Claude sessions — read this before touching scanner code or designing review/analysis tooling.

The **goal of this project**: record scanner inputs + outputs in a structured way so moderators can mark false positives and we (or an AI) can analyze patterns to adjust the scanner prompts/policies.

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

**Current orchestrator output shape** (newer format — see "Open questions" below; the repo still parses the older `wdTagging`/`mediaRating`/`mediaHash` shape):

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

Each of these fields becomes a **tag/label** for the image:
- `nsfwLevel` value (e.g., `x`) → tag
- `minor` (from `ageClassification.detections[].isMinor`) → tag
- `ai` (from `aiRecognition.label`) → tag
- `anime` (from `animeRecognition.label`) → tag

---

## Glossary (terms get reused with different meanings — watch out)

| Term | Meaning |
|---|---|
| **Label** | An XGuard policy name. One label = one binary classifier call. E.g., `nsfw`, `csam`, `impersonation`. |
| **Policy** | The natural-language prompt text describing what makes the label apply (`x`) vs. not (`sec`). This is what we're trying to tune. |
| **Tag** | A token attached to an image after ingestion classification. Stored in `TagsOnImageDetails`. Different concept from XGuard "label" — but for this project we treat both as flat string keys per scan result. |
| **nsfwLevel** | On the `Image` table: numeric enum (`1=PG, 2=PG13, 4=R, 8=X, 16=XXX, 32=Blocked`). In the new ingestion output: a string (`"x"`, `"r"`, etc.). |
| **Source** | `TagSource` enum: `WD14`, `Clavata`, `Hive`, `SpineRating`, `MinorDetection`, `HiveDemographics`, `Computed`, `User`. Identifies which model/process produced a tag. |
| **Prompt mode / Text mode** | XGuard input modes (image-gen prompt vs. site text). |

---

## Where things live today

### XGuard text moderation
- **Caller**: [orchestrator.service.ts](src/server/services/orchestrator/orchestrator.service.ts) → `createTextModerationRequest`
- **Service wrapper**: [text-moderation.service.ts](src/server/services/text-moderation.service.ts) → `submitTextModeration` (hashes content for dedup, writes pending row)
- **Webhook**: [src/pages/api/webhooks/text-moderation-result.ts](src/pages/api/webhooks/text-moderation-result.ts)
- **Storage**: `EntityModeration` table ([prisma/schema.prisma](prisma/schema.prisma)) — fields: `entityType`, `entityId`, `workflowId`, `status`, `blocked`, `triggeredLabels[]`, `result` (slimmed JSON), `contentHash`
- **Slimming**: `slimTextModerationOutput` / `slimPromptModerationOutput` in [entity-moderation.service.ts](src/server/services/entity-moderation.service.ts) — drops internal fields, **keeps only triggered labels**. ⚠️ This is lossy for our tuning use case; we want non-triggered scores too to find near-misses.
- **Retry job**: [src/server/jobs/text-moderation-retry.ts](src/server/jobs/text-moderation-retry.ts)
- **Currently used by**: `Article` entity type only.

### Image ingestion
- **Webhook**: [src/pages/api/webhooks/image-scan-result.ts](src/pages/api/webhooks/image-scan-result.ts) — handles legacy POST + new orchestrator workflow format
- **Processor**: [image-scan-result.service.ts](src/server/services/image-scan-result.service.ts) → `processImageScanWorkflow` (currently parses `wdTagging`/`mediaRating`/`mediaHash`)
- **Storage**:
  - `Image` table: `nsfwLevel: Int`, `minor: Boolean`, `poi: Boolean`, `needsReview: String?`, `blockedFor: String?`, `ingestion: ImageIngestionStatus`, `scanJobs: Json?`
  - `TagsOnImageDetails`: `automated`, `disabled`, `needsReview`, `confidence`, `source: TagSource`
  - `ImageTagForReview`: review queue (per-image, per-tag)
- **Review trigger conditions** (current logic in [image-scan-result.ts](src/pages/api/webhooks/image-scan-result.ts:697-733)): `child-10/13/15` + realistic, POI word-list match, `nsfwLevel === Blocked`, moderator-specific tags.
- **Tag rules**: [src/server/utils/tag-rules.ts](src/server/utils/tag-rules.ts) — replacements, appends, computed combos.

### Cross-cutting
- **Moderation word blocklists**: loaded from Redis `ENTITY_MODERATION` cache via [moderation-utils.ts](src/server/utils/moderation-utils.ts).
- **Moderation rules** (Approve/Block/Hold): `ModerationRule` Prisma model + [src/server/utils/mod-rules.ts](src/server/utils/mod-rules.ts).
- **Existing moderator review surfaces**: [src/pages/moderator/images.tsx](src/pages/moderator/images.tsx), [image-rating-review.tsx](src/pages/moderator/image-rating-review.tsx), [prompt-audit-test.tsx](src/pages/moderator/prompt-audit-test.tsx).
- **ClickHouse**: [src/server/clickhouse/client.ts](src/server/clickhouse/client.ts) `Tracker` class — currently used for analytics events, not for moderation-scanner raw outputs.

---

## What's missing for prompt tuning

The current storage is optimized for **acting on** scanner results (block, hold, tag the image), not for **studying** them to tune the scanners. Specifically:

1. **No raw input record.** `EntityModeration` stores content hashes, not the content itself. For image ingestion, the original orchestrator response isn't preserved verbatim — it's normalized into tag rows and discarded.
2. **Slimmed/lossy output.** `slimTextModerationOutput` discards non-triggered label details. We can't see which labels almost-fired (near-misses), which is critical for finding false negatives and threshold tuning.
3. **No false-positive feedback loop.** `ImageTagForReview` exists for image tags but there's no analogous structure for "moderator says this XGuard label was wrong" or "this whole ingestion classification was a false positive."
4. **No per-policy versioning.** When we change a policy, we have no way to compare results before/after. Need a `policyVersion` (or hash of the policy string) recorded with each scan.
5. **Hard to slice for AI analysis.** Mixed across `EntityModeration.result` JSON blobs, `TagsOnImageDetails` rows, and `Image` flags. No single table where each row = one scanner decision an AI can chew on.

---

## Proposed data layer (sketch — to be turned into a plan next)

Design constraint from the user: results should live in **separate tables** optimized for AI analysis and moderator review of false positives.

**Recommendation**: Postgres (Prisma) for both. Volumes are bounded (per-prompt and per-image-upload, not per-pageview); existing scanner storage is already in Postgres; moderator review tooling is Postgres-friendly. Spill to ClickHouse later only if volume forces it.

Two tables, normalized for analysis:

### `ScannerScan` — one row per scanner invocation
- `id`, `createdAt`
- `scanner`: `xguard_text` | `xguard_prompt` | `image_ingestion`
- `subject` (polymorphic): `entityType` + `entityId`, OR `imageId`
- `inputContent`: full text (XGuard) or reference to image (ingestion)
- `inputHash`: for dedup / linking re-scans
- `policyVersion`: hash or version label of the policy/prompt config used
- `rawOutput: Json` — full untruncated orchestrator response

### `ScannerLabelResult` — one row per label evaluated in a scan
- `scanId` → `ScannerScan`
- `label`: e.g., `nsfw`, `csam`, `minor`, `anime`, `ai`, `nsfwLevel.x`
- `score: Float` — first-token prob (XGuard) or model confidence (ingestion)
- `threshold: Float?` — what we compared against
- `triggered: Boolean` — did it cross threshold
- `modelReason: String?` — when available
- **Review fields**:
  - `reviewedBy: Int?` (userId), `reviewedAt: DateTime?`
  - `reviewVerdict: ReviewVerdict?` — `true_positive` | `false_positive` | `true_negative` | `false_negative` | `unsure`
  - `reviewNote: String?`

This shape:
- Lets a moderator UI page through label-results, filter by `triggered=true && reviewVerdict=null`, and tag false positives in one click.
- Lets an analysis script `SELECT label, AVG(score), reviewVerdict ...` directly to surface threshold problems.
- Keeps the raw orchestrator output on `ScannerScan.rawOutput` for spot-checking without bloating the per-label rows.
- `policyVersion` makes A/B'ing policy changes trivial: compare review verdicts grouped by `(label, policyVersion)`.

---

## Open questions

- **Ingestion output format mismatch.** The shape pasted by @dev (with `ageClassification`/`faceRecognition`/`aiRecognition`/`animeRecognition`) doesn't match what [image-scan-result.service.ts](src/server/services/image-scan-result.service.ts) currently parses (`wdTagging`/`mediaRating`/`mediaHash`). Is this a newer orchestrator output we'll be receiving going forward? Is the consumer code in flight? — need to confirm before we commit to a `rawOutput` schema.
- **Policy versioning source of truth.** Where do XGuard label policies live today? In the orchestrator config, or are they sent from this repo? Need to know to record a meaningful `policyVersion`.
- **Retention.** Raw scanner inputs (especially full image-gen prompts) can be sensitive. Do we PII-scrub before storing, or partition by retention class?
- **Existing `EntityModeration` rows.** Do we backfill them into the new `ScannerScan` table or keep parallel histories?
