# Prompt Snippets — v1 Plan

**Status:** v1 scope, ready for build planning.
**Companion docs (deeper detail / future scope):**

- [prompt-snippets.md](./prompt-snippets.md) — full product/UX vision (includes post-v1 picker UX)
- [prompt-snippets-schema.md](./prompt-snippets-schema.md) — schema spec (authoritative for table definitions)
- [prompt-snippets-schema-examples.md](./prompt-snippets-schema-examples.md) — populated table walkthrough
- [prompt-snippets-provisioning-job.md](./prompt-snippets-provisioning-job.md) — server job that creates `WildcardSet` rows from published wildcard models
- [prompt-snippets-nested-resolution.md](./prompt-snippets-nested-resolution.md) — **post-v1**, kept for when nested resolution lands

This doc is the slim, opinionated v1 scope. Anything not listed in §3 is **deferred** (see §4 for the deferred list).

---

## 1. The feature in one paragraph

Users reference reusable prompt content in their generator prompts via `#category` syntax (e.g. `"A #character walking through #setting"`). At submission time the server expands those references using values from wildcard sets the user has loaded. v1 ships the slim shape: no per-value selection UI, no nested resolution, no cross-device library — just chip insertion, "include the whole category," and either single-step random-mode submissions (default) or batched cartesian fan-out.

---

## 2. Key concepts

- **WildcardSet** — global content table. Two kinds:
  - `kind = System`: imported from a Civitai wildcard-type model. Globally cached, shared across all users. Pre-provisioned on publish via the provisioning job (see [prompt-snippets-provisioning-job.md](./prompt-snippets-provisioning-job.md)). Immutable.
  - `kind = User`: owned by one user. Created lazily on first "save to my snippets." Mutable (CRUD on values, with re-audit on every change).
- **WildcardSetCategory** — categories within a set (e.g. `character`, `setting`). Each holds a `text[]` of value strings. Per-category audit + `nsfwLevel`.
- **No `UserWildcardSet` join table.** The user's own User-kind set is queryable by `ownerUserId`. Additional wildcard sets the user has loaded live in the form's localStorage (graph node state). Loaded-set IDs are validated server-side at submit time (System-kind = public; User-kind = `ownerUserId == submitter`).
- **`snippets` node in the generation-graph.** Inside `input` (the serialized graph), alongside the existing prompt, negativePrompt, resources, sampler, etc. nodes. Carries the user's wildcard-set IDs, mode, batchCount, and per-target reference state.
- **Single reference syntax.** `#category` everywhere. Imported wildcard files have source-file `__name__` rewritten to `#name` at import time.

---

## 3. v1 scope (what's IN)

### Schema

Three new tables, three enums, one CHECK constraint, citext extension. See [prompt-snippets-schema.md](./prompt-snippets-schema.md) for full Prisma definitions and indexes.

| Table | Purpose |
|---|---|
| `WildcardSet` | Global content. `kind: System \| User` discriminator. System-kind has `modelVersionId` FK; User-kind has `ownerUserId` FK + user-given `name`. Audit aggregate, `isInvalidated` flag. |
| `WildcardSetCategory` | Categories within a set. `name CITEXT`, `values text[]`, per-category `auditStatus` and `nsfwLevel`. System-kind is immutable; User-kind is mutable with re-audit on each change. |
| `PromptSnippet` | (Existing in feature plan, but *not in v1* — see §4.) Skipped: User-kind WildcardSet covers the same purpose. |

**Not in v1:** `UserWildcardSet` (deferred, see §4).

### Form behavior

- **Tiptap-based prompt + negativePrompt editors.** Same component on desktop and mobile. Chip rendering for `#category` references is consistent across surfaces.
- **Autocomplete on `#`.** Typing `#` opens a popover listing categories from the user's loaded wildcard sets. Selecting one inserts a `#category` chip into the editor. *The popover is for category discovery only — there's no per-value selection in v1.*
- **The chip is always minimal in v1** — `#character`, no verbose form, no popup, no drawer. Just the reference token.
- **Snippets node in the generation graph.** Carries `wildcardSetIds`, `mode`, `batchCount`, `targets`, optional `seed`. Each editor node has a dependency on the snippets node and reads its slice (`snippets.targets[<editorNodeName>]`) to render chips.
- **On form mount:**
  1. Fetch the user's own User-kind set ID via `getMyUserWildcardSet()` (lazy-creates on first call). Auto-prepend to `wildcardSetIds`.
  2. Read additional `wildcardSetIds` from localStorage (set IDs added via "create" clicks on wildcard model pages).
  3. Fetch full set details via `getWildcardSets({ ids })`. Server filters out IDs the user can't access (e.g. invalid User-kind ownership). Pruned IDs silently drop from form state.
  4. Render any chip in the prompts referencing a category that no longer resolves with a **red badge state** ("orphaned" — source set removed or category gone).
