import { useFeatureFlags } from '~/providers/FeatureFlagsProvider';
import type { ColorDomain } from '~/shared/constants/domain.constants';

export function useDomainColor() {
  const features = useFeatureFlags();
  // Fallback to green for being the safest of the bunch.
  const color: ColorDomain = features.isGreen
    ? 'green'
    : features.isBlue
    ? 'blue'
    : features.isRed
    ? 'red'
    : 'blue';
  return color;
}
