# XGuard — drop per-label `SignalTerms` from the policy options model

## Summary

Remove the `SignalTerms` field from `XGuardLabelDefinition`. It's vestigial — the dashboard never exposed it for editing, the model never sees it, and it's currently a source of drift between what users edit in the top-level term lists and what each label actually resolves to.

Behavioral net: minor cosmetic change in the audit-row `Field` column for a handful of labels. No change to model decisions.

## Background

The civitai-side scanner-audit pipeline has been using `GET /v1/manager/xguard/options/{mode}` to read policy state for review and tuning work. While investigating why some dashboard edits weren't reflected in the API output, we traced the chain and found:

1. **Top-level term lists** (`AgeDownTerms`, `AdultUpTerms`, `SexualTerms`) and `CustomTermClasses` are editable in the dashboard ([`XGuardOptions.razor`](C:/Work/civitai-orchestration/src/Civitai.Orchestration.Dashboard/Server/Components/Pages/XGuardOptions.razor) lines 100-117 + the custom-term-classes card).
2. **Per-label `Policy`, `Action`, `Threshold`, `Name`** are editable in the Labels table.
3. **Per-label `SignalTerms`** is **not** editable in the dashboard. It's loaded from the grain into `LabelModel.SignalTerms`, round-tripped back on save, but no UI element edits it.

As a result, the values returned by the API for `label.signalTerms` are whatever was hardcoded as the compile-time default in [`XGuardModerationOptionsGrain.cs`](C:/Work/civitai-orchestration/src/Civitai.Orchestration.Grains/Configurations/XGuardModerationOptionsGrain.cs) — for example `Young.SignalTerms = AgeDownTerms` (line 308) gets the 20-term array bound at compile time, which doesn't follow runtime edits to the top-level `AgeDownTerms` list.

Concretely we observed: top-level `ageDownTerms` returned 18 terms (user pruned `petite`/`flat chest`), but `Young.signalTerms` still returned 20 terms (still including those two). Same data, two different copies, two different values.

## Why this matters

Per-label `SignalTerms` are **not used by the model**. Inspecting [`XGuardModerationHandler.cs`](C:/Work/civitai-orchestration/src/Civitai.Orchestration.Grains/Workflows/Steps/XGuardModeration/XGuardModerationHandler.cs):

- `GenerateJobsAsync` (lines 130-215) builds the `ChatCompletionJob` from `modelAir`, the `policy` text, and the input `segment`. `SignalTerms` is **not** passed to the model.
- The blob cache key (lines 155-167) hashes `policy` but **not** `SignalTerms`.
- `SignalMetadata` counts (lines 74-82) — what the model sees as `[Positive Age-Down Signals]` etc. in the input — are computed from top-level `AgeDownTerms`, `AdultUpTerms`, `SexualTerms`, and `CustomTermClasses`. Not from per-label `SignalTerms`.

Per-label `SignalTerms` is only consumed in `DetermineField()` (lines 502-523) for post-processing the audit row's `Field` value (`Positive Prompt` / `Negative Prompt` / `Combined Prompt`), and only as a fallback for labels that aren't CSAM/CR/Young/Sexual:

```csharp
// XGuardModerationHandler.cs:518-523
if (label.SignalTerms.IsDefaultOrEmpty)
    return "Combined Prompt";

var positiveHits = CountOccurrences(state.PositiveNormalized ?? string.Empty, label.SignalTerms);
var negativeHits = CountOccurrences(state.NegativeNormalized ?? string.Empty, label.SignalTerms);
return SelectField(positiveHits, negativeHits, "Combined Prompt");
```

The CSAM/CR/Young/Sexual labels have special-case branches in the same method that read from `SignalMetadata` (which is derived from top-level term lists), so they're unaffected.

## Proposed change

### 1. Remove `SignalTerms` from `XGuardLabelDefinition`

The new shape:

