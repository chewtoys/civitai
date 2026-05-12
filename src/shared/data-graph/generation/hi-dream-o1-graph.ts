/**
 * HiDream-O1 Family Graph
 *
 * Controls for HiDream-O1 ecosystem (HiDream.ai).
 *
 * Two model variants (same input shape, different step defaults):
 * - Full (HiDream-O1-Image):     50 steps
 * - Dev  (HiDream-O1-Image-dev): 28 steps
 *
 * Supports both image:create (txt2img) and image:edit (img2img:edit) — the images
 * node is shown only for the edit workflow. LoRAs are supported on both variants.
 */

import { DataGraph } from '~/libs/data-graph/data-graph';
import type { GenerationCtx } from './context';
import type { ResourceData } from './common';
import {
  aspectRatioNode,
  createCheckpointGraph,
  createResourcesGraph,
  imagesNode,
  negativePromptGraph,
  promptGraph,
  seedNode,
  sliderNode,
  triggerWordsGraph,
} from './common';

// =============================================================================
// Constants
// =============================================================================

/** HiDream-O1 version IDs */
export const hiDreamO1VersionIds = {
  full: 2939946,
  dev: 2939964,
} as const;

type HiDreamO1Variant = 'full' | 'dev';

const hiDreamO1VersionOptions = [
  { label: 'Full', value: hiDreamO1VersionIds.full },
  { label: 'Dev', value: hiDreamO1VersionIds.dev },
];

/** Map version ID to variant */
const versionIdToVariant = new Map<number, HiDreamO1Variant>([
  [hiDreamO1VersionIds.full, 'full'],
  [hiDreamO1VersionIds.dev, 'dev'],
]);

/** Step defaults per variant (HuggingFace model card recommendations). */
const stepsByVariant: Record<HiDreamO1Variant, number> = {
  full: 50,
  dev: 28,
};

// =============================================================================
// Aspect Ratios
// =============================================================================

/** HiDream-O1 aspect ratios — 1024 base, dimensions divisible by 64 */
const hiDreamO1AspectRatios = [
  { label: '16:9', value: '16:9', width: 1408, height: 768 },
  { label: '3:2', value: '3:2', width: 1216, height: 832 },
  { label: '4:3', value: '4:3', width: 1152, height: 896 },
  { label: '1:1', value: '1:1', width: 1024, height: 1024 },
  { label: '3:4', value: '3:4', width: 896, height: 1152 },
  { label: '2:3', value: '2:3', width: 832, height: 1216 },
  { label: '9:16', value: '9:16', width: 768, height: 1408 },
];

// =============================================================================
// HiDream-O1 Graph
// =============================================================================

export const hiDreamO1Graph = new DataGraph<
  { ecosystem: string; workflow: string; model: ResourceData },
  GenerationCtx
>()
  // Images node — required for img2img:edit, hidden for txt2img
  .node(
    'images',
    (ctx) => ({
      ...imagesNode({ min: 1, max: 4 }),
      when: !ctx.workflow.startsWith('txt'),
    }),
    ['workflow']
  )
  // Checkpoint selector (Full vs Dev)
  .merge(
    () =>
      createCheckpointGraph({
        versions: { options: hiDreamO1VersionOptions },
        defaultModelId: hiDreamO1VersionIds.dev,
      }),
    []
  )
  // Computed variant for step-default reset
  .computed(
    'hiDreamO1Variant',
    (ctx) => (ctx.model?.id ? versionIdToVariant.get(ctx.model.id) : undefined) ?? 'dev',
    ['model']
  )
  // LoRA resources — both variants support LoRAs
  .merge(createResourcesGraph())
  .node('aspectRatio', aspectRatioNode({ options: hiDreamO1AspectRatios, defaultValue: '1:1' }))
  .node('cfgScale', sliderNode({ min: 1, max: 20, defaultValue: 4.5, step: 0.5 }))
  .node('steps', sliderNode({ min: 1, max: 100, defaultValue: stepsByVariant.dev }))
  // Reset steps when switching variants — the form's persisted value remains
  // valid in the new branch's range, so we explicitly reset to the variant default.
  .effect(
    (ctx, _ext, set) => {
      set('steps', stepsByVariant[ctx.hiDreamO1Variant]);
    },
    ['hiDreamO1Variant']
  )
  .node('seed', seedNode())
  .merge(triggerWordsGraph)
  .merge(promptGraph)
  .merge(negativePromptGraph);
