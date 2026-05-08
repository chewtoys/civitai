/**
 * Hunyuan Graph
 *
 * Controls for Hunyuan video generation ecosystem.
 * Supports txt2vid workflow only (no img2vid support).
 *
 * Nodes:
 * - seed: Optional seed for reproducibility
 * - aspectRatio: Output aspect ratio
 * - cfgScale: CFG scale for generation control
 * - duration: Video duration (3 or 5 seconds)
 * - steps: Number of inference steps
 * - resources: Additional LoRAs
 */

import { DataGraph } from '~/libs/data-graph/data-graph';
import type { GenerationCtx } from './context';
import {
  seedNode,
  aspectRatioNode,
  promptGraph,
  sliderNode,
  triggerWordsGraph,
  enumNode,
  imagesNode,
  createResourcesGraph,
  createCheckpointGraph,
} from './common';
import { getAspectRatioOptions } from '~/shared/constants/generation.constants';

// =============================================================================
// Constants
// =============================================================================

const hunyuanAspectRatios = getAspectRatioOptions('480p', [
  '16:9',
  '3:2',
  '1:1',
  '2:3',
  '9:16',
]);

/** Hunyuan duration options */
const hunyuanDurations = [
  { label: '3 seconds', value: 3 },
  { label: '5 seconds', value: 5 },
];

// =============================================================================
// Hunyuan Graph
// =============================================================================

/** Context shape for hunyuan graph */
type HunyuanCtx = { ecosystem: string; workflow: string };

/**
 * Hunyuan video generation controls.
 *
 * Txt2vid only - no image input support.
 * Supports LoRAs for customization.
 */
export const hunyuanGraph = new DataGraph<HunyuanCtx, GenerationCtx>()
  // Images node - shown for img2vid, hidden for txt2vid
  .node(
    'images',
    (ctx) => ({
      ...imagesNode({ warnOnMissingAiMetadata: true }),
      when: !ctx.workflow.startsWith('txt'),
    }),
    ['workflow']
  )

  // Merge checkpoint graph (model node with locked model from ecosystem settings)
  .merge(createCheckpointGraph())

  // Seed node
  .node('seed', seedNode())

  // Aspect ratio node
  .node('aspectRatio', aspectRatioNode({ options: hunyuanAspectRatios, defaultValue: '1:1' }))

  // CFG scale node
  .node(
    'cfgScale',
    sliderNode({
      min: 1,
      max: 10,
      step: 0.5,
      defaultValue: 6,
      presets: [
        { label: 'Low', value: 3 },
        { label: 'Balanced', value: 6 },
        { label: 'High', value: 9 },
      ],
    })
  )

  // Duration node
  .node('duration', enumNode({ options: hunyuanDurations, defaultValue: 5 }))

  // Steps node
  .node(
    'steps',
    sliderNode({
      min: 10,
      max: 30,
      defaultValue: 20,
      presets: [
        { label: 'Fast', value: 10 },
        { label: 'Balanced', value: 20 },
        { label: 'Quality', value: 30 },
      ],
    })
  )

  // Resources node (LoRAs)
  .merge(createResourcesGraph())

  // Prompt + triggerWords (no negativePrompt for Hunyuan)
  .merge(triggerWordsGraph)
  .merge(promptGraph);

// Export constants for use in components
export { hunyuanAspectRatios, hunyuanDurations };
