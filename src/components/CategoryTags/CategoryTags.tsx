import { Button, useComputedColorScheme } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';

import { useModelQueryParams } from '~/components/Model/model.utils';
import { useCategoryTags } from '~/components/Tags/tag.utils';
import { TwScrollX } from '~/components/TwScrollX/TwScrollX';
import { useFiltersContext } from '~/providers/FiltersProvider';
import { TagTarget } from '~/shared/utils/prisma/enums';

export function CategoryTags({
  selected,
  setSelected,
  filter,
  includeEA = true,
  includeAll = true,
}: {
  selected?: string;
  setSelected?: (tag?: string) => void;
  filter?: (tag: string) => boolean;
  includeEA?: boolean;
  includeAll?: boolean;
}) {
  const colorScheme = useComputedColorScheme('dark');
  const { set, tag: tagQuery } = useModelQueryParams();

  const { data: categories } = useCategoryTags({ entityType: TagTarget.Model });

  if (!categories.length) return null;

  const handleSetTag = (tag: string | undefined) => set({ tag });

  const _tag = selected ?? tagQuery;
  const _setTag = setSelected ?? handleSetTag;

  return (
    <TwScrollX className="flex gap-1">
      {includeEA && <EarlyAccessBadge />}
      {includeAll && (
        <Button
          className="overflow-visible uppercase"
          variant={!_tag ? 'filled' : colorScheme === 'dark' ? 'filled' : 'light'}
          color={!_tag ? 'blue' : 'gray'}
          onClick={() => _setTag(undefined)}
          size="compact-sm"
        >
          All
        </Button>
      )}
      {categories
        .filter((x) => (filter ? filter(x.name) : true))
        .map((tag) => {
          const active = _tag === tag.name;
          return (
            <Button
              key={tag.id}
              className="overflow-visible uppercase"
              variant={active ? 'filled' : colorScheme === 'dark' ? 'filled' : 'light'}
              color={active ? 'blue' : 'gray'}
              onClick={() => _setTag(!active ? tag.name : undefined)}
              size="compact-sm"
            >
              {tag.name}
            </Button>
          );
        })}
    </TwScrollX>
  );
}

function EarlyAccessBadge() {
  const { setFilters, earlyAccess } = useFiltersContext((state) => ({
    setFilters: state.setModelFilters,
    earlyAccess: state.models.earlyAccess,
  }));

  return (
    <Button
      variant={earlyAccess ? 'filled' : 'outline'}
      color="success.5"
      onClick={() => setFilters({ earlyAccess: !earlyAccess })}
      size="compact-sm"
      className="overflow-visible"
      leftSection={<IconClock size={16} />}
    >
      Early Access
    </Button>
  );
}
