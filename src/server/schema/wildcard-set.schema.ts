import * as z from 'zod';

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
