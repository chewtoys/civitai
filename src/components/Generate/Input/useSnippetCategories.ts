import { useMemo } from 'react';
import type { SnippetCategoryItem } from './SnippetCategoryList';
import { trpc } from '~/utils/trpc';

/**
 * Resolve the popover-ready category list for a given set of loaded
 * `wildcardSetIds`. Implements the form-mount sequence the v1 doc spec'd:
 *
 *   1. Fetch the caller's own User-kind set (always implicitly loaded).
 *   2. Fetch the union of (own-set-id ∪ ids-from-graph) via `getMany`.
 *   3. Flatten the (set, category) pairs into one item per (category, set)
 *      row — the popover groups by category internally.
 *
 * Sorted alphabetically by name, then by source name as a stable
 * tiebreaker. Ids the caller isn't authorized for are silently dropped
 * server-side (matches the inline `kind`/`ownerUserId` predicate in the
 * read service).
 *
 * Returns enough context for an Active Wildcards strip alongside the
 * categories list — `loadedSets` carries set-level metadata (name, kind,
 * audit/invalidated state, valueCount per category) so the strip can
 * render without re-querying.
 */
export function useSnippetCategories(wildcardSetIds: number[] = []) {
  const userSetQuery = trpc.wildcardSet.getMyUserSet.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const ownSetId = userSetQuery.data?.id;

  // The user's own User-kind set is always implicitly loaded (per the v1
  // doc) — union it with whatever the form is carrying so subsequent saves
  // immediately surface in the popover without a separate `wildcardSetIds`
  // mutation.
  const allIds = useMemo(() => {
    const set = new Set<number>(wildcardSetIds);
    if (ownSetId) set.add(ownSetId);
    return [...set];
  }, [wildcardSetIds, ownSetId]);

  const setsQuery = trpc.wildcardSet.getMany.useQuery(
    { ids: allIds },
    { enabled: allIds.length > 0, refetchOnWindowFocus: false }
  );

  const loadedSets = setsQuery.data ?? [];

  const categories = useMemo<SnippetCategoryItem[]>(() => {
    if (loadedSets.length === 0) return [];
    const items: SnippetCategoryItem[] = [];
    for (const set of loadedSets) {
      for (const cat of set.categories) {
        items.push({
          id: cat.name,
          label: cat.name,
          setName: set.name,
          valueCount: cat.valueCount,
        });
      }
    }
    items.sort((a, b) => {
      const byName = (a.label ?? a.id).localeCompare(b.label ?? b.id, undefined, {
        sensitivity: 'base',
      });
      if (byName !== 0) return byName;
      return (a.setName ?? '').localeCompare(b.setName ?? '');
    });
    return items;
  }, [loadedSets]);

  return {
    categories,
    loadedSets,
    ownSetId,
    isLoading: userSetQuery.isLoading || setsQuery.isLoading,
  };
}

export type UseSnippetCategoriesResult = ReturnType<typeof useSnippetCategories>;
