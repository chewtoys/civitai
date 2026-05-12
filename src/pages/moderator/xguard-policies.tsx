/**
 * Moderator UI for managing XGuard label policies in Redis.
 *
 * Each policy is keyed by (mode, label). Modes are split because the prompt
 * input ("a photo of X in Y") and text input ("My bio says …") need different
 * policy framing even for the same label name. Labels without an entry in
 * Redis are dropped by `createXGuardModerationRequest` — civitai is the source
 * of truth for which labels are actively evaluated.
 */
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconInfoCircle, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { Meta } from '~/components/Meta/Meta';
import { Page } from '~/components/AppLayout/Page';
import { createServerSideProps } from '~/server/utils/server-side-helpers';
import type { XGuardMode } from '~/server/schema/xguard-policy.schema';
import type { XGuardPolicyEntry } from '~/server/services/xguard-policy.service';
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

const ACTION_OPTIONS = [
  { value: 'Block', label: 'Block' },
  { value: 'Review', label: 'Review' },
  { value: 'Scan', label: 'Scan' },
];

type FormState = {
  isNew: boolean;
  label: string;
  policy: string;
  threshold: number;
  action: string;
};

function XGuardPoliciesPage() {
  const [mode, setMode] = useState<XGuardMode>('text');

  return (
    <>
      <Meta title="XGuard Policies" deIndex />
      <Container size="lg" py="lg">
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={2}>XGuard Policies</Title>
            <Text c="dimmed" size="sm">
              Per-label policies for XGuard text and prompt moderation. Labels without an entry
              here are <strong>not evaluated</strong> when civitai submits a scan. The policy hash
              is recorded with every scan as <code>policyVersion</code> so review verdicts stay
              correlated to the exact text we sent.
            </Text>
          </Stack>

          <Tabs value={mode} onChange={(v) => v && setMode(v as XGuardMode)}>
            <Tabs.List>
              <Tabs.Tab value="text">Text mode</Tabs.Tab>
              <Tabs.Tab value="prompt">Prompt mode</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="text" pt="md">
              <PoliciesTab mode="text" />
            </Tabs.Panel>
            <Tabs.Panel value="prompt" pt="md">
              <PoliciesTab mode="prompt" />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Container>
    </>
  );
}

function PoliciesTab({ mode }: { mode: XGuardMode }) {
  const utils = trpc.useUtils();
  const { data: policies = [] } = trpc.xguardPolicy.list.useQuery({ mode });
  const [form, setForm] = useState<FormState | null>(null);

  const invalidate = () => utils.xguardPolicy.list.invalidate({ mode });

  const deleteMutation = trpc.xguardPolicy.delete.useMutation({
    onSuccess: () => {
      invalidate();
      showSuccessNotification({ title: 'Policy deleted', message: '' });
    },
    onError: (err) =>
      showErrorNotification({ title: 'Delete failed', error: new Error(err.message) }),
  });

  const openCreate = (prefill?: Partial<FormState>) =>
    setForm({
      isNew: true,
      label: prefill?.label ?? '',
      policy: prefill?.policy ?? '',
      threshold: prefill?.threshold ?? 0.5,
      action: prefill?.action ?? 'Block',
    });

  const openEdit = (entry: XGuardPolicyEntry) =>
    setForm({
      isNew: false,
      label: entry.label,
      policy: entry.policy,
      threshold: entry.threshold,
      action: entry.action,
    });

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Button leftSection={<IconPlus size={16} />} onClick={() => openCreate()}>
          New policy
        </Button>
        <Text c="dimmed" size="sm">
          {policies.length} configured
        </Text>
      </Group>

      {policies.length === 0 ? (
        <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
          No policies configured for <strong>{mode}</strong> mode yet. Use &ldquo;New
          policy&rdquo; to add one.
        </Alert>
      ) : (
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Label</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Threshold</Table.Th>
              <Table.Th>Policy hash</Table.Th>
              <Table.Th>Updated</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {policies.map((p) => (
              <Table.Tr key={p.label}>
                <Table.Td>
                  <code>{p.label}</code>
                </Table.Td>
                <Table.Td>{p.action}</Table.Td>
                <Table.Td>{p.threshold.toFixed(2)}</Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {p.policyHash}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {new Date(p.updatedAt).toLocaleString()}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconPencil size={14} />}
                      onClick={() => openEdit(p)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="default"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete policy for "${p.label}" (${mode} mode)? Future scans will silently skip this label until it's re-added.`
                          )
                        )
                          deleteMutation.mutate({ mode, label: p.label });
                      }}
                    >
                      Delete
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {form && (
        <PolicyFormModal
          mode={mode}
          form={form}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            invalidate();
          }}
        />
      )}
    </Stack>
  );
}

function PolicyFormModal({
  mode,
  form,
  onChange,
  onClose,
  onSaved,
}: {
  mode: XGuardMode;
  form: FormState;
  onChange: (next: FormState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const upsert = trpc.xguardPolicy.upsert.useMutation({
    onSuccess: () => {
      showSuccessNotification({ title: 'Policy saved', message: '' });
      onSaved();
    },
    onError: (err) =>
      showErrorNotification({ title: 'Save failed', error: new Error(err.message) }),
  });

  const canSave = form.label.trim().length > 0 && form.policy.trim().length > 0;

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        <Text fw={600}>
          {form.isNew ? 'New policy' : `Edit policy: ${form.label}`}{' '}
          <Badge variant="light" ml="xs">
            {mode}
          </Badge>
        </Text>
      }
      size="lg"
    >
      <Stack gap="md">
        <TextInput
          label="Label"
          description="The label name as the orchestrator knows it (e.g. csam, nsfw)."
          value={form.label}
          onChange={(e) => onChange({ ...form, label: e.currentTarget.value })}
          disabled={!form.isNew}
          required
        />
        <Textarea
          label="Policy"
          description="The natural-language policy sent to the model. First-token x = unsafe, sec = safe."
          value={form.policy}
          onChange={(e) => onChange({ ...form, policy: e.currentTarget.value })}
          minRows={10}
          maxRows={30}
          autosize
          required
        />
        <Group grow>
          <NumberInput
            label="Threshold"
            description="Score cutoff (0–1) above which the label triggers."
            value={form.threshold}
            onChange={(v) =>
              onChange({ ...form, threshold: typeof v === 'number' ? v : Number(v) || 0 })
            }
            min={0}
            max={1}
            step={0.05}
            decimalScale={2}
            required
          />
          <Select
            label="Action"
            description="What the orchestrator does when the label triggers."
            data={ACTION_OPTIONS}
            value={form.action}
            onChange={(v) => v && onChange({ ...form, action: v })}
            required
          />
        </Group>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            loading={upsert.isLoading}
            onClick={() =>
              upsert.mutate({
                mode,
                label: form.label.trim(),
                policy: form.policy,
                threshold: form.threshold,
                action: form.action,
              })
            }
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default Page(XGuardPoliciesPage);
