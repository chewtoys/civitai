import {
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  List,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconCheck, IconDeviceMobile, IconShieldCheck, IconX } from '@tabler/icons-react';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';

interface DeviceAppInfo {
  client: {
    name: string;
    description: string;
    logoUrl: string | null;
    isVerified: boolean;
  };
  scopes: string[];
}

export default function DeviceAuthorizePage() {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const [code, setCode] = useState((router.query.code as string) ?? '');
  const [status, setStatus] = useState<
    'input' | 'loading' | 'review' | 'approving' | 'success' | 'error'
  >('input');
  const [error, setError] = useState('');
  const [appInfo, setAppInfo] = useState<DeviceAppInfo | null>(null);

  if (!currentUser) {
    const returnUrl = encodeURIComponent(router.asPath);
    router.replace(`/login?returnUrl=${returnUrl}`);
    return null;
  }

  // Step 1: Look up the code to get app info
  const handleLookup = async () => {
    if (!code.trim()) return;
    setStatus('loading');

    try {
      const res = await fetch('/api/auth/oauth/device-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: code.trim().toUpperCase() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error_description || 'Invalid or expired code');
        setStatus('error');
        return;
      }

      const data: DeviceAppInfo = await res.json();
      setAppInfo(data);
      setStatus('review');
    } catch {
      setError('Something went wrong');
      setStatus('error');
    }
  };

  // Step 2: Approve after reviewing
  const handleApprove = async () => {
    setStatus('approving');

    try {
      const res = await fetch('/api/auth/oauth/device-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: code.trim().toUpperCase() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error_description || 'Authorization failed');
        setStatus('error');
        return;
      }

      setStatus('success');
    } catch {
      setError('Something went wrong');
      setStatus('error');
    }
  };

  const handleDeny = () => {
    setAppInfo(null);
    setStatus('input');
    setCode('');
  };

  return (
    <Container size="xs" py="xl">
      <Card withBorder p="xl">
        <Stack gap="lg" align="center">
          {status === 'success' ? (
            <>
              <IconCheck size={48} color="green" />
              <Title order={3}>Device Authorized</Title>
              <Text c="dimmed" ta="center">
                You can close this page and return to your device.
              </Text>
            </>
          ) : status === 'error' ? (
            <>
              <IconX size={48} color="red" />
              <Title order={3}>Authorization Failed</Title>
              <Text c="dimmed" ta="center">
                {error}
              </Text>
              <Button
                onClick={() => {
                  setStatus('input');
                  setError('');
                  setAppInfo(null);
                }}
              >
                Try Again
              </Button>
            </>
          ) : status === 'review' || status === 'approving' ? (
            <>
              <IconDeviceMobile size={48} />
              <Stack align="center" gap="xs">
                <Title order={3}>Authorize {appInfo?.client.name}</Title>
                {appInfo?.client.isVerified && (
                  <Badge leftSection={<IconShieldCheck size={14} />} color="green" variant="light">
                    Verified by Civitai
                  </Badge>
                )}
                {appInfo?.client.description && (
                  <Text c="dimmed" size="sm" ta="center">
                    {appInfo.client.description}
                  </Text>
                )}
              </Stack>

              <Divider w="100%" />

              <Stack gap="xs" w="100%">
                <Text fw={500} size="sm">
                  This device is requesting access to your account:
                </Text>
                {appInfo?.scopes && appInfo.scopes.length > 0 ? (
                  <List spacing="xs" size="sm" icon={<IconCheck size={16} color="green" />}>
                    {appInfo.scopes.map((label) => (
                      <List.Item key={label}>{label}</List.Item>
                    ))}
                  </List>
                ) : (
                  <Text size="sm" c="dimmed">
                    No specific permissions requested
                  </Text>
                )}
              </Stack>

              <Divider w="100%" />

              <Group grow w="100%">
                <Button variant="default" onClick={handleDeny} disabled={status === 'approving'}>
                  Deny
                </Button>
                <Button onClick={handleApprove} loading={status === 'approving'}>
                  Authorize Device
                </Button>
              </Group>

              <Text size="xs" c="dimmed" ta="center">
                Signed in as {currentUser.username}
              </Text>
            </>
          ) : (
            <>
              <IconDeviceMobile size={48} />
              <Title order={3}>Connect a Device</Title>
              <Text c="dimmed" ta="center">
                Enter the code shown on your device to authorize it with your Civitai account.
              </Text>
              <TextInput
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                placeholder="XXXX-XXXX"
                size="lg"
                w="100%"
                styles={{
                  input: { textAlign: 'center', letterSpacing: '0.15em', fontWeight: 600 },
                }}
              />
              <Button
                fullWidth
                onClick={handleLookup}
                loading={status === 'loading'}
                disabled={!code.trim()}
              >
                Continue
              </Button>
              <Text size="xs" c="dimmed" ta="center">
                Signed in as {currentUser.username}
              </Text>
            </>
          )}
        </Stack>
      </Card>
    </Container>
  );
}
