import * as z from 'zod';
import { MAX_SEED } from '~/shared/constants/generation.constants';
import {
  MAX_NEGATIVE_PROMPT_LENGTH,
  MAX_PROMPT_LENGTH,
} from '~/shared/data-graph/generation/common';
import { SNIPPET_TARGET_KEYS } from '~/server/services/wildcard-set-resolver.service';

// Category names match the import-side normalization (basename of the source
// .txt, with path separators allowed for nested zip layouts). Trimmed to
// avoid leading/trailing whitespace mismatching the citext index.
const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][\w./-]*$/, {
    error: 'Category name must start with a letter and contain only letters, numbers, _.-/',
  });

// A snippet value is the literal text we store in WildcardSetCategory.values.
// Practical cap of 4000 chars matches typical prompt-template length; longer
// values are almost always paste mistakes.
const snippetValueSchema = z.string().min(1).max(4000);

export const getWildcardSetsInputSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(50),
});
export type GetWildcardSetsInput = z.infer<typeof getWildcardSetsInputSchema>;

export const saveUserSnippetInputSchema = z.object({
  category: categoryNameSchema,
  value: snippetValueSchema,
});
export type SaveUserSnippetInput = z.infer<typeof saveUserSnippetInputSchema>;

export const removeUserSnippetInputSchema = z.object({
  categoryId: z.number().int().positive(),
  value: snippetValueSchema,
});
export type RemoveUserSnippetInput = z.infer<typeof removeUserSnippetInputSchema>;

export const updateUserSnippetInputSchema = z.object({
  categoryId: z.number().int().positive(),
  oldValue: snippetValueSchema,
  newValue: snippetValueSchema,
});
export type UpdateUserSnippetInput = z.infer<typeof updateUserSnippetInputSchema>;

export const reorderUserSnippetsInputSchema = z.object({
  categoryId: z.number().int().positive(),
  values: z.array(snippetValueSchema).min(1).max(1000),
});
export type ReorderUserSnippetsInput = z.infer<typeof reorderUserSnippetsInputSchema>;

export const deleteUserSnippetCategoryInputSchema = z.object({
  categoryId: z.number().int().positive(),
});
export type DeleteUserSnippetCategoryInput = z.infer<typeof deleteUserSnippetCategoryInputSchema>;

export const loadWildcardSetFromModelVersionInputSchema = z.object({
  modelVersionId: z.number().int().positive(),
});
export type LoadWildcardSetFromModelVersionInput = z.infer<
  typeof loadWildcardSetFromModelVersionInputSchema
>;

// Per-target template caps mirror the graph's own `promptNode` / `negativePromptNode`
// limits so a preview rejects bodies the form would never let through anyway —
// catches abusive client payloads without re-deriving the cap per-target later.
const targetTemplateMaxLength: Record<(typeof SNIPPET_TARGET_KEYS)[number], number> = {
  prompt: MAX_PROMPT_LENGTH,
  negativePrompt: MAX_NEGATIVE_PROMPT_LENGTH,
};

// One Zod record covering every allowed key with its appropriate cap. Using
// `z.record(z.enum(...), ...)` here would apply one cap globally; we want a
// per-key cap so that adding (e.g.) `lyrics: 8000` later doesn't pull the
// other keys' limits along with it.
const previewTargetsSchema = z.object(
  Object.fromEntries(
    SNIPPET_TARGET_KEYS.map((key) => [key, z.string().max(targetTemplateMaxLength[key]).optional()])
  ) as Record<(typeof SNIPPET_TARGET_KEYS)[number], z.ZodOptional<z.ZodString>>
);

export const previewSnippetExpansionInputSchema = z.object({
  // Same authorization predicate as the resolver: System-kind is public,
  // User-kind must match `ownerUserId == requester`. IDs the caller isn't
  // authorized for get silently dropped server-side.
  wildcardSetIds: z.array(z.number().int().positive()).max(50).default([]),
  // Templates keyed by snippet target name. Each key is optional — the
  // resolver only iterates targets actually present, so a form that only
  // wants to preview `prompt` substitution can omit `negativePrompt` entirely.
  targets: previewTargetsSchema,
  // Optional explicit seed for reproducible preview. Omit to let the server
  // sample a fresh seed each call — returned in the response so the form can
  // surface a "regenerate" affordance keyed to the same seed if needed.
  seed: z.number().int().min(1).max(MAX_SEED).optional(),
});
export type PreviewSnippetExpansionInput = z.infer<typeof previewSnippetExpansionInputSchema>;
