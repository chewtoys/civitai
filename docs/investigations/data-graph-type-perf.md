# Investigation: making `data-graph.ts` type inference more efficient

## Goal

Reduce the type-instantiation cost of `DataGraph` builder chains in [src/libs/data-graph/data-graph.ts](../../src/libs/data-graph/data-graph.ts), so that:

1. Existing graphs typecheck faster.
2. The depth budget for `discriminator + many sibling .node(...)` chains rises enough that future ecosystems can use the discriminator pattern without hitting `error TS2589: Type instantiation is excessively deep and possibly infinite`.

This is a **library-side** investigation. Per-graph workarounds (chunking via `merge`, factory-form nodes that branch at runtime) are explicitly out of scope here — they're escape hatches, not fixes.

## Constraints

- **No public API changes** to `DataGraph`. Only internal helper types and overload return types are fair game.
- **No regression** in any existing graph (Ernie, Seedance, Flux, Stable Diffusion, Wan, etc., all currently typecheck on `main` and stay that way).
- **No compiler flag changes.** No `// @ts-nocheck`, no patched `tsc`, no raised depth limits via internals.
- **Runtime behavior preserved.** All builder methods are `as any`-cast at runtime; only the static return types are being adjusted.

## Background — what's already known

`DataGraph` ([src/libs/data-graph/data-graph.ts](../../src/libs/data-graph/data-graph.ts), ~2070 lines) is the in-house typed graph builder used to define generation forms in [src/shared/data-graph/generation/](../../src/shared/data-graph/generation/). Each ecosystem graph is one `DataGraph<Ctx, ExternalCtx>` whose `.node(...)`, `.computed(...)`, `.discriminator(...)`, `.effect(...)`, and `.merge(...)` calls thread an evolving `Ctx` type through the builder chain.

All ecosystem graphs are then composed into one `groupedDiscriminator(...)` in [src/shared/data-graph/generation/ecosystem-graph.ts](../../src/shared/data-graph/generation/ecosystem-graph.ts). That outer composition is where the depth limit ultimately bites in failure cases.

### The pain pattern (already documented)

A graph with shape `discriminator(...)` + ~12 sibling `.node(...)` calls trips TS2589. The post-discriminator nodes each re-fold a 2-branch union, and the chain compounds. See the prior investigation doc [`data-graph-typescript-depth-limit.md`](./data-graph-typescript-depth-limit.md) for the failure trace. This investigation addresses the underlying cost rather than per-graph workarounds.

### Suspect helpers (from reading the source)

By name and location in [data-graph.ts](../../src/libs/data-graph/data-graph.ts):

| Helper                    | Line          | Why it's a suspect                                                                                                                               |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Prettify<T>`             | 11            | Mapped type `{[K in keyof T]: T[K]}` — re-evaluated on every `.node()`/`.computed()`/`.merge()` call. Purely cosmetic for hover display.         |
| `MergeDistributive<A, B>` | 14            | Distributes over A and runs `Prettify` per branch. Called by every `.node()` and `.computed()`.                                                  |
| `MergePreferRight<A, B>`  | 257           | Double-distributes (over both A and B) and runs `Prettify`. Used inside `BuildDiscriminatedUnion` and `BuildGroupedDiscriminatedUnion`.          |
| `BuildDiscriminatedUnion` | 284           | Folds parent ctx into each branch via nested `MergePreferRight`. Re-evaluates `OmitDistributive<ParentCtx, DiscKey>` per branch instead of once. |
| `.node()` overloads       | 943, 965, 996 | Each takes `<const K, const Deps, T extends AnyZodSchema, M>` — `const` modifier inference can interact badly with deep distribution.            |