```csharp
public class XGuardLabelDefinition {
    public string Name { get; init; }
    public string Action { get; init; }
    public double Threshold { get; init; }
    public string Policy { get; init; }
}
```

### 2. Update `XGuardModerationOptionsGrain.cs`

- Remove `SignalTerms = ...` from every entry in `DefaultPromptLabels` and `DefaultTextLabels`.
- In `NormalizeOptions`, drop the per-label `SignalTerms` normalization block (lines 138-149). Labels round-trip with just Name/Action/Threshold/Policy.

### 3. Update `XGuardModerationHandler.DetermineField()`

The fallback branch that uses `label.SignalTerms` (lines 518-523) becomes unreachable. Either:

- Delete the branch entirely and let it fall through to `return "Combined Prompt"`.
- Or replace the field check with a check against `CustomTermClasses` if a label's name happens to match a custom class (optional — described in "Future enhancement" below).

For the initial change, deleting the branch is fine. The labels that lose Positive/Negative attribution (Bestiality, Urine, Diaper, Scat, Menstruation) become "Combined Prompt" on the audit row. This is a cosmetic-only change to the audit log; nothing downstream branches on `Field` for these labels.

### 4. Update the dashboard `LabelModel`

`XGuardOptions.razor` (lines 540-545) currently round-trips `SignalTerms` even though it's not editable. Remove it from `LabelModel`, `LabelModel.FromOptions`, and `LabelModel.ToOptions`.

### 5. API surface — backward compatible during deploy

`PUT /v1/manager/xguard/options/{mode}` currently accepts a body containing `SignalTerms` per label. After this change, clients sending `SignalTerms` should not error — the field is just silently ignored. JSON deserialization will skip unknown properties by default in System.Text.Json with `JsonSerializerDefaults.Web`; if you have strict deserialization on, allow unknown property names for at least one deploy cycle.

The OpenAPI schema entry for the per-label object (the generated `wwwroot/openapi/v2.json`) will lose the `signalTerms` property. Civitai-side already treats the entire payload as `unknown`, so no breakage there.

## Files to touch

| File | Change |
|------|--------|
| `Civitai.Orchestration.Grains.Abstractions/Configurations/XGuardModerationOptions.cs` | Remove `SignalTerms` property from `XGuardLabelDefinition`. |
| `Civitai.Orchestration.Grains/Configurations/XGuardModerationOptionsGrain.cs` | Drop `SignalTerms = ...` from default-label arrays. Remove SignalTerms-normalization block in `NormalizeOptions`. |
| `Civitai.Orchestration.Grains/Workflows/Steps/XGuardModeration/XGuardModerationHandler.cs` | Delete the fallback branch in `DetermineField` that uses `label.SignalTerms`. |
| `Civitai.Orchestration.Dashboard/Server/Components/Pages/XGuardOptions.razor` | Remove `SignalTerms` from `LabelModel`, `FromOptions`, `ToOptions`. |
| `Civitai.Orchestration.Api/wwwroot/openapi/v2.json` | Regenerated automatically — verify the per-label schema no longer has `signalTerms`. |

## Migration / state compatibility

Orleans grain state uses `[GenerateSerializer]` with the `[Id(N)]` attributes on `XGuardModerationOptionsGrainState`. Removing a property from `XGuardLabelDefinition` requires care:

1. **On read**: existing persisted state contains label entries that include `SignalTerms`. Because `XGuardLabelDefinition` uses `[GenerateSerializer]`-style codegen, removing the property means the deserializer skips the unknown field. This should be safe if the `[Id(N)]` attributes on the remaining properties don't move — make sure the ID for `SignalTerms` is retired, not reassigned.

2. **On write**: next `SetOptionsAsync` writes the new shape (no SignalTerms). State silently shrinks.

3. **Optional safety**: if you want a controlled migration window, leave `SignalTerms` as a deprecated property on `XGuardLabelDefinition` for one release — read-only, populated to empty array on serialization, ignored on deserialization. Then remove it next release. Probably not necessary given the field is truly unused, but mentioning it as an option.

