import { Text, Alert, ThemeIcon, Code, Paper } from '@mantine/core';
import { useRouter } from 'next/router';
import { EmailLogin } from '~/components/EmailLogin/EmailLogin';
// import { Logo } from '~/components/Logo/Logo';
import { BuiltInProviderType } from 'next-auth/providers';
import { SocialButton, providers } from '~/components/Social/SocialButton';
import { signIn } from 'next-auth/react';
import { IconExclamationMark, IconMail } from '@tabler/icons-react';
import { SignInError } from '~/components/SignInError/SignInError';
import { useReferralsContext } from '~/components/Referrals/ReferralsProvider';
import { trpc } from '~/utils/trpc';
import { useState } from 'react';
import { CreatorCardV2 } from '~/components/CreatorCard/CreatorCard';
import { CurrencyBadge } from '~/components/Currency/CurrencyBadge';
import { Currency } from '~/shared/utils/prisma/enums';

export function LoginContent(args: { returnUrl?: string; message?: React.ReactNode }) {
  const router = useRouter();
  const query = router.query as {
    error?: string;
    returnUrl?: string;
  };

  const [status, setStatus] = useState<'idle' | 'loading' | 'submitted'>('idle');
  const { code, setLoginRedirectReason } = useReferralsContext();
  const { data: referrer } = trpc.user.userByReferralCode.useQuery(
    { userReferralCode: code! },
    { enabled: !!code }
  );

  const returnUrl = args.returnUrl ?? query.returnUrl ?? '/';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center">
        <Logo className="max-h-10" />
      </div>
      <h1 className="text-center text-xl font-bold">Sign Up or Log In</h1>
      {args.message && (
        <Alert
          color="yellow"
          icon={
            <ThemeIcon color="yellow">
              <IconExclamationMark />
            </ThemeIcon>
          }
        >
          {args.message}
        </Alert>
      )}
      {referrer && (
        <Paper withBorder className="p-3">
          <div className="flex flex-col gap-2">
            <Text color="dimmed" size="sm">
              You have been referred by
            </Text>
            <CreatorCardV2 user={referrer} withActions={false} />
            <Text size="sm">
              By signing up with the referral code <Code>{code}</Code> both you and the user who
              referred you will be awarded{' '}
              <Text span inline>
                <CurrencyBadge currency={Currency.BUZZ} unitAmount={500} />
              </Text>
              . This code will be automatically applied during your username selection process.
            </Text>
          </div>
        </Paper>
      )}
      {status !== 'submitted' ? (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => (
            <SocialButton
              key={provider.name}
              size="md"
              provider={provider.id as BuiltInProviderType}
              onClick={() => {
                signIn(provider.id, { callbackUrl: returnUrl });
              }}
            />
          ))}
          <Text className="text-center text-sm font-semibold">Or continue with Email</Text>
          <EmailLogin returnUrl={returnUrl} size="md" status={status} onStatusChange={setStatus} />
        </div>
      ) : (
        <Alert
          icon={
            <ThemeIcon size="lg">
              <IconMail size={20} />
            </ThemeIcon>
          }
        >
          <div className="flex flex-col">
            <Text
              size="md"
              sx={{ lineHeight: 1.1 }}
            >{`Check your email for a special login link`}</Text>
            <Text size="xs" color="dimmed">
              Be sure to check your spam...
            </Text>
          </div>
        </Alert>
      )}

      {query.error && (
        <SignInError color="yellow" title="Login Error" variant="outline" error={query.error} />
      )}
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 107 22.7" className={className}>
      <g>
        <path
          className="fill-[#222] dark:fill-white"
          d="M20.8,1.7H3.7L1.5,4.1v15l2.3,2.3h17.1v-5.2H6.7V7h14.1V1.7z"
        />
        <path
          className="fill-[#222] dark:fill-white"
          d="M76.1,1.7H56.6V7h7.2v14.3H69V7h7C76,7,76.1,1.7,76.1,1.7z M23.2,1.8v19.5h5.2V1.8C28.4,1.8,23.2,1.8,23.2,1.8z M30.8,1.8
      v19.5h7.6l8.3-8.3V1.8h-5.2v8.3l-5.4,6V1.8C36.1,1.8,30.8,1.8,30.8,1.8z M49.1,1.8v19.5h5.2V1.8C54.3,1.8,49.1,1.8,49.1,1.8z"
        />
        <path
          className="fill-[#1971c2]"
          d="M100.3,1.8v19.5h5.2V1.8H100.3z M95.6,1.8H80.8l-2.3,2.3v17.2h5.2v-7.1h8.9v7.1h5.2V4.1C97.8,4.1,95.6,1.8,95.6,1.8z
      M92.7,8.9h-8.9V7h8.9V8.9z"
        />
        <path className="fill-[#1971c2]" d="M46.7,16.2v5.1h-5.1" />
      </g>
    </svg>
  );
}
