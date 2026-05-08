/**
 * Sora Graph
 *
 * Controls for OpenAI Sora 2 video generation ecosystem.
 * Supports txt2vid and img2vid workflows.
 *
 * Nodes:
 * - seed: Optional seed for reproducibility
 * - aspectRatio: Output aspect ratio (16:9 or 9:16)
 * - resolution: Output resolution (720p or 1080p)
 * - usePro: Toggle for pro mode (higher quality)
 * - duration: Video duration (4 or 8 seconds)
 */

import z from 'zod';
import { DataGraph } from '~/libs/data-graph/data-graph';
import type { GenerationCtx } from './context';
import {
  seedNode,
  aspectRatioNode,
  enumNode,
  imagesNode,
  createCheckpointGraph,
  promptGraph,
  triggerWordsGraph,
} from './common';
import {
  getAspectRatioOptions,
  type GenerationAspectRatio,
} from '~/shared/constants/generation.constants';

// =============================================================================
// Constants
// =============================================================================

const soraAspectRatioList: GenerationAspectRatio[] = ['16:9', '9:16'];

/** Default sora aspect ratios (720p) — exported for legacy consumers */
const soraAspectRatios = getAspectRatioOptions('720p', soraAspectRatioList);

/** Sora resolution options */
const soraResolutions = [
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
];

/** Sora duration options */
const soraDurations = [
  { label: '4 seconds', value: 4 },
  { label: '8 seconds', value: 8 },
];

// =============================================================================
// Sora Graph
// =============================================================================

/** Context shape for sora graph */
type SoraCtx = { ecosystem: string; workflow: string };

/**
 * Sora 2 video generation controls.
 *
 * Workflow-specific behavior:
 * - txt2vid: Shows aspect ratio selector
 * - img2vid: Aspect ratio derived from source image
 */
export const soraGraph = new DataGraph<SoraCtx, GenerationCtx>()
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

  // Resolution node (declared before aspectRatio so dimensions can scale with it)
  .node('resolution', {
    input: z.enum(['720p', '1080p']).optional(),
    output: z.enum(['720p', '1080p']),
    defaultValue: '720p' as const,
    meta: { options: soraResolutions },
  })

  // Aspect ratio node - only for txt2vid workflow; dimensions scale with resolution
  .node(
    'aspectRatio',
    (ctx) => ({
      ...aspectRatioNode({
        options: getAspectRatioOptions(ctx.resolution, soraAspectRatioList),
        defaultValue: '9:16',
      }),
      when: ctx.workflow === 'txt2vid',
    }),
    ['workflow', 'resolution']
  )

  // Pro mode toggle
  .node('usePro', {
    input: z.boolean().optional(),
    output: z.boolean(),
    defaultValue: false,
  })

  // Duration node
  .node('duration', enumNode({ options: soraDurations, defaultValue: 4 }))

  // Prompt + triggerWords (no negativePrompt for Sora)
  .merge(triggerWordsGraph)
  .merge(promptGraph);

// Export constants for use in components
export { soraAspectRatios, soraResolutions, soraDurations };
