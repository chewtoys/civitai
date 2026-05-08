import { ActionIcon, Badge, Button, Group, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconPlus, IconUser, IconX } from '@tabler/icons-react';
import clsx from 'clsx';
import type { UseSnippetCategoriesResult } from './useSnippetCategories';

export type ActiveWildcardsProps = {
  /**
   * `loadedSets` from `useSnippetCategories` — already authorization-filtered
   * by the server. Render order is fed straight through; sort upstream if
   * a specific order is desired.
   */
  loadedSets: UseSnippetCategoriesResult['loadedSets'];
  /** Identifier for the caller's User-kind set. Used to render a small "you" hint. */
  ownSetId?: number;
  /**
   * Remove a System-kind set from the form's loaded list. Called when the
   * user clicks the X on a chip. Not invoked for User-kind — the caller's
   * own set is always implicitly loaded (per v1 doc) and the chip omits
   * its remove control.
   */
  onRemoveSet?: (id: number) => void;
  /**
   * Open the picker (resource select modal) for adding a new wildcard set.
   * Caller wires this to `openResourceSelectModal(...)` filtered to
   * `Wildcards`-type models; on pick, resolve the version → set id and
   * add it to the form's `wildcardSetIds`. When omitted, the strip's
   * "Add" affordance is hidden.
   */
  onAdd?: () => void;
  /** Disable the add button while a load mutation is in-flight. */
  isAdding?: boolean;
  className?: string;
};

/**
 * Compact strip showing which wildcard sets are active for the prompt.
 * Each chip = one loaded set; per-set value count = sum of category
 * `valueCount` across non-Dirty categories the read API surfaced. Visually
 * inspired by the V8 mockup's "Snippet sources:" strip but trimmed to the
 * v1 chrome (no per-source filter pills, no "Manage sources" footer — those
 * land with the post-v1 picker).
 *
 * The strip does double duty: it's the v1 surface for the user to *see*
 * what's loaded, and the only entry point for *removing* a System-kind
 * set without navigating back to the wildcard model page. Adding sets
 * still happens via the "create" button on a wildcard model page (per the
 * v1 doc — no in-form add affordance until post-v1).
 */
export function ActiveWildcards({
  loadedSets,
  ownSetId,
  onRemoveSet,
  onAdd,
  isAdding,
  className,
}: ActiveWildcardsProps) {
  if (loadedSets.length === 0) {
    return (
      <div
        className={clsx(
          'flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gray-3 px-3 py-2 dark:border-dark-4',
          className
        )}
      >
        <Text size="xs" c="dimmed" className="flex-1">
          No wildcard sets loaded. Add one to use{' '}
          <Text component="span" c="bright" fw={600}>
            #
          </Text>
          -references in the prompt.
        </Text>
        {onAdd ? (
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconPlus size={12} />}
            onClick={onAdd}
            loading={isAdding}
          >
            Add wildcard set
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <Group gap="xs" align="center" wrap="wrap">
        <Text size="xs" fw={600} c="dimmed" className="shrink-0">
          Snippet sources
        </Text>
        {loadedSets.map((set) => {
          const isOwn = set.id === ownSetId;
          const isUserKind = set.kind === 'User';
          const totalValues = set.categories.reduce((sum, c) => sum + c.valueCount, 0);
          const detail = `${set.categories.length} categor${
            set.categories.length === 1 ? 'y' : 'ies'
          } · ${totalValues} value${totalValues === 1 ? '' : 's'}`;
          // Removable when the caller wired a handler AND the set isn't the
          // user's always-implicit User-kind set (removing that one would
          // be a no-op since it'd auto-rejoin on the next mount).
          const removable = !!onRemoveSet && !isOwn && !isUserKind;
          return (
            <Tooltip
              key={set.id}
              label={
                set.isInvalidated
                  ? `${set.name} — invalidated, content excluded`
                  : `${set.name} · ${detail}`
              }
              withArrow
            >
              <Badge
                variant="light"
                color={set.isInvalidated ? 'red' : isOwn ? 'violet' : 'blue'}
                radius="sm"
                size="lg"
                leftSection={
                  set.isInvalidated ? (
                    <IconAlertTriangle size={12} />
                  ) : isOwn ? (
                    <IconUser size={12} />
                  ) : undefined
                }
                rightSection={
                  removable ? (
                    <ActionIcon
                      size="xs"
                      variant="transparent"
                      color={set.isInvalidated ? 'red' : 'blue'}
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        onRemoveSet?.(set.id);
                      }}
                      aria-label={`Remove ${set.name}`}
                    >
                      <IconX size={12} />
                    </ActionIcon>
                  ) : undefined
                }
                styles={{ root: { textTransform: 'none', cursor: 'default' } }}
              >
                {set.name}
              </Badge>
            </Tooltip>
          );
        })}
        {onAdd ? (
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconPlus size={12} />}
            onClick={onAdd}
            loading={isAdding}
          >
            Add
          </Button>
        ) : null}
      </Group>
    </div>
  );
}