- **What the read API returns — and what it doesn't.** `getWildcardSets` and `getMyUserSet` return per-set metadata (id, kind, name, audit/invalidated flags) and per-category metadata (id, name, displayOrder, valueCount, auditStatus, nsfwLevel) — enough for autocomplete, chip rendering, and audit-aware UI. They deliberately **do not** ship the `values` array. The client never holds values in memory unless a picker drawer for one specific category is open and the user is actively choosing `in`/`ex` values; v1 has no picker drawer, so v1 clients receive zero values from any read endpoint. Preview and submit run the resolver entirely server-side — values stay on the server.
- **Adding a wildcard set:** clicking "create" on a wildcard model page adds that set's ID to the form's localStorage `wildcardSetIds`. No DB write. The set is immediately available for `#category` autocomplete.
- **User's own User-kind set is always loaded** — not opt-in.

### Submission shape

The `snippets` data lives inside `input` (the serialized generation-graph), as one node alongside the others.

```ts
type SnippetReference = {
  category: string;
  // empty selections array = "use full pool" (the v1 default)
  selections: { categoryId: number; in: string[]; ex: string[] }[];
};

// Lives inside the generation-graph, carried by `input`
type SnippetsNode = {
  wildcardSetIds: number[];   // set IDs active at submit time
  mode?: 'batch' | 'random';  // default 'random'
  batchCount?: number;        // default 1
  seed?: number;              // optional; only present if user hit "preview"
  targets: Record<string, SnippetReference[]>;
  // Conventional target keys for v1: 'prompt', 'negativePrompt'.
};
```

**Selection semantics (`in`/`ex`):**

- Both empty → use full pool from this source category.
- `in` only → strict whitelist; use only those values.
- `ex` only → full pool minus those values.
- Both set → `in − ex`. (If a value is in both, `ex` wins.)

In v1, **selections are typically `[]`** — the picker UI for picking individual values isn't built yet. Users effectively always use the full pool. The `in`/`ex` shape is forward-looking for when we add granular selection.

**Mode + batchCount defaults:**

- `mode` defaults to `'random'` — each submission produces independent random picks per step.
- `batchCount` defaults to `1` — single workflow step per submission.
- Together: the default v1 submission is "one workflow step with one random sample per `#category` reference."

**`snippets.seed` (preview only):**

- Only present in submission if the user hit the "preview" button before submitting.
- Used by the resolver so client-side preview and server-side resolution produce identical expansions.
- **Not persisted** to `workflow.metadata.params.snippets` — remixes intentionally don't lock the same random picks.
- Distinct from the image-gen `seed` from `seedNode` in generation-graph sub-graphs.

### Workflow metadata

Persisted at `workflow.metadata.params.snippets` — same place as other graph form data (prompt, negativePrompt, image-gen seed, etc.) — **but only when the resolver actually fired**. Submissions whose snippets node sat at defaults (no `#refs`, `batchCount = 1`) skip the persistence entirely so non-snippet generations aren't polluted with an empty `{ wildcardSetIds: [], mode: 'random', batchCount: 1 }` blob. The `wildcards` workflow tag is the canonical "did this use snippets" signal.

When the resolver did fire, the orchestrator overwrites `snippets.targets` with the parsed-refs snapshot (server-side parse of each template's `#refs`) and drops `snippets.seed` — that field is preview-only and remixes should re-roll the random picks. Targets whose template had zero `#refs` are omitted entirely: the persisted `targets` map is the historical record of "editors that had refs to substitute," not "editors that could have accepted snippets." (The graph state's `snippets.targets` is the latter; see §"Snippets node target registration" below.)