## Behavior delta downstream

| Surface | Before | After |
|---------|--------|-------|
| Model decision | Same | Same (model never saw SignalTerms) |
| `XGuardLabelResult.Triggered`, `Score`, `Action`, `Threshold`, `ModelReason` | Same | Same |
| `XGuardLabelResult.Field` for CSAM, CR, Young, Sexual | `"Positive Prompt"` / `"Negative Prompt"` / `"Combined Prompt"` based on SignalMetadata | Same — unchanged |
| `XGuardLabelResult.Field` for Bestiality, Urine, Diaper, Scat, Menstruation, Celebrity | Computed from per-label SignalTerms | Defaults to `"Combined Prompt"` |
| `MatchedTerms` array on each result | Derived from `modelReason` text + source prompt, conditional on `Field` value | Same — only the conditional `Field` value changes; matched-term extraction itself is unchanged |
| `SignalMetadata` block | Computed from top-level term lists | Same |
| Dashboard UX | SignalTerms invisible | Same — invisible |
| `GET /v1/manager/xguard/options/{mode}` response | Per-label `signalTerms` array present | Per-label `signalTerms` field absent |

## Risks and edge cases

1. **Custom labels sent via `LabelOverrides` on a scan request.** [`XGuardModerationHandler.ResolveLabels`](C:/Work/civitai-orchestration/src/Civitai.Orchestration.Grains/Workflows/Steps/XGuardModeration/XGuardModerationHandler.cs) lines 290-341 also creates custom labels with `SignalTerms = []`. Those become "no signal terms" naturally — no change needed.

2. **Test coverage**: any unit tests asserting `label.SignalTerms == X` need updating. Likely small surface.

3. **Existing audit data** (in civitai's ClickHouse `scanner_label_results` table) has `Field` values populated from old logic. New rows after deploy will have `"Combined Prompt"` for the affected labels. Mod-review UIs that filter by Field don't currently exist for these labels, so this is not user-visible.

4. **Hardcoded defaults sync**: the doc previously suggested using top-level lists as the source of truth. Since per-label SignalTerms is going away, this concern is resolved — there's no longer two copies of the same data.

## Testing

- Confirm GET response no longer includes `signalTerms` on label objects.
- Confirm a scan request still produces the same `Score` / `Triggered` / `ModelReason` values as before for the same input + policy.
- Confirm audit-row `Field` value for Bestiality / Urine / etc. is `"Combined Prompt"`.
- Confirm dashboard load + save round-trips cleanly without losing other label fields.
- Confirm grain state from a pre-change build deserializes cleanly into the new shape.

## Future enhancement (not part of this change)

If you want per-label keyword-based Field attribution back for niche labels (Bestiality, Urine, etc.), the right place is **Custom Term Classes**:

1. User creates a Custom Term Class named "Animal Names" with `[dog, horse, wolf, ...]`.
2. The handler's `BuildPromptCustomSignals` already counts hits per custom class in the input the model sees as `[Custom Signals]`.
3. `DetermineField` can be extended to consult the per-class hit counts for labels whose name matches (or is configured to reference) a Custom Term Class.

That gives users a discoverable, editable way to attach signal terms to specific labels without re-introducing the silent per-label field. Out of scope for this change.

## Civitai-side note

The civitai codebase calls `GET /v1/manager/xguard/options/{mode}` via the new `xguard-manager` skill and the `xguard-manager.service.ts` wrapper. Both treat the response payload as `unknown` — no civitai-side code changes required. Civitai-side tools that PUT modified policy text will continue to work; if their copy of the payload happens to include `signalTerms` per label, those values are silently ignored.

## Why now

We're tuning XGuard policies based on moderator-verdict data from production scans. The "drift" between top-level term lists and per-label signalTerms made it confusing to reason about what the model actually sees vs. what the dashboard shows. Removing the field is a 1-day cleanup that eliminates the entire class of confusion and unblocks the rest of the policy-tuning work.
