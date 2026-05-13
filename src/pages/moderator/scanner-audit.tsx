/**
 * Moderator review queue for XGuard scanner audit data.
 *
 * Two tabs:
 *  - Triggered (FP review): rows where a label fired. Latest first.
 *  - Near-miss (FN review): rows where a label didn't fire but came close
 *    (score >= threshold * floor). Highest score first.
 *
 * Click any row → drawer with the full per-label breakdown for that workflow.
 * Per-label verdict buttons (TP/FP/TN/FN/Unsure) write `ScannerReview`. The
 * "Mark scan reviewed" button at the bottom writes `ScannerScanReview` so the
 * scan disappears from the queue.
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
  Textarea,
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
import type { ScanLabelRow } from '~/server/services/scanner-review.service';
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
];

const PAGE_SIZE = 50;

type Filters = {
  scanner: string;
  label: string;
  policyVersion: string;
};

function ScannerAuditPage() {
  const [view, setView] = useState<QueueView>('triggered');
  const [filters, setFilters] = useState<Filters>({ scanner: '', label: '', policyVersion: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const queryInput = useMemo(
    () => ({
      view,
      scanner: (filters.scanner || undefined) as Scanner | undefined,
      label: filters.label || undefined,
      policyVersion: filters.policyVersion || undefined,
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
              Review XGuard scan results to mark false positives (labels that fired but
              shouldn&apos;t have) and false negatives (labels that should have fired). Verdicts
              feed the prompt-tuning workflow.
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
              w={180}
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
              placeholder="e.g. sha256-8:a3f5b2c8"
              value={filters.policyVersion}
              onChange={(e) => {
                setFilters((f) => ({ ...f, policyVersion: e.currentTarget.value }));
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
              No {view === 'triggered' ? 'triggered' : 'near-miss'} scans match the current
              filters.
            </Alert>
          ) : (
            <Stack gap="sm">
              <Table striped withTableBorder highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Workflow</Table.Th>
                    <Table.Th>Scanner</Table.Th>
                    <Table.Th>Entity</Table.Th>
                    <Table.Th>Label</Table.Th>
                    <Table.Th>Score</Table.Th>
                    <Table.Th>Threshold</Table.Th>
                    <Table.Th>Policy</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Time</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data?.rows.map((r) => (
                    <Table.Tr
                      key={`${r.workflowId}-${r.label}`}
                      onClick={() => setSelected(r.workflowId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Table.Td>
                        <Tooltip label={r.workflowId}>
                          <Text size="xs" ff="monospace">
                            {r.workflowId.slice(0, 12)}…
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="xs">
                          {r.scanner.replace('xguard_', '')}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {r.entityType ? (
                          <Text size="xs">
                            {r.entityType}
                            {r.entityId ? `:${r.entityId}` : ''}
                          </Text>
                        ) : (
                          <Text size="xs" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <code>{r.label}</code>
                      </Table.Td>
                      <Table.Td>{r.score.toFixed(3)}</Table.Td>
                      <Table.Td>{r.threshold !== null ? r.threshold.toFixed(2) : '—'}</Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {r.policyVersion}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {r.labelVerdict && (
                            <Badge size="xs" color={verdictColor(r.labelVerdict)}>
                              {verdictShort(r.labelVerdict)}
                            </Badge>
                          )}
                          {r.hasScanReview && (
                            <Badge size="xs" color="gray" variant="outline">
                              reviewed
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {new Date(r.createdAt).toLocaleString()}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>

              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {data ? `${data.total.toLocaleString()} matching rows` : '—'}
                </Text>
                <Pagination value={page} onChange={setPage} total={totalPages} size="sm" />
              </Group>
            </Stack>
          )}
        </Stack>
      </Container>

      {selected && (
        <ScanDetailDrawer workflowId={selected} onClose={() => setSelected(null)} />
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
        policyVersion: filters.policyVersion || undefined,
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
  workflowId,
  onClose,
}: {
  workflowId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.scannerReview.detail.useQuery({ workflowId });
  const [submitNote, setSubmitNote] = useState('');

  const invalidate = () => {
    utils.scannerReview.detail.invalidate({ workflowId });
    utils.scannerReview.list.invalidate();
  };

  const upsertVerdict = trpc.scannerReview.upsertVerdict.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) =>
      showErrorNotification({ title: 'Verdict failed', error: new Error(err.message) }),
  });
  const deleteVerdict = trpc.scannerReview.deleteVerdict.useMutation({
    onSuccess: () => invalidate(),
  });
  const submitReview = trpc.scannerReview.submitReview.useMutation({
    onSuccess: () => {
      invalidate();
      showSuccessNotification({ title: 'Scan marked reviewed', message: '' });
      onClose();
    },
    onError: (err) =>
      showErrorNotification({ title: 'Submit failed', error: new Error(err.message) }),
  });

  const verdictByLabel = useMemo(() => {
    const map = new Map<string, ReviewVerdict>();
    for (const v of data?.labelVerdicts ?? []) map.set(v.label, v.verdict);
    return map;
  }, [data?.labelVerdicts]);

  return (
    <Drawer
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>Scan detail</Text>
          <Text ff="monospace" size="xs" c="dimmed">
            {workflowId}
          </Text>
        </Group>
      }
      position="right"
      size="xl"
    >
      {isLoading || !data ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Stack gap="lg">
          {data.rows.length > 0 && (
            <Group gap="xs">
              <Badge variant="light">{data.rows[0].scanner.replace('xguard_', '')}</Badge>
              {data.rows[0].entityType && (
                <Badge variant="outline">
                  {data.rows[0].entityType}
                  {data.rows[0].entityId ? `:${data.rows[0].entityId}` : ''}
                </Badge>
              )}
              <Badge variant="outline">policy {data.rows[0].policyVersion}</Badge>
              <Badge variant="outline">model {data.rows[0].modelVersion}</Badge>
            </Group>
          )}

          <Stack gap="md">
            {data.rows.map((r) => (
              <LabelDetail
                key={r.label}
                row={r}
                verdict={verdictByLabel.get(r.label) ?? null}
                onVerdict={(verdict) =>
                  upsertVerdict.mutate({ workflowId, label: r.label, verdict })
                }
                onClear={() => deleteVerdict.mutate({ workflowId, label: r.label })}
                pending={upsertVerdict.isLoading || deleteVerdict.isLoading}
              />
            ))}
          </Stack>

          <Stack gap="xs">
            <Textarea
              label="Review note (optional)"
              value={submitNote}
              onChange={(e) => setSubmitNote(e.currentTarget.value)}
              minRows={2}
              autosize
            />
            <Group justify="flex-end">
              <Button
                onClick={() =>
                  submitReview.mutate({ workflowId, note: submitNote || undefined })
                }
                loading={submitReview.isLoading}
              >
                Mark scan reviewed
              </Button>
            </Group>
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}

function LabelDetail({
  row,
  verdict,
  onVerdict,
  onClear,
  pending,
}: {
  row: ScanLabelRow;
  verdict: ReviewVerdict | null;
  onVerdict: (v: ReviewVerdict) => void;
  onClear: () => void;
  pending: boolean;
}) {
  const triggered = row.triggered === 1;
  return (
    <Stack
      gap="xs"
      p="md"
      style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8 }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs">
          <code style={{ fontSize: 14 }}>{row.label}</code>
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
          {(['TruePositive', 'FalsePositive', 'TrueNegative', 'FalseNegative', 'Unsure'] as const).map(
            (v) => (
              <Button
                key={v}
                size="xs"
                variant={verdict === ReviewVerdict[v] ? 'filled' : 'default'}
                color={verdictColor(ReviewVerdict[v])}
                disabled={pending}
                onClick={() => onVerdict(ReviewVerdict[v])}
              >
                {verdictShort(ReviewVerdict[v])}
              </Button>
            )
          )}
          {verdict && (
            <Tooltip label="Clear verdict">
              <ActionIcon variant="default" size="lg" disabled={pending} onClick={onClear}>
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
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

function toCsv(rows: ScanLabelRow[]): string {
  if (rows.length === 0) return '';
  const headers = [
    'workflowId',
    'scanner',
    'entityType',
    'entityId',
    'createdAt',
    'label',
    'labelValue',
    'score',
    'threshold',
    'triggered',
    'policyVersion',
    'modelVersion',
    'modelReason',
    'matchedText',
    'matchedPositivePrompt',
    'matchedNegativePrompt',
  ] as const;
  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells: (string | number | null)[] = [
      r.workflowId,
      r.scanner,
      r.entityType,
      r.entityId,
      r.createdAt,
      r.label,
      r.labelValue,
      r.score,
      r.threshold,
      r.triggered,
      r.policyVersion,
      r.modelVersion,
      r.modelReason,
      r.matchedText.join('|'),
      r.matchedPositivePrompt.join('|'),
      r.matchedNegativePrompt.join('|'),
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
