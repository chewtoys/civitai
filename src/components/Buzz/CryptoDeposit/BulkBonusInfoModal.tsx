import { Badge, Group, Modal, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBolt, IconTrendingUp } from '@tabler/icons-react';
import { useDialogContext } from '~/components/Dialog/DialogProvider';
import { CurrencyIcon } from '~/components/Currency/CurrencyIcon';
import { getFiatDisplay } from '~/components/Buzz/CryptoDeposit/crypto-deposit.constants';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useCurrentUserSettings } from '~/components/UserSettings/hooks';
import { buzzBulkBonusMultipliers } from '~/server/common/constants';
import { Currency } from '~/shared/utils/prisma/enums';
import { numberWithCommas } from '~/utils/number-helpers';
import { trpc } from '~/utils/trpc';

type Props = Record<string, never>;

function formatFiat(buzz: number, buzzPrice: number | null, symbol: string) {
  if (buzzPrice == null) return `$${numberWithCommas(Math.round(buzz / 1000))}`;
  const value = (buzz / 1000) * buzzPrice;
  return `${symbol}${numberWithCommas(Math.round(value))}`;
}

export default function BulkBonusInfoModal(_props: Props) {
  const dialog = useDialogContext();
  const currentUser = useCurrentUser();
  const userSettings = useCurrentUserSettings();
  const selectedFiat = userSettings.preferredFiatCurrency ?? 'usd';
  const { symbol: fiatSymbol } = getFiatDisplay(selectedFiat);

  const { data: conversionRate } = trpc.nowPayments.getBuzzConversionRate.useQuery(
    { fiat: selectedFiat },
    { staleTime: 60 * 1000, enabled: !!currentUser }
  );
  const buzzPrice = conversionRate?.rate ?? null;

  return (
    <Modal
      {...dialog}
      size="md"
      radius="lg"
      withCloseButton
      title={
        <Group gap="sm" align="center" wrap="nowrap">
          <ThemeIcon size={36} variant="light" color="yellow" radius="md">
            <IconTrendingUp size={22} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text fw={700} size="lg" lh={1.2}>
              Bulk Purchase Bonus
            </Text>
            <Text size="xs" c="dimmed" lh={1.2}>
              Deposit more, get bonus Blue Buzz on top
            </Text>
          </Stack>
        </Group>
      }
      classNames={{ title: 'flex-1' }}
    >
      <Stack gap="md" pb="sm">
        <Text size="sm" c="dimmed" lh={1.5}>
          When your deposit credits {numberWithCommas(buzzBulkBonusMultipliers[0][0])} Buzz or
          more, you earn extra Blue Buzz automatically. Bonus tiers below apply to the
          credited Buzz from your crypto deposit.
        </Text>

        <Stack gap="xs">
          {buzzBulkBonusMultipliers.map(([min, multiplier]) => {
            const bonusPercent = Math.round((multiplier - 1) * 100);
            const totalAmount = Math.floor(min * multiplier);
            const bonusAmount = totalAmount - min;
            const fiatLabel = formatFiat(min, buzzPrice, fiatSymbol);

            return (
              <Group
                key={min}
                justify="space-between"
                wrap="nowrap"
                p="sm"
                className="rounded-md border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04]"
              >
                <Stack gap={2}>
                  <Group gap={6} wrap="nowrap">
                    <CurrencyIcon size={16} currency={Currency.BUZZ} />
                    <Text size="sm" fw={600}>
                      {numberWithCommas(min)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      ({fiatLabel}+)
                    </Text>
                  </Group>
                  {bonusPercent > 0 && (
                    <Group gap={4} wrap="nowrap">
                      <CurrencyIcon size={12} currency={Currency.BUZZ} type="blue" />
                      <Text size="xs" c="dimmed">
                        +{numberWithCommas(bonusAmount)} bonus Blue Buzz
                      </Text>
                    </Group>
                  )}
                </Stack>
                <Badge variant="light" color="blue" size="md">
                  +{bonusPercent}%
                </Badge>
              </Group>
            );
          })}
        </Stack>

        <Group gap={6} align="flex-start" wrap="nowrap">
          <IconBolt size={14} className="mt-0.5 shrink-0 text-blue-400" />
          <Text size="xs" c="dimmed" lh={1.4}>
            Blue Buzz can only be used for generations. Membership bonuses and bulk bonuses
            don&apos;t stack. The larger of the two is applied.
          </Text>
        </Group>
      </Stack>
    </Modal>
  );
}
