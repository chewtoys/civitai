import type { Context } from '~/server/createContext';
import type {
  DeleteUserSnippetCategoryInput,
  GetWildcardSetsInput,
  LoadWildcardSetFromModelVersionInput,
  PreviewSnippetExpansionInput,
  RemoveUserSnippetInput,
  ReorderUserSnippetsInput,
  SaveUserSnippetInput,
  UpdateUserSnippetInput,
} from '~/server/schema/wildcard-set.schema';
import {
  deleteUserSnippetCategory,
  getMyUserWildcardSet,
  getWildcardSets,
  loadWildcardSetFromModelVersion,
  previewSnippetExpansion,
  removeUserSnippet,
  reorderUserSnippets,
  saveUserSnippet,
  updateUserSnippet,
} from '~/server/services/wildcard-set.service';

type AuthedCtx = Context & { user: { id: number } };

export function getMyUserSetHandler({ ctx }: { ctx: AuthedCtx }) {
  return getMyUserWildcardSet({ userId: ctx.user.id });
}

export function getManyHandler({ input, ctx }: { input: GetWildcardSetsInput; ctx: AuthedCtx }) {
  return getWildcardSets({ userId: ctx.user.id, input });
}

export function saveSnippetHandler({
  input,
  ctx,
}: {
  input: SaveUserSnippetInput;
  ctx: AuthedCtx;
}) {
  return saveUserSnippet({ userId: ctx.user.id, input });
}

export function removeSnippetHandler({
  input,
  ctx,
}: {
  input: RemoveUserSnippetInput;
  ctx: AuthedCtx;
}) {
  return removeUserSnippet({ userId: ctx.user.id, input });
}

export function updateSnippetHandler({
  input,
  ctx,
}: {
  input: UpdateUserSnippetInput;
  ctx: AuthedCtx;
}) {
  return updateUserSnippet({ userId: ctx.user.id, input });
}

export function reorderSnippetsHandler({
  input,
  ctx,
}: {
  input: ReorderUserSnippetsInput;
  ctx: AuthedCtx;
}) {
  return reorderUserSnippets({ userId: ctx.user.id, input });
}

export function deleteCategoryHandler({
  input,
  ctx,
}: {
  input: DeleteUserSnippetCategoryInput;
  ctx: AuthedCtx;
}) {
  return deleteUserSnippetCategory({ userId: ctx.user.id, input });
}

export function loadFromModelVersionHandler({
  input,
  ctx,
}: {
  input: LoadWildcardSetFromModelVersionInput;
  ctx: AuthedCtx;
}) {
  return loadWildcardSetFromModelVersion({ userId: ctx.user.id, input });
}

export function previewExpansionHandler({
  input,
  ctx,
}: {
  input: PreviewSnippetExpansionInput;
  ctx: AuthedCtx;
}) {
  // `ctx.features` is a lazy proxy — accessing `.isGreen` resolves it on
  // demand. Default to `true` (SFW) so the resolver is strict by default
  // when the site context can't be determined.
  const isGreen = ctx.features?.isGreen ?? true;
  return previewSnippetExpansion({ userId: ctx.user.id, isGreen, input });
}
