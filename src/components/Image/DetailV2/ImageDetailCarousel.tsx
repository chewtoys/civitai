import { useHotkeys, useLocalStorage, useOs } from '@mantine/hooks';
import { useState, useEffect, createContext, useContext } from 'react';
import { EdgeMedia } from '~/components/EdgeMedia/EdgeMedia';
import { shouldDisplayHtmlControls } from '~/components/EdgeMedia/EdgeMedia.util';
import type { ConnectProps } from '~/components/ImageGuard/ImageGuard2';
import { ImageGuardContent } from '~/components/ImageGuard/ImageGuard2';
import { MediaHash } from '~/components/ImageHash/ImageHash';
import { useAspectRatioFit } from '~/hooks/useAspectRatioFit';
import { useResizeObserver } from '~/hooks/useResizeObserver';
import useIsClient from '~/hooks/useIsClient';
import type { EdgeVideoRef } from '~/components/EdgeMedia/EdgeVideo';
import { useCarouselNavigation } from '~/hooks/useCarouselNavigation';
import { UnstyledButton } from '@mantine/core';
import type { MediaType } from '~/shared/utils/prisma/enums';
import type { ImageMetadata, VideoMetadata } from '~/server/schema/media.schema';
import type { EmblaCarouselType } from 'embla-carousel';
import { Embla } from '~/components/EmblaCarousel/EmblaCarousel';

type ImageDetailCarouselProps = {
  videoRef?: React.ForwardedRef<EdgeVideoRef>;
  connect?: ConnectProps;
};
type ImageProps = {
  id: number;
  nsfwLevel: number;
  url: string;
  height: number | null;
  width: number | null;
  type: MediaType;
  name: string | null;
  metadata?: MixedObject | ImageMetadata | VideoMetadata | null;
};

type Props<T> = Parameters<typeof useCarouselNavigation<T>>[0];
type State = ReturnType<typeof useCarouselNavigation<ImageProps>>;
const ImageDetailCarouselContext = createContext<State | null>(null);

function useImageDetailCarouselContext() {
  const context = useContext(ImageDetailCarouselContext);
  if (!context) throw new Error('missing ImageDetailCarouselContext in tree');
  return context;
}

export function ImageDetailCarouselProvider<T extends ImageProps>({
  children,
  ...args
}: Props<T> & { children: React.ReactNode }) {
  const state = useCarouselNavigation(args);

  return (
    <ImageDetailCarouselContext.Provider value={state}>
      {children}
    </ImageDetailCarouselContext.Provider>
  );
}

export function ImageDetailCarousel({
  images,
  videoRef,
  connect,
  index,
  canNavigate,
  navigate,
}: ImageDetailCarouselProps & {
  images: ImageProps[];
  index: number;
  navigate?: (index: number) => void;
  canNavigate: boolean;
}) {
  const [embla, setEmbla] = useState<EmblaCarouselType | null>(null);

  // const [slidesInView, setSlidesInView] = useState<number[]>([index]);

  // useEffect(() => {
  //   if (!embla) return;
  //   const onSelect = () => {
  //     setSlidesInView([...embla.slidesInView(true)]);
  //   };

  //   embla.on('select', onSelect);
  //   return () => {
  //     embla.off('select', onSelect);
  //   };
  // }, [embla]);

  useHotkeys([
    ['ArrowLeft', () => embla?.scrollPrev()],
    ['ArrowRight', () => embla?.scrollNext()],
  ]);

  const ref = useResizeObserver<HTMLDivElement>(() => {
    embla?.reInit();
  });

  const os = useOs();
  const isDesktop = os === 'windows' || os === 'linux' || os === 'macos';

  // useEffect(() => {
  //   if (!slidesInView.includes(index)) {
  //     embla?.scrollTo(index, true);
  //   }
  // }, [index, slidesInView]); // eslint-disable-line

  if (!images.length) return null;

  return (
    <div ref={ref} className="flex min-h-0 flex-1 items-stretch justify-stretch">
      <Embla
        key={images.length}
        withControls={canNavigate}
        className="flex-1"
        onSlideChange={navigate}
        setEmbla={setEmbla}
        startIndex={index}
        loop
        watchDrag={!isDesktop && canNavigate}
        withKeyboardEvents={false}
      >
        <Embla.Viewport className="h-full">
          <Embla.Container className="flex h-full">
            {images.map((image, i) => (
              <Embla.Slide key={image.id} index={i} className="flex-[0_0_100%]">
                {index === i && <ImageContent image={image} {...connect} videoRef={videoRef} />}
              </Embla.Slide>
            ))}
          </Embla.Container>
        </Embla.Viewport>
      </Embla>
    </div>
  );
}