```jsonc
{
  // workflow.metadata
  "params": {
    "prompt": "A #character in #setting",
    "negativePrompt": "blurry, ugly",     // had no #refs, omitted from snippets.targets below
    "seed": 847291,                       // image-gen seed (existing)
    /* ... other graph form fields ... */
    "snippets": {
      "wildcardSetIds": [490, 491],
      "mode": "random",                   // or "batch" if user opted in
      "batchCount": 1,                    // or higher for batch mode
      "targets": {
        "prompt": [
          { "category": "character", "selections": [] },
          { "category": "setting",   "selections": [] }
        ]
        // No "negativePrompt" key — the editor accepted snippets but its
        // template had no #refs in this submission.
      }
      // No "seed" field here either, even if the submission had one.
    }
  },
  "tags": [..., "wildcards"]
}
```

`wildcards` tag is added to `workflow.tags` whenever the resolver actually fan-out — i.e. when the submission had at least one `#ref` to expand or requested `batchCount > 1`. A submission that carried a snippets node at defaults (no refs, no batch) does NOT get the tag. Cheap analytical filter for "did this generation use snippets in earnest?"

### Server resolution

- For each `#category` reference in each target's template:
  1. Look up matching categories across `wildcardSetIds`. Filter by `auditStatus = 'Clean'` and `nsfwLevel` matching the request site context.
  2. If `selections` is empty, use the full merged pool from those categories.
  3. If `selections` is non-empty, apply `in`/`ex` per source category to filter.
- Resolve mode:
  - **`random` (default):** for each of `batchCount` steps, pick one value per reference using PRNG keyed by `(seed ?? generationSeed, stepIndex, targetId, refPosition)`.
  - **`batch`:** enumerate cartesian across all targets' references, sample down to `batchCount` if over via Fisher-Yates keyed by `(seed ?? generationSeed)`.
- Substitute values into each target's template literally. **No nested expansion** in v1 — values containing `#name` or `__name__` references substitute as-is. (This is a v1 limitation; some imported wildcard models that rely on nested resolution will produce literal `#refs` in the final prompt. See §4.)
- Return one record per step: `{ targetId → substitutedString }`. Each step's `params.prompt` and `params.negativePrompt` get those values.

### Step metadata

When the resolver fires, each step's `metadata.params` records ONLY the substituted snippet-target fields (e.g. `{ prompt: "<substituted>", negativePrompt: "<substituted>" }`) — NOT a full copy of workflow params. The workflow-level `params` already carries the template + every other field, so duplicating them on every step is wasted bytes. The per-step delta IS the substituted text; everything else is the same as the workflow.

For non-snippet runs (or snippet runs that resolved to no refs), step metadata stays vanilla — handler-set fields only (e.g. `suppressOutput` for multi-step workflows), no `params` field added by the orchestrator.

The fully-substituted text also lives in `step.input.imageMetadata` (the EXIF-embedded blob) regardless of source, so single-image remix continues to work without any snippet awareness in the orchestrator's downstream consumers.

### Snippets node target registration

The graph-state `snippets.targets` map is populated by the text editors themselves, not declared up front by the ecosystem subgraph. `snippetsGraph` ships with `targets: {}`; each `createTextEditorGraph(...)` call (the factory behind `promptGraph`, `negativePromptGraph`, and any future text editor) adds a small effect that, whenever the `snippets` node is reachable in the active subgraph, writes its own `name` into `snippets.targets[name] = []`.

Consequences:

- An ecosystem subgraph that wants snippet support merges `snippetsGraph` once (no target list). Adding or removing a text editor changes which targets appear in `snippets.targets` automatically.
- Workflows whose discriminator branches contain different text editors (e.g. flux2-klein's `negativePrompt` only in the base mode, or wan-image's `negativePrompt` only on v2.7) get an accurate per-branch target list — the registration effect fires for editors that are active in the current branch and stays silent for ones that aren't.
- Subgraphs that don't merge `snippetsGraph` (image upscale, background-removal, video interpolation) have no `snippets` in ctx; the registration effect short-circuits and is a no-op.

The persisted `workflow.metadata.params.snippets.targets` (above) is a different map: it's the orchestrator's parsed-refs snapshot for THIS submission, with empty entries stripped. Graph state's `targets` = "editors that accept snippets right now"; persisted `targets` = "editors that had refs to substitute in this submission."

### Wildcards models vs generation resources

