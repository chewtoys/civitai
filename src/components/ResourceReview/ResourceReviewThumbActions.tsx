import type { MantineSize } from '@mantine/core';
import { Button, Group, Text } from '@mantine/core';
import { LoginRedirect } from '~/components/LoginRedirect/LoginRedirect';
import {
  useCreateResourceReview,
  useDeleteResourceReview,
  useQueryResourceReviewTotals,
  useQueryUserResourceReview,
  useUpdateResourceReview,
} from '~/components/ResourceReview/resourceReview.utils';
import { abbreviateNumber } from '~/utils/number-helpers';
import { IconBadge } from '~/components/IconBadge/IconBadge';
import { ThumbsDownIcon, ThumbsUpIcon } from '~/components/ThumbsIcon/ThumbsIcon';
import type { ResourceReviewSimpleModel } from '~/server/selectors/resourceReview.selector';
import { trpc } from '~/utils/trpc';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import classes from './ResourceReviewThumbActions.module.scss';

export function ResourceReviewThumbActions({
  modelId,
  modelVersionId,
  userReview,
  withCount,
  size,
}: {
  modelId: number;
  modelVersionId: number;
  userReview?: ResourceReviewSimpleModel | null;
  withCount?: boolean;
  size?: MantineSize;
}) {
  const { totals, loading: loadingTotals } = useQueryResourceReviewTotals(
    {
      modelId,
      modelVersionId,
    },
    { enabled: withCount }
  );
  const { loading: loadingUserReview } = useQueryUserResourceReview({
    modelVersionId,
  });

  const createMutation = useCreateResourceReview();
  const updateMutation = useUpdateResourceReview();
  const deleteMutation = useDeleteResourceReview();

  const handleReviewRatingChange = ({ recommended }: { recommended: boolean }) => {
    if (userReview?.id) {
      return updateMutation.mutate({
        id: userReview.id,
        recommended,
        rating: recommended ? 5 : 1,
      });
    }

    return createMutation.mutate({
      modelId,
      modelVersionId,
      recommended,
      rating: recommended ? 5 : 1,
    });
  };

  const handleDeleteReview = () => {
    if (!userReview) return;
    deleteMutation.mutate({ id: userReview.id });
  };

  const isThumbsUp = userReview?.recommended === true;
  const isThumbsDown = userReview?.recommended === false;
  const saving = createMutation.isLoading || updateMutation.isLoading || deleteMutation.isLoading;
  const loading = loadingTotals || loadingUserReview || saving;

  return (
    <Button.Group style={{ gap: 4 }}>
      <LoginRedirect reason="create-review">
        <Button
          variant={isThumbsUp ? 'light' : 'filled'}
          color={isThumbsUp ? 'success' : 'dark.4'}
          radius="md"
          disabled={loading}
          onClick={() =>
            isThumbsUp ? handleDeleteReview() : handleReviewRatingChange({ recommended: true })
          }
          className={classes.button}
          size={size}
          fullWidth
        >
          <Text component="div" c="success.5" size="xs" inline>
            <Group gap={4} wrap="nowrap">
              <ThumbsUpIcon size={20} filled={isThumbsUp} />{' '}
              {withCount && !loadingTotals && abbreviateNumber(totals?.up ?? 0)}
            </Group>
          </Text>
        </Button>
      </LoginRedirect>
      <LoginRedirect reason="create-review">
        <Button
          variant={isThumbsDown ? 'light' : 'filled'}
          color={isThumbsDown ? 'red' : 'dark.4'}
          radius="md"
          disabled={loading}
          onClick={() =>
            isThumbsDown ? handleDeleteReview() : handleReviewRatingChange({ recommended: false })
          }
          className={classes.button}
          size={size}
          fullWidth
        >
          <Text component="div" c="red" inline>
            <ThumbsDownIcon size={20} filled={isThumbsDown} />
          </Text>
        </Button>
      </LoginRedirect>
    </Button.Group>
  );
}

export function ResourceReviewThumbBadge({
  modelId,
  modelVersionId,
  count: initialCount,
  onClick,
}: {
  modelId: number;
  onClick: VoidFunction;
  modelVersionId?: number;
  count?: number;
}) {
  const currentUser = useCurrentUser();
  const { totals, loading } = useQueryResourceReviewTotals({ modelId, modelVersionId });
  const { data: { Recommended: reviewedModels = [] } = { Recommended: [] } } =
    trpc.user.getEngagedModels.useQuery(undefined, { enabled: !!currentUser });

  if (loading && initialCount === undefined) return null;

  const hasReview = reviewedModels.includes(modelId);

  return (
    <IconBadge
      radius="sm"
      color={hasReview ? 'success.5' : 'gray'}
      size="lg"
      icon={<ThumbsUpIcon size={16} filled />}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <Text>{abbreviateNumber(totals?.up ?? 0)}</Text>
    </IconBadge>
  );
}
