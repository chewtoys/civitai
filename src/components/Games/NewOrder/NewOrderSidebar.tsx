import { Alert, Group, Navbar, Popover, ThemeIcon } from '@mantine/core';
import {
  IconBubbleText,
  IconChevronDown,
  IconCrown,
  IconHelpSquareRounded,
  IconHistory,
  IconInfoCircle,
  IconSkull,
  IconUsers,
  IconWifiOff,
} from '@tabler/icons-react';
import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import ConfirmDialog from '~/components/Dialog/Common/ConfirmDialog';
import { dialogStore } from '~/components/Dialog/dialogStore';
import {
  openJudgmentHistoryModal,
  openPlayersDirectoryModal,
  openRatingGuideModal,
  useJoinKnightsNewOrder,
} from '~/components/Games/KnightsNewOrder.utils';
import { NewOrderRulesModal } from '~/components/Games/NewOrder/NewOrderRulesModal';
import { PlayerCard } from '~/components/Games/PlayerCard';
import { SignalStatusNotification } from '~/components/Signals/SignalsProvider';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useIsMobile } from '~/hooks/useIsMobile';
import { NewOrderRankType } from '~/shared/utils/prisma/enums';

export function NewOrderSidebar() {
  const currentUser = useCurrentUser();
  const { playerData, resetCareer, viewedRatingGuide } = useJoinKnightsNewOrder();
  const mobile = useIsMobile({ breakpoint: 'md' });

  const [state, setState] = useState({
    opened: false,
    rulesOpened: false,
  });

  const header =
    playerData && currentUser ? (
      <div className="flex flex-col">
        <SignalStatusNotification icon={<IconWifiOff size={20} stroke={2} />} radius={0}>
          {(status) => (
            <p className="leading-4">
              <span className="font-medium">
                {status === 'reconnecting' ? 'Reconnecting' : 'Disconnected'}
              </span>
              : Service disrupted
            </p>
          )}
        </SignalStatusNotification>
        <PlayerCard
          {...playerData.stats}
          user={currentUser}
          rank={playerData.rank}
          showStats={playerData.rank.type !== NewOrderRankType.Acolyte}
          className={clsx(
            'w-full rounded-b-none p-4 @md:rounded-sm',
            state.opened ? 'bg-gray-1 dark:bg-dark-5' : 'dark:bg-dark-6'
          )}
          withBorder
        />
      </div>
    ) : null;

  const content = (
    <>
      <div className="flex flex-col">
        <button
          className="w-full rounded-[4px] p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
          onClick={() => openJudgmentHistoryModal()}
        >
          <Group>
            <ThemeIcon size="xl" variant="light">
              <IconHistory />
            </ThemeIcon>
            Judgment History
          </Group>
        </button>
        {currentUser?.isModerator && (
          <button
            className="w-full rounded-[4px] p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
            onClick={() => openPlayersDirectoryModal()}
          >
            <Group>
              <ThemeIcon size="xl" variant="light" color="lime">
                <IconUsers />
              </ThemeIcon>
              Players Directory
            </Group>
          </button>
        )}
        <Link
          className="w-full cursor-pointer rounded-[4px] p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
          href="/leaderboard/knights-new-order"
        >
          <Group>
            <ThemeIcon size="xl" color="yellow" variant="light">
              <IconCrown />
            </ThemeIcon>
            View Leaderboard
          </Group>
        </Link>
        <button
          className="w-full rounded-[4px] p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
          onClick={() => {
            dialogStore.trigger({
              component: ConfirmDialog,
              props: {
                title: 'Are you sure?',
                message: 'This will restart your career and reset all your progress.',
                labels: { cancel: 'No', confirm: `Yes, I'm sure` },
                onConfirm: async () => await resetCareer(),
                confirmProps: { color: 'red' },
              },
            });
          }}
        >
          <Group>
            <ThemeIcon size="xl" color="red" variant="light">
              <IconSkull />
            </ThemeIcon>
            Restart Career
          </Group>
        </button>
        <button
          className="w-full rounded-md p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
          onClick={() => openRatingGuideModal()}
        >
          <div className="flex flex-nowrap items-center gap-4">
            <ThemeIcon size="xl" color="teal" variant="light">
              <IconHelpSquareRounded />
            </ThemeIcon>
            Guide
          </div>
        </button>
        <Link
          className="w-full cursor-pointer rounded-[4px] p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
          href="https://forms.clickup.com/8459928/f/825mr-13011/SEFW63SLT4PH1H7DQ0"
          rel="noopener noreferrer"
          target="_blank"
        >
          <Group>
            <ThemeIcon size="xl" color="gray" variant="light">
              <IconBubbleText />
            </ThemeIcon>
            Send Feedback
          </Group>
        </Link>
        <button
          className="w-full rounded-md p-3 hover:bg-gray-0 dark:hover:bg-dark-6"
          onClick={() => setState((prev) => ({ ...prev, rulesOpened: true }))}
        >
          <div className="flex flex-nowrap items-center gap-4">
            <ThemeIcon size="xl" color="gray" variant="light">
              <IconInfoCircle />
            </ThemeIcon>
            About
          </div>
        </button>
      </div>
    </>
  );

  useEffect(() => {
    if (!viewedRatingGuide) {
      openRatingGuideModal();
    }
  }, [viewedRatingGuide]);

  return (
    <>
      {mobile ? (
        <div className="flex flex-col">
          {header}
          <Popover
            position="bottom"
            transition="scale-y"
            width="calc(100% - 32px)"
            onChange={(open) => setState((prev) => ({ ...prev, opened: open }))}
            zIndex={40}
          >
            <Popover.Target>
              <button
                className={clsx(
                  'z-10 w-full justify-items-center border border-t-0 p-1 dark:border-dark-4',
                  state.opened ? 'bg-gray-1 dark:bg-dark-5' : 'bg-white dark:bg-dark-6'
                )}
              >
                <IconChevronDown
                  size={16}
                  className={clsx('transition-transform', state.opened ? 'rotate-180' : '')}
                />
              </button>
            </Popover.Target>
            <Popover.Dropdown p={0}>{content}</Popover.Dropdown>
          </Popover>
        </div>
      ) : (
        <Navbar p="md" h="100%" width={{ xs: 300, sm: 360 }} zIndex={1} withBorder>
          <Navbar.Section className="border-b border-gray-200 pb-4 dark:border-b-dark-4">
            {header}
          </Navbar.Section>
          <Navbar.Section mt="md" grow>
            {content}
          </Navbar.Section>
        </Navbar>
      )}
      <NewOrderRulesModal
        opened={state.rulesOpened}
        onClose={() => setState((prev) => ({ ...prev, rulesOpened: false }))}
        footer={
          <Alert color="blue" title="Pro Tip">
            See an image you like? Check out the Judgement History and give the creator a follow.
          </Alert>
        }
      />
    </>
  );
}