A `Wildcards`-type ModelVersion is **not** a generation resource. The generator never consumes it directly the way it consumes a Checkpoint or LoRA; its only role is as the published source for a System-kind `WildcardSet`, and at submit time what matters is the `WildcardSet.id` (which the resolver reads from), not the ModelVersion id (which a handler would otherwise wire as a generation resource).

This creates a normalization rule: anywhere a `Wildcards`-type ModelVersion shows up — as a resource the user picked, as a preset's resource entry, as a remixed generation's resource list, or as the source of a "Generate" click on a wildcard-model detail page — the entry's `wildcardSetId` is routed into `snippets.wildcardSetIds`, never into the generator's `resources[]` array. By the time the orchestrator runs, `resources[]` contains only generation resources (Checkpoints, LoRAs, VAEs, etc.) — Wildcards never reach it.

**Two layers of server-side support; the client owns the routing.**

1. **`getResourceData` stamps `wildcardSetId` and computes `canGenerate`.** When enriching a list of ModelVersion ids, any row whose `model.type === 'Wildcards'` gets:
   - `wildcardSetId?: number` stamped on the returned `GenerationResource`, resolved to the corresponding System-kind `WildcardSet.id`.
   - `canGenerate` overridden to reflect WildcardSet visibility at the request's site context. A non-invalidated set with `auditStatus != 'Dirty'` AND `(nsfwLevel & allowedFlag) != 0` (SFW flag on `.com`, all-levels flag on `.red`) is `canGenerate: true`. The standard `getResourceCanGenerate` path returns false for Wildcards baseModels (they're not on the generation-supported list), so this override is what lets the model detail page enable its "Generate" button for a published, visible wildcard set. The visibility check is a single-table query against `WildcardSet` columns — see "Set-level rollups" below for why this avoids a category sub-query.

2. **Resource picker filters by `hasGenerationSupport`.** The form's resource picker passes `generation: true` to `getResourceData`, which strips out anything whose baseModel isn't generation-supported — Wildcards models are filtered out at this gate. Users can't add a Wildcards model to the `resources` array through the picker; it never shows up as an option.

