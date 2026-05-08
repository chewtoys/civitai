import { Center, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import type { ReactRendererOptions } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';

/**
 * One flat row in the props the suggestion plugin hands us — one per
 * (category, source) pair. The popover groups these internally so the user
 * sees one row per unique category name, with the contributing source sets
 * listed underneath. Same shape as `getMany`/`getMyUserSet` returns so
 * callers can pass results straight through.
 */
export type SnippetCategoryItem = {
  /** Category name as stored in the DB (citext). Inserted as `#id`. */
  id: string;
  /** Optional display override — defaults to `id`. */
  label?: string;
  /** Source set's display name, surfaced beneath the category in the popover. */
  setName?: string;
  /** Value count for this specific (category, source) row; summed per group. */
  valueCount?: number;
};

type Props = SuggestionProps<SnippetCategoryItem> & {
  editor: ReactRendererOptions['editor'];
};

export type SnippetCategoryListRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

/**
 * Aggregated view of a single category across every set that contributes
 * to it. Inserted chip is keyed only on `id` — multiple sources under one
 * category render as informational metadata, not selectable rows.
 */
type CategoryGroup = {
  /** Lower-cased lookup key (citext semantics). */
  key: string;
  /** Original casing of the first occurrence — preserved for display. */
  id: string;
  label: string;
  sources: string[];
  totalValueCount: number;
};

function groupItems(items: SnippetCategoryItem[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const item of items) {
    const key = item.id.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        id: item.id,
        label: item.label ?? item.id,
        sources: [],
        totalValueCount: 0,
      };
      map.set(key, group);
    }
    if (item.setName && !group.sources.includes(item.setName)) {
      group.sources.push(item.setName);
    }
    group.totalValueCount += item.valueCount ?? 0;
  }
  return [...map.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );
}

/**
 * Popover list rendered when the user types `#`. Items arrive flat (one per
 * category-source pair); we group by lower-cased category name so each row
 * is a single category, sorted alphabetically. Source sets that contribute
 * to a category are listed as a small dimmed sub-line — same data, but
 * no longer competing visually with the category name itself.
 */
export const SnippetCategoryList = forwardRef<SnippetCategoryListRef, Props>(
  ({ items, command, query }, ref) => {
    const groups = useMemo(() => groupItems(items), [items]);
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      // Reset whenever the filtered group set changes so we never end up
      // with an out-of-range index after backspacing past a match.
      setSelectedIndex(0);
    }, [groups]);

    const selectItem = (index: number) => {
      const group = groups[index];
      if (!group) return;
      command({ id: group.id, label: group.label });
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + groups.length - 1) % Math.max(groups.length, 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % Math.max(groups.length, 1));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          if (groups.length > 0) {
            selectItem(selectedIndex);
            return true;
          }
        }
        return false;
      },
    }));

    return (
      <Paper className="z-50 max-h-72 overflow-y-auto" radius="md" withBorder shadow="md" miw={240}>
        {groups.length === 0 ? (
          <Center p="sm">
            <Text size="xs" c="dimmed">
              {query ? `No categories match "${query}"` : 'No categories loaded'}
            </Text>
          </Center>
        ) : (
          <Stack gap={0}>
            {groups.map((group, index) => {
              const isActive = index === selectedIndex;
              const sourcesText = group.sources.join(' · ');
              return (
                <UnstyledButton
                  key={group.key}
                  className={clsx(
                    'flex flex-col gap-0.5 px-3 py-2 text-sm',
                    isActive && 'bg-gray-1 dark:bg-dark-5'
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => selectItem(index)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">#{group.label}</span>
                    {group.totalValueCount > 0 ? (
                      <Text size="xs" c="dimmed" className="shrink-0 tabular-nums">
                        {group.totalValueCount}
                      </Text>
                    ) : null}
                  </span>
                  {sourcesText ? (
                    <Text size="xs" c="dimmed" className="truncate">
                      {sourcesText}
                    </Text>
                  ) : null}
                </UnstyledButton>
              );
            })}
          </Stack>
        )}
      </Paper>
    );
  }
);

SnippetCategoryList.displayName = 'SnippetCategoryList';