function ImageContent({
  image,
  videoRef,
  ...connect
}: { image: ImageProps } & ConnectProps & ImageDetailCarouselProps) {
  const [defaultMuted, setDefaultMuted] = useLocalStorage({
    getInitialValueInEffect: false,
    key: 'detailView_defaultMuted',
    defaultValue: true,
  });

  const imageHeight = image?.height ?? 1200;
  const imageWidth = image?.width ?? 1200;

  const { setRef, height, width } = useAspectRatioFit({
    height: imageHeight,
    width: imageWidth,
  });

  const isVideo = image?.type === 'video';

  return (
    <ImageGuardContent image={image} {...connect}>
      {(safe) => (
        <div ref={setRef} className="relative flex size-full items-center justify-center">
          {!safe && width && height ? (
            <div
              className="relative flex max-h-full max-w-full flex-1"
              style={{
                maxHeight: height > 0 ? height : undefined,
                maxWidth: width > 0 ? width : undefined,
                aspectRatio: width > 0 ? `${width}/${height}` : undefined,
              }}
            >
              <MediaHash {...image} />
            </div>
          ) : (
            <EdgeMedia
              src={image.url}
              name={image.name ?? image.id.toString()}
              alt={image.name ?? undefined}
              type={image.type}
              className={`max-h-full w-auto max-w-full ${!safe ? 'invisible' : ''}`}
              wrapperProps={{
                className: `flex items-center justify-center max-h-full w-auto max-w-full ${
                  !safe ? 'invisible' : ''
                }`,
                style: {
                  aspectRatio: (image?.width ?? 0) / (image?.height ?? 0),
                },
              }}
              // width={!isVideo ? undefined : 450} // Leave as undefined to get original size
              anim
              quality={90}
              original={isVideo ? true : undefined}
              html5Controls={shouldDisplayHtmlControls(image)}
              muted={defaultMuted}
              onMutedChange={(isMuted) => {
                setDefaultMuted(isMuted);
              }}
              videoRef={videoRef}
              youtubeVideoId={
                image.type === 'video' && image.metadata
                  ? (image.metadata as VideoMetadata)?.youtubeVideoId
                  : undefined
              }
              vimeoVideoId={
                image.type === 'video' && image.metadata
                  ? (image.metadata as VideoMetadata)?.vimeoVideoId
                  : undefined
              }
              controls
              videoProps={{
                autoPlay: true,
              }}
            />
          )}
        </div>
      )}
    </ImageGuardContent>
  );
}

export function ImageDetailCarouselIndicators() {
  const { indicators, index, navigate } = useImageDetailCarouselContext();

  if (!indicators) return null;

  return (
    <div className="flex justify-center gap-1">
      {new Array(indicators).map((_, i) => (
        <UnstyledButton
          key={i}
          data-active={i === index || undefined}
          aria-hidden
          tabIndex={-1}
          onClick={() => navigate(i)}
          className={`h-1 max-w-6 flex-1 rounded border border-solid border-gray-4 bg-white shadow-2xl
    ${i !== index ? 'dark:opacity-50' : 'bg-blue-6 dark:bg-white'}`}
        />
      ))}
    </div>
  );
}