**Client-side routing.** When a wildcard enters the form (via the "Add wildcard set" button, the wildcard model detail page's "Generate" click, or a preset / remix that carries a `wildcardSetId`-stamped resource), the form reads the `wildcardSetId` field and appends it to `snippets.wildcardSetIds`. The wildcard never lives in the `resources` graph node.

**Edge case — active subgraph doesn't support snippets.** Some workflows (`vid2vid:upscale`, `img2img:remove-background`, video interpolation) don't merge `snippetsGraph` and have no `snippets` node in ctx. A preset loaded into such a workflow with wildcards present **silently drops** the wildcard entries (matching how ecosystem-incompatible resources already vanish today). A soft warning surfaces in the UI so the user understands their wildcards aren't active.

**Preset save shape.** Presets serialize wildcards as `wildcardSetIds: number[]` on `GenerationPreset.values`, NOT as Wildcards entries inside `resources`. The routing layer above is only for legacy data and external paths — anything saved through the form's own preset flow already has the canonical shape.

**Set-level rollups.** `WildcardSet` carries two aggregates maintained by the audit verdict path so visibility checks don't need to JOIN to `WildcardSetCategory`:

- `auditStatus` (`Pending | Clean | Mixed | Dirty`) — buckets the set based on its categories. `Dirty` = nothing usable, everywhere else = at least one Clean (or Pending) category exists.
- `nsfwLevel` (Int, bitwise) — OR of every non-Dirty category's `nsfwLevel`. Single-table bitmask test answers "does this set have any content visible at the current site context?"

Both aggregates are recomputed in `recomputeWildcardSetAuditStatus` whenever any category's `auditStatus` or `nsfwLevel` changes. This means hot-path checks like the model detail page's Generate button gate (`auditStatus != 'Dirty' && (nsfwLevel & allowedFlag) != 0`) hit one row, no JOIN.

**Implementation status.**

- ✅ `getResourceData` stamping + canGenerate override — see `src/server/services/generation/generation.service.ts`.
- ✅ Set-level `nsfwLevel` rollup — `WildcardSet.nsfwLevel` column + `recomputeWildcardSetAuditStatus` maintenance + backfill in the migration.
- 🚧 Form-side routing — TODO. After the form fetches enriched resources via `ResourceDataProvider`, entries with `wildcardSetId` should be dispatched into `snippets.wildcardSetIds` rather than appended to `resources`. Handled at the form's hydration boundary (preset load, remix, model-detail-page "Generate" handoff). Without this, a `wildcardSetId`-stamped resource that arrives via a preset would sit visible in the resources list until the user re-renders.

### Provisioning + audit

- **Provisioning job** (see [prompt-snippets-provisioning-job.md](./prompt-snippets-provisioning-job.md)) creates `WildcardSet` (kind: System) + `WildcardSetCategory` rows when a wildcard-type model version is published. Reconciliation job catches missed publishes. Backfill on initial deploy.
- **Audit pipeline** runs per-category. On creation (System-kind import; User-kind value mutation), category is `Pending` until the audit job processes it. The XGuard request carries two label sets:
  - **Fail labels** (`csam, urine, diaper, scat, menstruation, bestiality`): any triggered → category goes `Dirty`. Hard policy violations regardless of site context.
  - **Level labels** — restricted to `nsfw` for v1. When triggered, the category's `nsfwLevel` is set to `NsfwLevel.R` (the lowest NSFW bit); when not triggered, it defaults to `NsfwLevel.PG`. The fine-grained `pg/pg13/r/x/xxx` evaluators aren't well-tuned for text moderation yet, so we restrict to the binary `nsfw` signal for now. The schema is already bitwise (`nsfwLevel: Int`), so re-introducing severity classification later is a code-only change — no migration.
  - The callback recomputes Dirty from the per-label results — it deliberately ignores XGuard's top-level `blocked` field because that field counts level labels as triggers, which would falsely mark ordinary NSFW content as Dirty.
- Re-runs on rule-version bumps. Set-level `auditStatus` AND `nsfwLevel` aggregates are recomputed via `recomputeWildcardSetAuditStatus` after each verdict — the rollup is bitwise OR across non-Dirty categories, so a set's `nsfwLevel` always reflects "what content this set can surface." **No transitive propagation** through nested refs in v1.

### Implementation phases

Independently shippable. Backend phases first.

1. **Phase 1 — schema + audit infra.** Migration. Audit job runner + creation-time hook. No user-visible features.
2. **Phase 2 — provisioning job.** Publish-time hook + reconciliation cron + backfill. After this, every published wildcard model has a `WildcardSet`.
3. **Phase 3 — User-kind set creation flow.** "Save to my snippets" action persists values into the user's own User-kind set (lazy create). CRUD endpoints for managing it.
4. **Phase 4 — form integration: graph node + autocomplete.** `snippets` node in the generation-graph, lazy-fetch user's own set on form mount, "create" button on wildcard models adds set IDs to localStorage, autocomplete-on-`#` insertion.
5. **Phase 5 — server expansion + step fan-out.** Resolver module. Hook into `createStepInputs`. Submission accepts `snippets` node; full-pool resolution; batch + random modes; `wildcards` tag added to workflow.tags.
6. **Phase 6 — preview button.** UI button + `snippets.seed` flow. Client and server agree on expansion via shared seed.

---

## 4. Out of scope for v1 (deferred to v2 / v3)

- **Nested wildcard resolution.** Values containing `#name` / `__name__` references that should recursively expand. Currently substituted literally. **When this lands (v2/v3), both `#name` and `__name__` syntaxes will be supported in nested positions** — `#name` for content authored in our system, `__name__` for compatibility with imported wildcard models that ship with the older Dynamic Prompts convention. See [prompt-snippets-nested-resolution.md](./prompt-snippets-nested-resolution.md) for the design.
- **Per-value selection UI** — drawer, popup, or otherwise. The `in`/`ex` shape exists in the schema but the picker UI to populate them is post-v1. v1 always uses full pools.
- **Mobile R2 + desktop V8 picker designs.** These represent the post-v1 picker UX (multi-source grouped popover, slim bottom drawer on mobile). The v1 chip is minimal — no popover, no drawer, no progressive disclosure.
- **Cross-device wildcard library sync.** Without `UserWildcardSet`, loaded set IDs live only in the device's localStorage. A user moving between devices has to click "create" again on the wildcard models they want loaded. Acceptable v1 trade-off; we can add `UserWildcardSet` back as additive if user feedback demands cross-device.
- **Favorites as a distinct feature.** Implemented for v1 by liking/favoriting the wildcard model itself (existing model-favorites flow) plus copying values into the user's own User-kind set. No new "favorites" table or UI.
- **Random-pick mode UX affordances beyond the simple toggle.** v1 offers a mode toggle (`batch` vs `random`) and a `batchCount` input. No "random pool with bulk-select" UX.
- **System default wildcard set.** A Civitai-curated default loaded for first-time users with empty libraries. v1 starts users with just their own User-kind set (empty until they save into it). Tracked as a TODO ([schema doc §9](./prompt-snippets-schema.md)).
- **Audit re-run debouncing.** Rapid User-kind mutations enqueue many audit jobs; v1 doesn't coalesce. Probably fine since audit is fast.
- **Cross-user sharing of User-kind sets.** A user can't share their personal snippet collection. Future "Shared" or "Public" `kind` value would be additive.
- **Wildcard set version-diff storage.** When a wildcard model publishes a new version, no diff between old and new is stored. Users can subscribe to the new version separately.
- **Set tagging, grouping, and library-page filters beyond `sortOrder`.** No UI for organizing many wildcard sets.
- **Per-snippet labels for User-kind sets.** Values are plain text strings; users find them via reading + searching. No alias / nickname system.
- **Search indexes over wildcard content.** Postgres GIN on `text[]` is an option later; v1 uses straightforward `WHERE` clauses.

---

## 5. Open questions / TODOs (carried over)

- **🚧 Re-tighten audit filters before v1 ships.** While the audit pipeline is being built, the read API and resolver are temporarily relaxed from `auditStatus = 'Clean'` to `auditStatus != 'Dirty'` so Pending (un-audited) content is usable in dev — otherwise everything stays empty and the form/picker have nothing to show. Three call sites carry the temporary relaxation:
  - `getWildcardSets` — `categories.where` in [src/server/services/wildcard-set.service.ts](../../src/server/services/wildcard-set.service.ts)
  - `getMyUserWildcardSet` — same file
  - `expandSnippetsToTargets` — `categoryRows` query in [src/server/services/wildcard-set-resolver.service.ts](../../src/server/services/wildcard-set-resolver.service.ts)

  Each is tagged with a `TODO(prompt-snippets-v1)` comment. Before v1 reaches users, flip all three back to `'Clean'`. Dirty stays excluded throughout — relaxation only lets Pending through.
- **System default wildcard set** — mechanism for "first-time user" experience. Phase 8 of the long-term plan; not in v1.
- **`getResourceData` integration** — when adding a `Wildcard` model via the resource picker, return the matching `WildcardSet.id` so the form's snippets node can pick it up. v1 adds the equivalent via the "create" button flow on the wildcard model page; the resource-picker integration is a Phase-2 polish.
- **Audit-failure user notification** — when a wildcard model the user has loaded gets invalidated, do we notify them? v1 just reflects it on next page load (set details show "invalidated" via the auto-prune flow); explicit notifications are post-v1.
- **Cost model** — confirmed handled by the existing `whatif` query. Nothing new in v1.
- **Migration ordering** — schema changes ship as separate migrations if any land before others.

See [prompt-snippets-schema.md §9](./prompt-snippets-schema.md) for the full open-questions list against the DB design.

---

## 6. What ships at the end of v1

- A user can type `#` in their prompt and pick a category from a popover.
- The `#category` chip resolves at submit time using the full pool of values from the user's loaded wildcard sets (their own + any added via "create" on wildcard model pages).
- Default behavior is one random pick per reference per submission (`mode: 'random'`, `batchCount: 1`).
- Users can opt into batch mode + higher batch counts to fan out unique combinations across multiple workflow steps.
- A "preview" button shows the user how the prompt would resolve before submit.
- All snippet expansion happens server-side; steps look identical to no-snippet steps.
- Workflow metadata records which sets contributed and what mode/count was used; the `wildcards` tag flags snippet-using submissions.
- Per-category audit + `nsfwLevel` keep dirty content out of generation pools and route by site context.

What v1 doesn't ship: per-value picker UI, nested wildcard resolution, cross-device library sync, mobile drawer / desktop popover picker designs (those are V2 / future-target).