The codebase already opts out of `Prettify` in two places ([lines 341 and 353](../../src/libs/data-graph/data-graph.ts#L341)) "to reduce type evaluation overhead." Extending that policy is the lowest-risk lever.

## Plan

### Phase 1 — Measure against `generation-graph`

Real workload, no synthetic harness. The full repo typecheck exercises every ecosystem graph plus the outer `groupedDiscriminator`, which is exactly the cost picture we want.

**Baseline capture:**

```bash
pnpm tsc --noEmit --extendedDiagnostics --generateTrace .ts-trace
```

Record:

- Total check time
- Type instantiation count
- Top spans in the trace whose stack mentions `data-graph.ts`

Optional: a focused `tsconfig.measurement.json` that includes only `src/shared/data-graph/**` and its imports, so the trace is dominated by relevant work and easier to read in `edge://tracing`.

**What to look for:**

- Cumulative time spent in `Prettify` / `MergeDistributive` / `MergePreferRight` / `BuildDiscriminatedUnion` instantiations.
- Per-call cost of `.node()` chains in the heaviest ecosystems (Flux, Stable Diffusion, Wan).
- Whether `groupedDiscriminator` in `ecosystem-graph.ts` shows up as one big span or many smaller ones.

**Phase 1 output:** a single line — "dominant span is **, accounts for **% of check time, fires \_\_ times" — that the rest of the plan reacts to.

**Note on failure thresholds:** the repo currently typechecks on `main`, so Phase 1 captures the **cost picture** but not a **failure threshold**. That's enough to pick the right helper to optimize. If we later want a "moved the budget from N nodes to N+5" measurement, we'd need to separately construct a failure case (intentionally out of scope for this investigation unless requested).

### Phase 2 — Targeted fixes in priority order

These are independent. Apply only what Phase 1 evidence supports. Each is internal-only and preserves runtime behavior.

#### A. Strip `Prettify` from intermediate accumulator types

- Already precedent: [lines 341, 353](../../src/libs/data-graph/data-graph.ts#L341) deliberately skip `Prettify` "to reduce type evaluation overhead." Extend the same policy to `.node()`, `.computed()`, and `.merge()` return types ([lines 957, 985, 1016, 1137, 1158, 1257](../../src/libs/data-graph/data-graph.ts#L957)).
- `Prettify` is a mapped type re-evaluated _per chained call_. With a 2-branch union and a 12-step chain that's 24 mapped-type instantiations purely for display flattening.
- **Trade-off:** hover tooltips show `A & B & C` instead of a flattened `{ a, b, c }`. Acceptable; matches how the codebase already treats meta/values accumulators.

#### B. Make `MergePreferRight` non-distributive on the right side

- Current ([line 257](../../src/libs/data-graph/data-graph.ts#L257)):
  ```ts
  type MergePreferRight<A, B> = A extends unknown
    ? B extends unknown
      ? Prettify<Omit<A, keyof B> & B>
      : never
    : never;
  ```
- In every internal callsite, `B` is a tiny non-union shape (e.g., `{[K in DiscKey]: BranchName}`). Distributing over `B` is wasted work.
- Switch the inner check to `[B] extends [unknown]` to disable B-side distribution. Keep A-side distribution because A is the discriminated-union accumulator.
- **Caveat:** audit the ~3 callsites (grep `MergePreferRight` in the file) before changing — verify none rely on B-side distribution. If any do, leave that callsite using a separate distributive variant.

#### C. Cache the parent-ctx omission across branches in `BuildDiscriminatedUnion`

- Current ([line 290](../../src/libs/data-graph/data-graph.ts#L290)) computes `OmitDistributive<ParentCtx, DiscKey>` _inside_ the mapped type, so it re-evaluates per branch.
- Hoist it to a named alias so it's instantiated once per discriminator instead of per branch:
  ```ts
  type BuildDiscriminatedUnion<ParentCtx, DiscKey, Branches> = {
    [BranchName in keyof Branches & string]: ...
  }[keyof Branches & string];
  ```
  becomes
  ```ts
  type BuildDiscriminatedUnion<ParentCtx, DiscKey, Branches> = _BuildDiscWithCachedParent<
    OmitDistributive<ParentCtx, DiscKey>,
    DiscKey,
    Branches
  >;
  ```
- Apply the same pattern to `BuildGroupedDiscriminatedUnion` ([line 193](../../src/libs/data-graph/data-graph.ts#L193)).

#### D. Reconsider `const` modifiers on `.node()` overloads

- The three overloads ([943, 965, 996](../../src/libs/data-graph/data-graph.ts#L943)) use `<const K, const Deps, …>`. `const` triggers literal-preserving inference, which is normally cheap but can interact badly with deep distribution.
- **Test:** temporarily drop `const` from one parameter and remeasure. `K` likely needs `const` (we want the literal key in the output type); `Deps` may not.
- Apply per-parameter only if the trace shows it helps.

### Phase 3 — Regression validation

1. `pnpm run typecheck` clean — the canonical regression suite.
2. Spot-check `Extract<GenerationGraphTypes['Ctx'], { ecosystem: 'Ernie' }>` (and a couple of other ecosystems) in the editor; the resolved shape should be unchanged from before. Hover-display getting _less_ prettified is fine; the type members must be identical.
3. Re-run the trace from Phase 1 — confirm the dominant spans actually shrank and by how much.
4. Add one paragraph of comment near whichever helper we touched, citing the depth-budget concern, so the next contributor doesn't reintroduce `Prettify` "for cleaner hovers."

## Files most likely to need changes

- [src/libs/data-graph/data-graph.ts](../../src/libs/data-graph/data-graph.ts) — internal helper types around `Prettify`, `MergeDistributive`, `MergePreferRight`, `BuildDiscriminatedUnion`, and the `.node(...)` / `.computed(...)` / `.merge(...)` overload return types.

## Files to leave alone unless directly forced

- All `*-graph.ts` files in [src/shared/data-graph/generation/](../../src/shared/data-graph/generation/) — they're consumers, not the cost source. Don't reshape ecosystem graphs to dodge depth issues; fix the library.
- [src/shared/data-graph/generation/ecosystem-graph.ts](../../src/shared/data-graph/generation/ecosystem-graph.ts) — the outer composition site. It's where errors _surface_, but the cause is upstream.

## How to verify

```bash
pnpm run typecheck
```

Should exit 0. Then re-run the trace command from Phase 1 and compare the dominant-span numbers against the baseline.

---

## Implementation log (executed)

### Round 1 — Suggestion C only (parent-omit cache)

Hoisted `OmitDistributive<ParentCtx, DiscKey>` into wrapper aliases `_BuildDiscWithCachedParent` and `_BuildGroupedDiscWithCachedParent` so the parent omit is instantiated once per discriminator instead of once per branch.

**Result:** total cold typecheck **90.49s → 89.22s** (-1%), check time **76.41s → 70.38s** (-8%). Depth budget (worst-case shape: groupedDiscriminator + 4 sub-branches + trailing `.node()`) was **24 + 2 = 26 chained calls**.

### Round 2 — Suggestion A (strip `Prettify`) — **REVERTED**

Stripped `Prettify` from `MergeDistributive`, `MergePreferRight`, and `.node()`/`.computed()`/`.merge()` return types.

**Result:** check time **76.41s → 212.20s** (+178%). The plan's premise that "Prettify is purely cosmetic" was wrong for this codebase: removing `Prettify` cuts instantiation count but bloats every downstream structural-comparison cost (deep intersections compare slower than flat objects).

**Lesson:** measure check time, not just instantiations. Reverted entirely.

### Round 3 — Depth-budget reframing

The user clarified that the goal is **type resolution**, not throughput — i.e., raising the TS2589 ceiling so future ecosystems with more nodes/discriminators continue to compile at all. Built a stress harness at [src/libs/data-graph/**stress**/depth-budget.ts](../../src/libs/data-graph/__stress__/depth-budget.ts) that constructs a worst-case graph and adds trailing `.node()` calls until TS2589 fires.

**Findings about the failure mode:**

- When TS2589 fires, the discriminator key silently collapses to `any` and every union branch absorbs every other branch's keys. **Code keeps "compiling" with weakened types** — there's no loud failure, narrowing just silently breaks. The stress test pins typed locals to discriminator-narrowed properties so this failure mode reports as a real type error.

### Round 4 — Two structural changes that lifted the depth budget

1. **Mapped-type fold for `BuildGroupedDiscriminatedUnion`.** Replaced the head/tail recursive shape (`Groups extends [First, ...Rest] ? ... | _Recurse<Rest> : never`) with a constant-depth mapped type (`{ [I in keyof Groups]: ... }[number]`). With 25 ecosystem groups, the recursive form consumed 25 depth units before any trailing `.node()` chain even began.
2. **`AppendKey<A, B> = A & B` for `.node()` and `.computed()`.** These overloads always add a fresh key (the runtime forbids redefinition), so the conditional-type distribution (`A extends unknown ? ... : never`) and `Omit` inside `MergeDistributive` are unnecessary. TypeScript auto-distributes intersection over unions, so plain `A & B` preserves discriminated unions. `.merge()` keeps `MergeDistributive` because its B is the entire ChildCtx and may overlap.

**Result:**

- Depth budget **24 + 2 = 26** → **46 + 2 = 48** chained calls (~85% wider)
- Total cold typecheck **89.22s → 172.65s**
- Check time **70.38s → 150.86s**
- Instantiations **6.92M → 6.53M** (-5.7% — fewer instantiations, but each more expensive due to less pre-flattening)

**Trade-off:** ~95% slower full-repo typecheck for ~85% wider depth budget. Accepted because the depth ceiling is a _hard_ failure (won't compile) while the slowdown is _soft_ (still compiles, takes longer). The user explicitly prioritized resolution over throughput.

**Pinned regression guard:** [src/libs/data-graph/**stress**/depth-budget.ts](../../src/libs/data-graph/__stress__/depth-budget.ts) sits at 40 + 2 = 42 chained calls — comfortably below the 48-call ceiling so transient minor regressions don't trip CI, but high enough that any meaningful regression in the type machinery will show up immediately as TS2589.

### Round 5 — `DistribPrettify` at the extraction boundary

After Round 4 the depth budget was wider but the full-repo check time had nearly doubled. A trace at `--skip-millis 30` showed no concentrated hot spot inside data-graph (~2.5s of 40s focused-config check time was data-graph; the rest was tRPC/markdown/Prisma). The 80s check-time regression was spread thinly across every file in the repo that touches the inferred `Ctx` — a few ms per file from un-Prettified intersections, multiplied by hundreds of files.

Hypothesis: `Prettify` was paying for itself during structural comparison _at use sites_, not during construction. So apply it at the public extraction boundary (`InferDataGraph`) instead of per-chain. Internal accumulator stays cheap (preserving the depth budget), consumers see flat per-branch shapes (fast property access).

```ts
type DistribPrettify<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

export type InferDataGraph<G> = G extends DataGraph<infer Ctx, ...>
  ? { Ctx: DistribPrettify<Ctx>; ... }
  : never;
```

Distributive matters: a non-distributive `Prettify<X | Y>` would only project keys common to X and Y (since `keyof (X | Y) = keyof X & keyof Y`).

**Result:**

- Total cold typecheck **172.65s → 131.33s** (-24%)
- Check time **150.86s → 110.02s** (-27%)
- Depth budget **unchanged** (still 46 + 2 = 48 chained calls)
- Instantiations 6.54M (essentially unchanged)
- Memory ~3.98GB (unchanged)

### Final tally vs original baseline

|              | Baseline | Final   | Delta |
| ------------ | -------- | ------- | ----- |
| Total        | 90.49s   | 131.33s | +45%  |
| Check        | 76.41s   | 110.02s | +44%  |
| Depth budget | ~24+2    | 46+2    | +85%  |

Net trade-off: **+44% full-repo check time for +85% depth budget.** The TS2589 ceiling is a hard wall (code stops compiling and silently weakens types — see Round 3); the remaining slowdown is soft. Far better balance than Round 4 alone.

### Suggestions B and D — not pursued

- **Suggestion B (non-distributive `MergePreferRight`):** Audit confirmed B-side distribution is load-bearing for nested-discriminator narrowing (the existing comment at line 254 documents this). Skipped without measurement.
- **Suggestion D (drop `const Deps`):** Was lowest-priority and the depth-budget gains from Rounds 1+4 already exceeded the original goal. Not measured.

## What's in the tree now

- [src/libs/data-graph/data-graph.ts](../../src/libs/data-graph/data-graph.ts) — `AppendKey` for `.node()`/`.computed()` accumulator, `DistribPrettify` at `InferDataGraph` boundary, mapped-type-fold for grouped discriminator, parent-omit cache. `MergePreferRight` and `MergeDistributive` keep `Prettify` (the latter is still used by `.merge()`).
- [src/libs/data-graph/**stress**/depth-budget.ts](../../src/libs/data-graph/__stress__/depth-budget.ts) — depth-budget regression guard. Checked by `pnpm typecheck`.
- [src/libs/data-graph/**tests**/data-graph.test.ts](../../src/libs/data-graph/__tests__/data-graph.test.ts) — runtime tests for the small surface area (`.node`, `.discriminator`, `.groupedDiscriminator`, `.computed`, `.merge`, nested-discriminator narrowing).
- [src/shared/data-graph/generation/generation-graph.type-test.ts](../../src/shared/data-graph/generation/generation-graph.type-test.ts) — type-level assertions that the generation graph's narrowing behavior is preserved.
- [tsconfig.stress.json](../../tsconfig.stress.json) — focused tsconfig for fast iteration on the stress test (~5s vs ~170s for the full repo). Optional; `pnpm typecheck` against the main config covers the same ground.
