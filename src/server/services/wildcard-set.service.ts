import { Prisma } from '@prisma/client';
import { dbRead, dbWrite } from '~/server/db/client';
import type {
  DeleteUserSnippetCategoryInput,
  GetWildcardSetsInput,
  RemoveUserSnippetInput,
  ReorderUserSnippetsInput,
  SaveUserSnippetInput,
  UpdateUserSnippetInput,
} from '~/server/schema/wildcard-set.schema';
import {
  throwAuthorizationError,
  throwBadRequestError,
  throwNotFoundError,
} from '~/server/utils/errorHandling';

const DEFAULT_USER_SET_NAME = 'My snippets';

const wildcardSetSelect = {
  id: true,
  kind: true,
  modelVersionId: true,
  ownerUserId: true,
  name: true,
  auditStatus: true,
  isInvalidated: true,
  createdAt: true,
  updatedAt: true,
} as const;

const wildcardSetCategorySelect = {
  id: true,
  wildcardSetId: true,
  name: true,
  values: true,
  valueCount: true,
  auditStatus: true,
  nsfwLevel: true,
  displayOrder: true,
} as const;

/**
 * Authorization filter for read access. System-kind sets are public; User-kind
 * sets are owner-only. Mirrors the same predicate the resolver uses inline at
 * generation time (see schema doc §6.2). Returns a Prisma `where` fragment.
 */
function authorizationWhere(userId: number): Prisma.WildcardSetWhereInput {
  return {
    OR: [{ kind: 'System' }, { kind: 'User', ownerUserId: userId }],
  };
}

/**
 * Hydrate the full set + category payload for an explicit list of IDs. Used by
 * the form on mount (after reading `wildcardSetIds` from localStorage and
 * unioning with the user's own User-kind set id) to render the picker. IDs the
 * user isn't authorized for or that no longer exist are silently dropped — the
 * client treats those as stale localStorage entries.
 *
 * Invalidated sets are included with a flag (`isInvalidated: true`) so the
 * form can render a warning chip and offer to remove them, but their
 * categories are NOT returned (the picker shouldn't surface unusable values).
 */
