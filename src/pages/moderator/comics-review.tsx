import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconExternalLink,
  IconUser,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useState } from 'react';
import { getEdgeUrl } from '~/client-utils/cf-images-utils';
import { ImageGuard2 } from '~/components/ImageGuard/ImageGuard2';
import { Meta } from '~/components/Meta/Meta';
import { NoContent } from '~/components/NoContent/NoContent';
import { createServerSideProps } from '~/server/utils/server-side-helpers';
import {
  showErrorNotification,
  showSuccessNotification,
} from '~/utils/notifications';
import { trpc } from '~/utils/trpc';

const limitOptions = [10, 25, 50].map((n) => ({ value: String(n), label: `${n} per page` }));

// `Image.needsReview` is a free-form string column — these are the values
// `processImageScanWorkflow` and the audit-remix-source job actually emit
// today. New tags can be added without breaking the page (the filter is
// passed through as-is to the server).
const reviewReasonOptions = [
  { value: 'all', label: 'Any reason' },
  { value: 'minor', label: 'Minor flag' },
  { value: 'poi', label: 'POI flag' },
  { value: 'newUser', label: 'New user' },
  { value: 'bestiality', label: 'Bestiality' },
  { value: 'appeal', label: 'Appeal pending' },
  { value: 'csam', label: 'CSAM (manual)' },
];

export const getServerSideProps = createServerSideProps({
  useSession: true,
  resolver: async ({ session }) => {
    if (!session?.user?.isModerator) return { notFound: true };
    return { props: {} };
  },
});

