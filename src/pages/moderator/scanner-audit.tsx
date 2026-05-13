/**
 * Moderator review queue for XGuard / image-ingestion scanner audit data.
 *
 * Two tabs:
 *  - Triggered (FP review): decisions where the model fired. Latest first.
 *  - Near-miss (FN review): decisions where the model didn't fire but came
 *    close (score ≥ threshold × floor). Highest score first.
 *
 * Each row is a deduped (contentHash, version, label) decision — many
 * scans of identical content under the same policy collapse to one row with
 * an occurrence count and a workflowIds list. Click a row → drawer showing
 * every label evaluated for that (contentHash, version) pair. Per-label
 * TP/FP/TN/FN/Unsure buttons write `ScannerLabelReview` keyed by the same
 * three columns, so verdicting once covers all future identical scans.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Container,
  Drawer,
  Group,
  Pagination,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDownload, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { Meta } from '~/components/Meta/Meta';
import { Page } from '~/components/AppLayout/Page';
import { createServerSideProps } from '~/server/utils/server-side-helpers';
import type { QueueView, Scanner } from '~/server/schema/scanner-review.schema';
import type { AggregatedScanRow, QueueRow } from '~/server/services/scanner-review.service';
import { ReviewVerdict } from '~/shared/utils/prisma/enums';
import { showErrorNotification, showSuccessNotification } from '~/utils/notifications';
import { trpc } from '~/utils/trpc';

export const getServerSideProps = createServerSideProps({
  useSession: true,
  resolver: async ({ session }) => {
    if (!session || !session.user?.isModerator)
      return { redirect: { destination: '/', permanent: false } };
    return { props: {} };
  },
});

const SCANNER_OPTIONS = [
  { value: '', label: 'All scanners' },
  { value: 'xguard_text', label: 'XGuard text' },
  { value: 'xguard_prompt', label: 'XGuard prompt' },
  { value: 'image_ingestion', label: 'Image ingestion' },
];

const PAGE_SIZE = 50;

type Filters = {
  scanner: string;
  label: string;
  version: string;
};

type SelectedKey = { contentHash: string; version: string };

function ScannerAuditPage() {
  const [view, setView] = useState<QueueView>('triggered');
  const [filters, setFilters] = useState<Filters>({ scanner: '', label: '', version: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SelectedKey | null>(null);

  const queryInput = useMemo(
    () => ({
      view,
      scanner: (filters.scanner || undefined) as Scanner | undefined,
      label: filters.label || undefined,
      version: filters.version || undefined,
      nearMissFloor: 0.5,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [view, filters, page]
  );

  const { data, isFetching } = trpc.scannerReview.list.useQuery(queryInput);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <Meta title="Scanner Audit" deIndex />
      <Container size="xl" py="lg">
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={2}>Scanner Audit</Title>
            <Text c="dimmed" size="sm">
              Each row is a deduped <code>(contentHash, version, label)</code> decision —
              identical re-scans collapse together. Verdicting once covers all future identical
              inputs. Mark FPs (label fired when it shouldn&apos;t have) on the Triggered tab,
              FNs (label should have fired but didn&apos;t) on the Near-miss tab.
            </Text>
          </Stack>

          <Group>
            <Select
              label="Scanner"
              data={SCANNER_OPTIONS}
              value={filters.scanner}
              onChange={(v) => {
                setFilters((f) => ({ ...f, scanner: v ?? '' }));
                setPage(1);
              }}
              size="xs"
              w={200}
            />
            <TextInput
              label="Label"
              placeholder="e.g. csam"
              value={filters.label}
              onChange={(e) => {
                setFilters((f) => ({ ...f, label: e.currentTarget.value }));
                setPage(1);
              }}
              size="xs"
              w={180}
            />
            <TextInput
              label="Policy version"
              placeholder="version"
              value={filters.version}
              onChange={(e) => {
                setFilters((f) => ({ ...f, version: e.currentTarget.value }));
                setPage(1);
              }}
              size="xs"
              w={220}
            />
            <div style={{ flexGrow: 1 }} />
            <ExportButton view={view} filters={filters} />
          </Group>

          <Tabs
            value={view}
            onChange={(v) => {
              if (v) {
                setView(v as QueueView);
                setPage(1);
              }
            }}
          >
            <Tabs.List>
              <Tabs.Tab value="triggered">Triggered (FP review)</Tabs.Tab>
              <Tabs.Tab value="near-miss">Near-miss (FN review)</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {!isFetching && data && data.rows.length === 0 ? (
            <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
              No {view === 'triggered' ? 'triggered' : 'near-miss'} decisions match the current
              filters in the last 30 days.
            </Alert>
          ) : (
            <Stack gap="sm">
              <Table striped withTableBorder highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Scanner</Table.Th>
                    <Table.Th>Label</Table.Th>
                    <Table.Th>Score</Table.Th>
                    <Table.Th>Threshold</Table.Th>
                    <Table.Th>Occurrences</Table.Th>
                    <Table.Th>Policy</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Last seen</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data?.rows.map((r) => (
                    <Table.Tr
                      key={`${r.contentHash}::${r.version}::${r.label}`}
                      onClick={() =>
                        setSelected({ contentHash: r.contentHash, version: r.version })
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td>
                        <Badge variant="light" size="xs">
                          {r.scanner.replace('xguard_', '').replace('image_ingestion', 'image')}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <code>{r.label}</code>
                        {r.labelValue && (
                          <Text size="xs" c="dimmed" component="span" ml={4}>
                            = {r.labelValue}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{r.score.toFixed(3)}</Table.Td>
                      <Table.Td>{r.threshold !== null ? r.threshold.toFixed(2) : '—'}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{r.occurrences.toLocaleString()}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={r.version || '(none)'}>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {r.version ? `${r.version.slice(0, 10)}…` : '—'}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {r.myVerdict && (
                            <Badge size="xs" color={verdictColor(r.myVerdict)}>
                              {verdictShort(r.myVerdict)}
                            </Badge>
                          )}
                          {!r.myVerdict && r.anyVerdict && (
                            <Tooltip label="Verdict from another moderator">
                              <Badge
                                size="xs"
                                color={verdictColor(r.anyVerdict)}
                                variant="outline"
                              >
                                {verdictShort(r.anyVerdict)}
                              </Badge>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {new Date(r.lastSeenAt).toLocaleString()}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>

              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {data ? `${data.total.toLocaleString()} matching decisions` : '—'}
                </Text>
                <Pagination value={page} onChange={setPage} total={totalPages} size="sm" />
              </Group>
            </Stack>
          )}
        </Stack>
      </Container>

      {selected && (
        <ScanDetailDrawer
          contentHash={selected.contentHash}
          version={selected.version}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ExportButton({ view, filters }: { view: QueueView; filters: Filters }) {
  const utils = trpc.useUtils();
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await utils.scannerReview.exportRows.fetch({
        view,
        scanner: (filters.scanner || undefined) as Scanner | undefined,
        label: filters.label || undefined,
        version: filters.version || undefined,
        nearMissFloor: 0.5,
        limit: 50000,
        offset: 0,
      });
      const csv = toCsv(result.rows);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scanner-audit-${view}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showErrorNotification({ title: 'Export failed', error: err as Error });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="default"
      leftSection={<IconDownload size={14} />}
      loading={loading}
      onClick={handleExport}
      mt={22}
      size="xs"
    >
      Export CSV
    </Button>
  );
}

function ScanDetailDrawer({
  contentHash,
  version,
  onClose,
}: {
  contentHash: string;
  version: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.scannerReview.detail.useQuery({ contentHash, version });

  const invalidate = () => {
    utils.scannerReview.detail.invalidate({ contentHash, version });
    utils.scannerReview.list.invalidate();
  };

  const upsertVerdict = trpc.scannerReview.upsertVerdict.useMutation({
    onSuccess: () => {
      invalidate();
      showSuccessNotification({ title: 'Verdict saved', message: '' });
    },
    onError: (err) =>
      showErrorNotification({ title: 'Verdict failed', error: new Error(err.message) }),
  });
  const deleteVerdict = trpc.scannerReview.deleteVerdict.useMutation({
    onSuccess: () => invalidate(),
  });

  // The mod's own verdict per label (so the UI highlights it). Other mods'
  // verdicts surface in the row's "Status" badge but aren't editable.
  const myVerdictByLabel = useMemo(() => {
    const map = new Map<string, ReviewVerdict>();
    // Note: detail query returns verdicts from ALL mods. We don't have userId
    // client-side here without an extra query, so the list view already
    // surfaces "myVerdict" separately. The drawer lets the mod set their own.
    return map;
  }, []);

  return (
    <Drawer
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>Scan decision</Text>
          <Tooltip label={`contentHash ${contentHash}`}>
            <Text ff="monospace" size="xs" c="dimmed">
              {contentHash.slice(0, 12)}…
            </Text>
          </Tooltip>
        </Group>
      }
      position="right"
      size="xl"
    >
      {isLoading || !data ? (
        <Text c="dimmed">Loading…</Text>
      ) : data.rows.length === 0 ? (
        <Alert color="yellow">
          No data found for this scan decision in the lookback window.
        </Alert>
      ) : (
        <Stack gap="lg">
          {data.rows[0] && (
            <Group gap="xs" wrap="wrap">
              <Badge variant="light">
                {data.rows[0].scanner
                  .replace('xguard_', '')
                  .replace('image_ingestion', 'image')}
              </Badge>
              {data.rows[0].entityType && (
                <Badge variant="outline">{data.rows[0].entityType}</Badge>
              )}
              <Badge variant="outline">policy {version || '(none)'}</Badge>
              <Badge variant="outline">model {data.rows[0].modelVersion}</Badge>
              <Badge variant="outline" color="cyan">
                {data.rows[0].occurrences.toLocaleString()} occurrences
              </Badge>
              <Badge variant="outline">{data.rows[0].workflowIds.length} workflows</Badge>
            </Group>
          )}

          <Stack gap="md">
            {data.rows.map((r) => (
              <LabelDetail
                key={r.label}
                row={r}
                myVerdict={myVerdictByLabel.get(r.label) ?? null}
                verdictsForLabel={data.verdicts.filter((v) => v.label === r.label)}
                onVerdict={(verdict) =>
                  upsertVerdict.mutate({
                    contentHash: r.contentHash,
                    version: r.version,
                    label: r.label,
                    verdict,
                  })
                }
                onClear={() =>
                  deleteVerdict.mutate({
                    contentHash: r.contentHash,
                    version: r.version,
                    label: r.label,
                  })
                }
                pending={upsertVerdict.isLoading || deleteVerdict.isLoading}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}

function LabelDetail({
  row,
  myVerdict,
  verdictsForLabel,
  onVerdict,
  onClear,
  pending,
}: {
  row: AggregatedScanRow;
  myVerdict: ReviewVerdict | null;
  verdictsForLabel: Array<{
    label: string;
    reviewedBy: number;
    reviewedAt: Date;
    verdict: ReviewVerdict;
    note: string | null;
  }>;
  onVerdict: (v: ReviewVerdict) => void;
  onClear: () => void;
  pending: boolean;
}) {
  const triggered = row.triggered === 1;
  const verdictCounts = useMemo(() => {
    const counts = new Map<ReviewVerdict, number>();
    for (const v of verdictsForLabel) counts.set(v.verdict, (counts.get(v.verdict) ?? 0) + 1);
    return counts;
  }, [verdictsForLabel]);

  return (
    <Stack
      gap="xs"
      p="md"
      style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8 }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs">
          <code style={{ fontSize: 14 }}>{row.label}</code>
          {row.labelValue && <Badge size="xs">{row.labelValue}</Badge>}
          {triggered ? (
            <Badge color="red" size="xs">
              triggered
            </Badge>
          ) : (
            <Badge color="gray" variant="outline" size="xs">
              not triggered
            </Badge>
          )}
          <Text size="xs" c="dimmed">
            score {row.score.toFixed(3)}
            {row.threshold !== null && ` / threshold ${row.threshold.toFixed(2)}`}
          </Text>
        </Group>
        <Group gap={4} wrap="nowrap">
          {(
            [
              'TruePositive',
              'FalsePositive',
              'TrueNegative',
              'FalseNegative',
              'Unsure',
            ] as const
          ).map((v) => (
            <Button
              key={v}
              size="xs"
              variant={myVerdict === ReviewVerdict[v] ? 'filled' : 'default'}
              color={verdictColor(ReviewVerdict[v])}
              disabled={pending}
              onClick={() => onVerdict(ReviewVerdict[v])}
            >
              {verdictShort(ReviewVerdict[v])}
            </Button>
          ))}
          {myVerdict && (
            <Tooltip label="Clear my verdict">
              <ActionIcon variant="default" size="lg" disabled={pending} onClick={onClear}>
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      {verdictCounts.size > 0 && (
        <Group gap={4}>
          <Text size="xs" c="dimmed">
            verdicts:
          </Text>
          {Array.from(verdictCounts.entries()).map(([v, n]) => (
            <Badge key={v} size="xs" color={verdictColor(v)} variant="light">
              {verdictShort(v)} × {n}
            </Badge>
          ))}
        </Group>
      )}

      {triggered && row.modelReason && (
        <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
          {row.modelReason}
        </Text>
      )}
      {triggered && row.matchedText.length > 0 && (
        <MatchedTermsRow label="text" terms={row.matchedText} />
      )}
      {triggered && row.matchedPositivePrompt.length > 0 && (
        <MatchedTermsRow label="positive" terms={row.matchedPositivePrompt} />
      )}
      {triggered && row.matchedNegativePrompt.length > 0 && (
        <MatchedTermsRow label="negative" terms={row.matchedNegativePrompt} />
      )}
    </Stack>
  );
}

function MatchedTermsRow({ label, terms }: { label: string; terms: string[] }) {
  return (
    <Group gap={4} wrap="wrap">
      <Text size="xs" c="dimmed" fw={500}>
        matched {label}:
      </Text>
      {terms.map((t, i) => (
        <Badge key={`${t}-${i}`} size="xs" variant="light" color="orange">
          {t}
        </Badge>
      ))}
    </Group>
  );
}

function verdictColor(v: ReviewVerdict): string {
  switch (v) {
    case ReviewVerdict.TruePositive:
      return 'green';
    case ReviewVerdict.FalsePositive:
      return 'red';
    case ReviewVerdict.TrueNegative:
      return 'green';
    case ReviewVerdict.FalseNegative:
      return 'red';
    case ReviewVerdict.Unsure:
    default:
      return 'gray';
  }
}

function verdictShort(v: ReviewVerdict): string {
  switch (v) {
    case ReviewVerdict.TruePositive:
      return 'TP';
    case ReviewVerdict.FalsePositive:
      return 'FP';
    case ReviewVerdict.TrueNegative:
      return 'TN';
    case ReviewVerdict.FalseNegative:
      return 'FN';
    case ReviewVerdict.Unsure:
      return '?';
  }
}

function toCsv(rows: QueueRow[]): string {
  if (rows.length === 0) return '';
  const headers = [
    'contentHash',
    'version',
    'label',
    'scanner',
    'entityType',
    'labelValue',
    'modelVersion',
    'score',
    'threshold',
    'triggered',
    'occurrences',
    'firstSeenAt',
    'lastSeenAt',
    'durationMs',
    'workflowIds',
    'entityIds',
    'modelReason',
    'matchedText',
    'matchedPositivePrompt',
    'matchedNegativePrompt',
    'myVerdict',
    'anyVerdict',
  ] as const;
  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells: (string | number | null)[] = [
      r.contentHash,
      r.version,
      r.label,
      r.scanner,
      r.entityType,
      r.labelValue,
      r.modelVersion,
      r.score,
      r.threshold,
      r.triggered,
      r.occurrences,
      r.firstSeenAt,
      r.lastSeenAt,
      r.durationMs,
      r.workflowIds.join('|'),
      r.entityIds.join('|'),
      r.modelReason,
      r.matchedText.join('|'),
      r.matchedPositivePrompt.join('|'),
      r.matchedNegativePrompt.join('|'),
      r.myVerdict ?? '',
      r.anyVerdict ?? '',
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n');
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default Page(ScannerAuditPage);
