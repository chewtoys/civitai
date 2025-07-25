import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { GetGenerationDataInput } from '~/server/schema/generation.schema';
import type {
  GenerationData,
  GenerationResource,
  RemixOfProps,
} from '~/server/services/generation/generation.service';
import { getSourceImageFromUrl } from '~/shared/constants/generation.constants';
import type { MediaType } from '~/shared/utils/prisma/enums';
import { QS } from '~/utils/qs';
import { isMobileDevice } from '~/hooks/useIsMobile';

export type RunType = 'run' | 'remix' | 'replay';
export type GenerationPanelView = 'queue' | 'generate' | 'feed';
type GenerationState = {
  counter: number;
  loading: boolean;
  opened: boolean;
  view: GenerationPanelView;
  type: MediaType;
  remixOf?: RemixOfProps;
  data?: GenerationData & { runType: RunType };
  // input?: GetGenerationDataInput;
  // used to populate form with model/image generation data
  open: (input?: GetGenerationDataInput) => Promise<void>;
  close: () => void;
  setView: (view: GenerationPanelView) => void;
  setType: (type: MediaType) => void;
  setData: (
    args: GenerationData & {
      type: MediaType;
      workflow?: string;
      engine?: string;
    }
  ) => void;
  clearData: () => void;
};

export const useGenerationStore = create<GenerationState>()(
  devtools(
    immer((set) => ({
      counter: 0,
      loading: false,
      opened: false,
      view: 'generate',
      type: 'image',
      open: async (input) => {
        set((state) => {
          state.opened = true;
          if (input) {
            state.view = 'generate';
            state.loading = true;
          }
        });

        if (input) {
          const isMedia = ['audio', 'image', 'video'].includes(input.type);
          // if (isMedia) {
          //   generationFormStore.setType(input.type as MediaType);
          // }
          try {
            const result = await fetchGenerationData(input);
            const { remixOf, ...data } = result;
            const { params } = await transformParams(data.params, remixOf);
            if (params.engine) {
              useGenerationFormStore.setState({ engine: params.engine, type: data.type });
            } else if (data.type) {
              useGenerationFormStore.setState({ type: data.type });
            }

            if (isMedia) {
              useRemixStore.setState({
                ...result,
                params,
                resources: withSubstitute(result.resources),
              });
            }

            set((state) => {
              state.data = {
                ...data,
                params,
                resources: withSubstitute(data.resources),
                runType: input.type === 'image' ? 'remix' : 'run',
              };
              state.loading = false;
              state.counter++;
            });
          } catch (e) {
            set((state) => {
              state.loading = false;
            });
            throw e;
          }
        }
      },
      close: () =>
        set((state) => {
          state.opened = false;
        }),
      setView: (view) =>
        set((state) => {
          state.view = view;
        }),
      setType: (type) => {
        set((state) => {
          state.type = type;
        });
      },
      setData: async ({ type, remixOf, workflow, engine, ...data }) => {
        // TODO.Briant - cleanup at a later point in time
        useGenerationFormStore.setState({ type, workflow });
        // if (sourceImage) generationFormStore.setsourceImage(sourceImage);
        if (engine) useGenerationFormStore.setState({ engine });
        const { params } = await transformParams(data.params);
        if (type === 'video' && !params.process) {
          params.process = params.sourceImage ? 'img2vid' : 'txt2vid';
        } else if (type === 'image') {
          params.process = params.sourceImage ? 'img2img' : 'txt2img';
        }

        set((state) => {
          if (isMobileDevice()) {
            state.view = 'generate';
          }

          state.remixOf = remixOf;
          state.data = {
            ...data,
            type,
            params,
            resources: withSubstitute(data.resources),
            runType: 'replay',
          };
          state.counter++;
          if (!location.pathname.includes('generate')) state.view = 'generate';
        });
      },
      clearData: () =>
        set((state) => {
          state.data = undefined;
        }),
    })),
    { name: 'generation-store' }
  )
);

const store = useGenerationStore.getState();
export const generationPanel = {
  open: store.open,
  close: store.close,
  setView: store.setView,
};

export const generationStore = {
  setType: store.setType,
  setData: store.setData,
  clearData: store.clearData,
  // getSupplementaryFormData() {
  //   const { remixOf, type } = useGenerationStore.getState();
  //   return { remixOf, type };
  // },
};

function withSubstitute(resources: GenerationResource[]) {
  return resources.map((item) => {
    const { substitute, ...rest } = item;
    if (!rest.canGenerate && substitute?.canGenerate) return { ...item, ...substitute };
    return rest;
  });
}

// const stripWeightDate = new Date('03-14-2025');
async function transformParams(
  data: Record<string, any>,
  remixOf?: RemixOfProps
): Promise<{ params: Record<string, any> }> {
  let sourceImage = data.sourceImage;
  if (!sourceImage) {
    if ('image' in data && typeof data.image === 'string')
      sourceImage = await getSourceImageFromUrl({ url: data.image });
  } else if ('sourceImage' in data && typeof data.sourceImage === 'string')
    sourceImage = await getSourceImageFromUrl({ url: data.sourceImage });

  const params: Record<string, any> = { ...data, sourceImage };

  // if (remixOf && new Date(remixOf.createdAt) < stripWeightDate) {
  //   if (data.prompt) params.prompt = data.prompt.replace(/\(*([^():,]+)(?::[0-9.]+)?\)*/g, `$1`);
  //   if (data.negativePrompt)
  //     params.negativePrompt = data.negativePrompt.replace(/\(*([^():,]+)(?::[0-9.]+)?\)*/g, `$1`);
  // }

  return {
    params,
  };
}

const dictionary: Record<string, GenerationData> = {};
export const fetchGenerationData = async (input: GetGenerationDataInput) => {
  let key = 'default';
  switch (input.type) {
    case 'modelVersions':
      key = `${input.type}_${Array.isArray(input.ids) ? input.ids.join('_') : input.ids}`;
      break;
    case 'modelVersion':
      key = `${input.type}_${input.id}${input.epoch ? `_${input.epoch}` : ''}`;
      break;
    default:
      key = `${input.type}_${input.id}`;
      break;
  }

  if (dictionary[key]) return dictionary[key];
  else {
    const response = await fetch(`/api/generation/data?${QS.stringify(input)}`);
    if (!response.ok) throw new Error(response.statusText);
    const data: GenerationData = await response.json();
    dictionary[key] = data;
    return data;
  }
};

export const useGenerationFormStore = create<{
  type: MediaType;
  engine?: string;
  workflow?: string; // is this needed?
  // originalPrompt?: string;
}>()(
  persist((set) => ({ type: 'image' }), {
    name: 'generation-form',
    version: 1.2,
  })
);

export const generationFormStore = {
  setType: (type: MediaType) => useGenerationFormStore.setState({ type }),
  setEngine: (engine: string) => useGenerationFormStore.setState({ engine }),
  // setsourceImage: async (sourceImage?: SourceImageProps | string | null) => {
  //   useGenerationFormStore.setState({
  //     sourceImage:
  //       typeof sourceImage === 'string'
  //         ? await getSourceImageFromUrl({ url: sourceImage })
  //         : sourceImage,
  //   });
  // },
  reset: () => useGenerationFormStore.setState((state) => ({ type: state.type }), true),
};

export const useRemixStore = create<{
  resources?: GenerationResource[];
  params?: Record<string, unknown>;
  remixOf?: RemixOfProps;
  remixOfId?: number;
}>()(persist(() => ({}), { name: 'remixOf' }));