export default function ComicsModerationReview() {
  const [limit, setLimit] = useState('25');
  const [needsReason, setNeedsReason] = useState('all');
  const [cursor, setCursor] = useState<number | undefined>();

  const utils = trpc.useUtils();
  const filters = {
    limit: Number(limit),
    cursor,
    needsReview: needsReason === 'all' ? undefined : needsReason,
    includeTosViolations: true,
  };
  const { data, isLoading, isFetching } = trpc.comics.getModReviewQueue.useQuery(filters);

  // Reuse the standard image moderation mutation. Approving here clears
  // `needsReview`/`ingestion` on the underlying Image; the `image-scan-result`
  // and `image.service` paths we extended already re-queue the parent
  // comic project for search-index refresh, so the comic flips back to
  // visible without further intervention.
  const moderateMutation = trpc.image.moderate.useMutation({
    onSuccess: () => {
      void utils.comics.getModReviewQueue.invalidate();
      showSuccessNotification({ message: 'Image moderated.' });
    },
    onError: (error) => {
      showErrorNotification({
        title: 'Moderation failed',
        error: new Error(error.message ?? 'Could not moderate this image.'),
      });
    },
  });

  const items = data?.items ?? [];

  return (
    <>
      <Meta title="Comic Review Queue" deIndex />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Stack gap={2}>
            <Title order={2}>Comics Review Queue</Title>
            <Text size="sm" c="dimmed">
              Comic panels whose underlying image was flagged for moderator review or marked as a
              TOS violation. Approving an image lifts the comic back into the public listing
              automatically.
            </Text>
          </Stack>
          <Group gap={8}>
            <Select
              placeholder="Reason"
              data={reviewReasonOptions}
              value={needsReason}
              onChange={(v) => {
                setCursor(undefined);
                if (v) setNeedsReason(v);
              }}
              w={180}
            />
            <Select
              placeholder="Limit"
              data={limitOptions}
              value={limit}
              onChange={(v) => {
                setCursor(undefined);
                if (v) setLimit(v);
              }}
              w={140}
            />
          </Group>
        </div>

        {isLoading ? (
          <Center p="xl">
            <Loader />
          </Center>
        ) : items.length === 0 ? (
          <NoContent message="No comic panels are awaiting review." />
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {items.map((panel) => {
              const project = panel.chapter.project;
              const author = project.user;
              const image = panel.image;
              const isBlocked = image?.tosViolation === true;
              const reasonLabel = isBlocked
                ? 'TOS violation'
                : image?.needsReview ?? '—';

              return (
                <div
                  key={panel.id}
                  className="rounded-lg border border-dark-4 overflow-hidden flex flex-col"
                  style={{ background: 'var(--mantine-color-dark-7)' }}
                >
                  <div className="relative aspect-[3/4] bg-dark-6">
                    {image && image.url ? (
                      <ImageGuard2
                        image={{
                          id: image.id,
                          nsfwLevel: image.nsfwLevel,
                          userId: author.id,
                          url: image.url,
                        }}
                      >
                        {(safe) =>
                          safe ? (
                            <img
                              src={getEdgeUrl(image.url, { width: 450 })}
                              alt={panel.prompt ?? 'Panel'}
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-dark-6 flex items-center justify-center text-dimmed text-sm">
                              Hidden
                            </div>
                          )
                        }
                      </ImageGuard2>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-dimmed">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        color={isBlocked ? 'red' : 'orange'}
                        leftSection={<IconAlertCircle size={11} />}
                        size="sm"
                        variant="filled"
                      >
                        {reasonLabel}
                      </Badge>
                      {project.tosViolation && (
                        <Badge color="red" size="sm" variant="light">
                          Project TOS
                        </Badge>
                      )}
                      {author.bannedAt && (
                        <Badge color="red" size="sm" variant="light">
                          Author banned
                        </Badge>
                      )}
                      {project.status !== 'Active' && (
                        <Badge color="gray" size="sm" variant="light">
                          {project.status}
                        </Badge>
                      )}
                    </div>
                    <Text size="sm" fw={600} lineClamp={1}>
                      <Link href={`/comics/project/${project.id}`}>
                        {project.name}
                      </Link>
                    </Text>
                    <Group gap={6}>
                      <IconUser size={12} />
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {author.deletedAt
                          ? `(deleted user #${author.id})`
                          : author.username ?? `user #${author.id}`}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Chapter <b>{panel.chapter.name}</b> · panel #{panel.position + 1}
                    </Text>
                    {panel.prompt && (
                      <Tooltip label={panel.prompt} multiline maw={400} withArrow>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {panel.prompt}
                        </Text>
                      </Tooltip>
                    )}
                    <Group gap={6} mt={4}>
                      <Button
                        size="compact-xs"
                        color="green"
                        variant="light"
                        leftSection={<IconCheck size={12} />}
                        loading={
                          moderateMutation.isPending &&
                          moderateMutation.variables?.ids[0] === image?.id &&
                          moderateMutation.variables?.reviewAction === 'unblock'
                        }
                        disabled={!image || moderateMutation.isPending}
                        onClick={() => {
                          if (!image) return;
                          moderateMutation.mutate({
                            ids: [image.id],
                            reviewAction: 'unblock',
                          });
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="compact-xs"
                        color="red"
                        variant="light"
                        leftSection={<IconBan size={12} />}
                        loading={
                          moderateMutation.isPending &&
                          moderateMutation.variables?.ids[0] === image?.id &&
                          moderateMutation.variables?.reviewAction === 'block'
                        }
                        disabled={!image || moderateMutation.isPending}
                        onClick={() => {
                          if (!image) return;
                          moderateMutation.mutate({
                            ids: [image.id],
                            reviewAction: 'block',
                          });
                        }}
                      >
                        Block
                      </Button>
                      <Button
                        component={Link}
                        href={`/comics/project/${project.id}`}
                        target="_blank"
                        size="compact-xs"
                        variant="default"
                        leftSection={<IconExternalLink size={12} />}
                      >
                        Open
                      </Button>
                    </Group>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data?.nextCursor && (
          <Center mt="md">
            <Button
              variant="light"
              loading={isFetching}
              onClick={() => setCursor(data.nextCursor)}
            >
              Load more
            </Button>
          </Center>
        )}
      </div>
    </>
  );
}