export async function getWildcardSets({
  userId,
  input,
}: {
  userId: number;
  input: GetWildcardSetsInput;
}) {
  const sets = await dbRead.wildcardSet.findMany({
    where: {
      id: { in: input.ids },
      ...authorizationWhere(userId),
      // Hide fully-Dirty sets from clients entirely — every category in a
      // Dirty set has triggered XGuard, so there's nothing safe to surface.
      // Mixed sets stay visible (they have at least one Clean category) and
      // get their Dirty categories filtered at the relation below.
      auditStatus: { not: 'Dirty' },
    },
    select: {
      ...wildcardSetSelect,
      categories: {
        // Skip Dirty categories everywhere — the resolver excludes them from
        // pools so showing them in the picker would only confuse the user.
        // Pending categories pass through with their auditStatus so the UI
        // can flag "still being audited."
        where: { auditStatus: { not: 'Dirty' } },
        select: wildcardSetCategorySelect,
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: { id: 'asc' },
  });

  // Strip categories from invalidated sets — the metadata stays so the form
  // can show the warning, but content shouldn't be selectable.
  return sets.map((set) =>
    set.isInvalidated ? { ...set, categories: [] as typeof set.categories } : set
  );
}

/**
 * Return the caller's User-kind WildcardSet, or `null` if they haven't saved
 * any snippets yet. Lazy creation happens on first save (see `saveUserSnippet`),
 * not on read — this keeps the table free of empty placeholder rows for users
 * who never use the feature.
 */
export async function getMyUserWildcardSet({ userId }: { userId: number }) {
  return dbRead.wildcardSet.findFirst({
    where: { kind: 'User', ownerUserId: userId },
    select: {
      ...wildcardSetSelect,
      categories: {
        where: { auditStatus: { not: 'Dirty' } },
        select: wildcardSetCategorySelect,
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

/**
 * Append a snippet value to the caller's User-kind set. Lazy-creates the set
 * (named "My snippets") and the category as needed. Idempotent on duplicates —
 * saving the same value twice is a no-op rather than an error, matching how
 * users intuitively expect a "save" affordance to behave.
 *
 * Every mutation flips the affected category back to `auditStatus: Pending`
 * and bumps the parent set's `totalValueCount`. The audit pipeline (post-v1)
 * will pick up Pending categories and re-verdict them.
 */
export async function saveUserSnippet({
  userId,
  input,
}: {
  userId: number;
  input: SaveUserSnippetInput;
}) {
  return dbWrite.$transaction(async (tx) => {
    // 1. Find or create the user's default User-kind set.
    let set = await tx.wildcardSet.findFirst({
      where: { kind: 'User', ownerUserId: userId },
      select: { id: true },
    });
    if (!set) {
      set = await tx.wildcardSet.create({
        data: {
          kind: 'User',
          ownerUserId: userId,
          name: DEFAULT_USER_SET_NAME,
          auditStatus: 'Pending',
        },
        select: { id: true },
      });
    }

    // 2. Find or create the category, then append the value if not present.
    const existingCategory = await tx.wildcardSetCategory.findUnique({
      where: { wildcardSetId_name: { wildcardSetId: set.id, name: input.category } },
      select: { id: true, values: true, valueCount: true },
    });

    if (!existingCategory) {
      const maxDisplayOrder = await tx.wildcardSetCategory.aggregate({
        where: { wildcardSetId: set.id },
        _max: { displayOrder: true },
      });
      const created = await tx.wildcardSetCategory.create({
        data: {
          wildcardSetId: set.id,
          name: input.category,
          values: [input.value],
          valueCount: 1,
          displayOrder: (maxDisplayOrder._max.displayOrder ?? -1) + 1,
          auditStatus: 'Pending',
          nsfwLevel: 0,
        },
        select: wildcardSetCategorySelect,
      });
      return { set, category: created, added: true };
    }

    if (existingCategory.values.includes(input.value)) {
      // Idempotent: already saved. Return the existing row unchanged.
      const category = await tx.wildcardSetCategory.findUnique({
        where: { id: existingCategory.id },
        select: wildcardSetCategorySelect,
      });
      return { set, category, added: false };
    }

    const updated = await tx.wildcardSetCategory.update({
      where: { id: existingCategory.id },
      data: {
        values: [...existingCategory.values, input.value],
        valueCount: existingCategory.valueCount + 1,
        auditStatus: 'Pending',
      },
      select: wildcardSetCategorySelect,
    });
    return { set, category: updated, added: true };
  });
}

/**
 * Remove a single value from a User-kind category the caller owns. If that was
 * the last value, the category itself is deleted (we don't carry empty
 * categories — they'd just be picker noise).
 */
export async function removeUserSnippet({
  userId,
  input,
}: {
  userId: number;
  input: RemoveUserSnippetInput;
}) {
  return dbWrite.$transaction(async (tx) => {
    const category = await loadOwnedUserCategory(tx, { userId, categoryId: input.categoryId });
    const idx = category.values.indexOf(input.value);
    if (idx < 0) throw throwNotFoundError('Snippet value not found in this category');

    const remaining = [...category.values.slice(0, idx), ...category.values.slice(idx + 1)];

    if (remaining.length === 0) {
      await tx.wildcardSetCategory.delete({ where: { id: category.id } });
      return { categoryDeleted: true as const, categoryId: category.id };
    }

    const updated = await tx.wildcardSetCategory.update({
      where: { id: category.id },
      data: {
        values: remaining,
        valueCount: remaining.length,
        auditStatus: 'Pending',
      },
      select: wildcardSetCategorySelect,
    });
    return { categoryDeleted: false as const, category: updated };
  });
}

/**
 * Replace one occurrence of `oldValue` with `newValue` in a User-kind category
 * the caller owns. Position is preserved. If `newValue` is already present
 * elsewhere in the same category, the duplicate is collapsed (not an error)
 * to keep the values array a deduplicated set in practice.
 */
export async function updateUserSnippet({
  userId,
  input,
}: {
  userId: number;
  input: UpdateUserSnippetInput;
}) {
  if (input.oldValue === input.newValue) {
    throw throwBadRequestError('newValue must differ from oldValue');
  }
  return dbWrite.$transaction(async (tx) => {
    const category = await loadOwnedUserCategory(tx, { userId, categoryId: input.categoryId });
    const idx = category.values.indexOf(input.oldValue);
    if (idx < 0) throw throwNotFoundError('Snippet value not found in this category');

    const next = [...category.values];
    next[idx] = input.newValue;
    // Drop any duplicates of the new value that already existed at a different
    // position — keep the just-edited one in place.
    const deduped = next.filter((v, i) => i === idx || v !== input.newValue);

    const updated = await tx.wildcardSetCategory.update({
      where: { id: category.id },
      data: {
        values: deduped,
        valueCount: deduped.length,
        auditStatus: 'Pending',
      },
      select: wildcardSetCategorySelect,
    });
    return { category: updated };
  });
}

/**
 * Replace the full ordered values array for a User-kind category the caller
 * owns. Used by the picker's drag-handle reorder UX. Caller must include
 * every value — partial reorders aren't supported (avoids set-vs-array
 * ambiguity). Duplicates within the supplied array are rejected so the
 * unique-per-category app-level invariant holds.
 */
export async function reorderUserSnippets({
  userId,
  input,
}: {
  userId: number;
  input: ReorderUserSnippetsInput;
}) {
  return dbWrite.$transaction(async (tx) => {
    const category = await loadOwnedUserCategory(tx, { userId, categoryId: input.categoryId });

    const seen = new Set<string>();
    for (const value of input.values) {
      if (seen.has(value)) {
        throw throwBadRequestError(`Duplicate value in reorder payload: ${value}`);
      }
      seen.add(value);
    }
    const existing = new Set(category.values);
    if (seen.size !== existing.size || [...existing].some((v) => !seen.has(v))) {
      throw throwBadRequestError(
        'Reorder payload must contain exactly the existing values (additions/removals must use save/remove)'
      );
    }

    const updated = await tx.wildcardSetCategory.update({
      where: { id: category.id },
      data: {
        values: input.values,
        // valueCount unchanged — same set of values, different order.
        // auditStatus unchanged — pure reorder doesn't introduce new content.
      },
      select: wildcardSetCategorySelect,
    });
    return { category: updated };
  });
}

/**
 * Delete an entire User-kind category the caller owns and decrement the
 * parent set's `totalValueCount`. The set itself is preserved even if all
 * its categories are deleted — keeping it lets the user keep building up
 * content again without re-bootstrapping the row.
 */
export async function deleteUserSnippetCategory({
  userId,
  input,
}: {
  userId: number;
  input: DeleteUserSnippetCategoryInput;
}) {
  return dbWrite.$transaction(async (tx) => {
    const category = await loadOwnedUserCategory(tx, { userId, categoryId: input.categoryId });
    await tx.wildcardSetCategory.delete({ where: { id: category.id } });
    return { categoryId: category.id, removedValues: category.valueCount };
  });
}

/**
 * Verify the category exists, belongs to a User-kind set, and is owned by the
 * caller. Used by every mutation as the authorization gate. Returns the
 * category row plus its parent's `wildcardSetId` for downstream updates.
 */
async function loadOwnedUserCategory(
  tx: Prisma.TransactionClient,
  { userId, categoryId }: { userId: number; categoryId: number }
) {
  const category = await tx.wildcardSetCategory.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      wildcardSetId: true,
      values: true,
      valueCount: true,
      wildcardSet: { select: { kind: true, ownerUserId: true } },
    },
  });
  if (!category) throw throwNotFoundError('Snippet category not found');
  if (category.wildcardSet.kind !== 'User' || category.wildcardSet.ownerUserId !== userId) {
    throw throwAuthorizationError();
  }
  return category;
}
