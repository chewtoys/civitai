import {
  deleteCategoryHandler,
  getManyHandler,
  getMyUserSetHandler,
  loadFromModelVersionHandler,
  previewExpansionHandler,
  removeSnippetHandler,
  reorderSnippetsHandler,
  saveSnippetHandler,
  updateSnippetHandler,
} from '~/server/controllers/wildcard-set.controller';
import {
  deleteUserSnippetCategoryInputSchema,
  getWildcardSetsInputSchema,
  loadWildcardSetFromModelVersionInputSchema,
  previewSnippetExpansionInputSchema,
  removeUserSnippetInputSchema,
  reorderUserSnippetsInputSchema,
  saveUserSnippetInputSchema,
  updateUserSnippetInputSchema,
} from '~/server/schema/wildcard-set.schema';
import { protectedProcedure, router } from '~/server/trpc';

export const wildcardSetRouter = router({
  // Returns the caller's User-kind set + non-Dirty categories, or null if they
  // haven't saved any snippets yet. Lazy-creation happens on first save.
  getMyUserSet: protectedProcedure.query(getMyUserSetHandler),

  // Hydrate the form from localStorage `wildcardSetIds`. Server filters out
  // IDs the caller isn't authorized for; categories from invalidated sets are
  // omitted but the set metadata stays so the UI can warn.
  getMany: protectedProcedure.input(getWildcardSetsInputSchema).query(getManyHandler),

  // Resolve a `Wildcards`-type ModelVersion to a WildcardSet.id, importing
  // on demand. Idempotent. Wired to the form's "Add wildcard set" button:
  // user picks a model from the resource select modal → this returns the
  // set id → client adds it to `snippets.wildcardSetIds`.
  loadFromModelVersion: protectedProcedure
    .input(loadWildcardSetFromModelVersionInputSchema)
    .mutation(loadFromModelVersionHandler),

  // Single-sample preview of how the resolver would substitute `#category`
  // refs in the caller's templates against their currently loaded sets.
  // Mutation (not query) because each call returns a fresh random sample
  // unless `seed` is supplied — keeping it out of React Query's cache
  // matches the "Regenerate / reroll preview" UX the form drives.
  previewExpansion: protectedProcedure
    .input(previewSnippetExpansionInputSchema)
    .mutation(previewExpansionHandler),

  // User-kind value CRUD. All routes verify ownership of the target category
  // through its parent set's `ownerUserId`. Each mutation flips the category
  // to auditStatus = Pending so the audit pipeline (post-v1) can re-verdict.
  saveSnippet: protectedProcedure.input(saveUserSnippetInputSchema).mutation(saveSnippetHandler),
  removeSnippet: protectedProcedure
    .input(removeUserSnippetInputSchema)
    .mutation(removeSnippetHandler),
  updateSnippet: protectedProcedure
    .input(updateUserSnippetInputSchema)
    .mutation(updateSnippetHandler),
  reorderSnippets: protectedProcedure
    .input(reorderUserSnippetsInputSchema)
    .mutation(reorderSnippetsHandler),
  deleteCategory: protectedProcedure
    .input(deleteUserSnippetCategoryInputSchema)
    .mutation(deleteCategoryHandler),
});
