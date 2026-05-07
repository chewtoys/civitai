import {
  deleteCategoryHandler,
  getManyHandler,
  getMyUserSetHandler,
  removeSnippetHandler,
  reorderSnippetsHandler,
  saveSnippetHandler,
  updateSnippetHandler,
} from '~/server/controllers/wildcard-set.controller';
import {
  deleteUserSnippetCategoryInputSchema,
  getWildcardSetsInputSchema,
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
