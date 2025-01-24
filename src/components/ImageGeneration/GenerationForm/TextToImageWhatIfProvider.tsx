import { useDebouncedValue } from '@mantine/hooks';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useGenerationForm } from '~/components/ImageGeneration/GenerationForm/GenerationFormProvider';
import { generationConfig } from '~/server/common/constants';
import { TextToImageInput } from '~/server/schema/orchestrator/textToImage.schema';
import {
  getBaseModelSetType,
  getIsFlux,
  getIsSD3,
  getSizeFromAspectRatio,
  whatIfQueryOverrides,
} from '~/shared/constants/generation.constants';
import { trpc } from '~/utils/trpc';

import { UseTRPCQueryResult } from '@trpc/react-query/shared';
import { GenerationWhatIfResponse } from '~/server/services/orchestrator/types';
import { parseAIR } from '~/utils/string-helpers';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { isDefined } from '~/utils/type-guards';
import { useTipStore } from '~/store/tip.store';
// import { useFeatureFlags } from '~/providers/FeatureFlagsProvider';

const Context = createContext<UseTRPCQueryResult<
  GenerationWhatIfResponse | undefined,
  unknown
> | null>(null);

export function useTextToImageWhatIfContext() {
  const context = useContext(Context);
  if (!context) throw new Error('no TextToImageWhatIfProvider in tree');
  return context;
}

export function TextToImageWhatIfProvider({ children }: { children: React.ReactNode }) {
  const form = useGenerationForm();
  const currentUser = useCurrentUser();
  const watched = useWatch({ control: form.control });
  const [enabled, setEnabled] = useState(false);
  const defaultModel =
    generationConfig[getBaseModelSetType(watched.baseModel) as keyof typeof generationConfig]
      ?.checkpoint ?? watched.model;

  // const features = useFeatureFlags();
  const storeTips = useTipStore();

  const query = useMemo(() => {
    const { model, resources = [], vae, ...params } = watched;
    if (params.aspectRatio) {
      const size = getSizeFromAspectRatio(Number(params.aspectRatio), params.baseModel);
      params.width = size.width;
      params.height = size.height;
    }

    let modelId = defaultModel.id;
    const isFlux = getIsFlux(watched.baseModel);
    if (isFlux && watched.fluxMode) {
      const { version } = parseAIR(watched.fluxMode);
      modelId = version;
    }

    const isSD3 = getIsSD3(watched.baseModel);
    if (isSD3 && model?.id) {
      modelId = model.id;
    }
    const additionalResources = [...resources, vae]
      .map((x) => (x ? x.id : undefined))
      .filter(isDefined);

    // const tips = getTextToImageTips({
    //   ...storeTips,
    //   creatorComp: features.creatorComp,
    //   baseModel: params.baseModel,
    //   additionalNetworksCount: resources.length,
    // });

    return {
      resources: [modelId, ...additionalResources],
      params: {
        ...params,
        ...whatIfQueryOverrides,
      } as TextToImageInput,
    };
  }, [watched, defaultModel.id, storeTips]);

  useEffect(() => {
    // enable after timeout to prevent multiple requests as form data is set
    setTimeout(() => setEnabled(true), 150);
  }, []);

  const [debounced] = useDebouncedValue(query, 100);

  const result = trpc.orchestrator.getImageWhatIf.useQuery(debounced, {
    enabled: !!currentUser && debounced && enabled,
  });

  return <Context.Provider value={result}>{children}</Context.Provider>;
}

export function getTextToImageTips({
  civitaiTip,
  creatorTip,
  creatorComp,
  baseModel,
  additionalNetworksCount,
}: {
  civitaiTip: number;
  creatorTip: number;
  creatorComp: boolean;
  baseModel?: string;
  additionalNetworksCount: number;
}) {
  if (!creatorComp)
    return {
      creators: 0,
      civitai: 0,
    };
  const isFlux = getIsFlux(baseModel);
  const isSD3 = getIsSD3(baseModel);
  const hasCreatorTip = (!isFlux && !isSD3) || additionalNetworksCount > 0;
  return {
    creators: hasCreatorTip ? creatorTip : 0,
    civitai: civitaiTip,
  };
}
