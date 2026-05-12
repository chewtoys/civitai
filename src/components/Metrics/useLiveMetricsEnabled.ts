import { useFeatureFlags } from '~/providers/FeatureFlagsProvider';

/**
 * Hook to check if live metrics feature is enabled via feature flags (Flipt-backed).
 */
export function useLiveMetricsEnabled() {
  const features = useFeatureFlags();
  return features.liveMetrics;
}
