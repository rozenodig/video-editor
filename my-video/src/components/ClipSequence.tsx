import React from "react";
import {
  useVideoConfig,
  useCurrentFrame,
  interpolate,
  Sequence,
  staticFile,
} from "remotion";
import { Video } from "@remotion/media";
import type { ClipConfig, EffectsConfig } from "../types/VideoConfig";

// Number of frames to hold black before revealing a new clip.
// At 30fps, 3 frames = 100ms — enough for the decoder to produce a real
// frame, and short enough to read as a punchy hard-cut in a music video.
const GREEN_MASK_FRAMES = 3;

interface ClipSequenceProps {
  clips: ClipConfig[];
  effects: EffectsConfig;
  durationInFrames: number;
}

export const ClipSequence: React.FC<ClipSequenceProps> = ({
  clips,
  effects,
  durationInFrames,
}) => {
  const { fps } = useVideoConfig();

  const sortedClips = [...clips].sort((a, b) => a.showAt - b.showAt);

  return (
    <div style={{ position: "absolute", inset: 0, backgroundColor: "black" }}>
      {sortedClips.map((clip, i) => {
        const startFrame = Math.round(clip.showAt * fps);
        const nextClip = sortedClips[i + 1];
        const endFrame = nextClip
          ? Math.round(nextClip.showAt * fps)
          : durationInFrames;
        const sequenceDuration = endFrame - startFrame;

        return (
          <Sequence
            key={`clip-${i}`}
            from={startFrame}
            durationInFrames={sequenceDuration}
            premountFor={90}
          >
            <ClipWithTransition
              clip={clip}
              transitionType={clip.transition ?? effects.transitions}
              isFirst={i === 0}
              sequenceDuration={sequenceDuration}
            />
          </Sequence>
        );
      })}
    </div>
  );
};

interface ClipWithTransitionProps {
  clip: ClipConfig;
  transitionType: EffectsConfig["transitions"];
  isFirst: boolean;
  sequenceDuration: number;
}

const ClipWithTransition: React.FC<ClipWithTransitionProps> = ({
  clip,
  transitionType,
  isFirst,
  sequenceDuration,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const src = resolveClipSrc(clip.src);
  const trimBefore = Math.round(clip.startFrom * fps);
  const trimAfter = Math.round(clip.endAt * fps);
  const playbackRate = clip.playbackRate ?? 1.0;

  // Scale/pan animation (Ken Burns effect)
  const scaleStyle = getScaleStyle(clip, frame, sequenceDuration);

  // Hard binary mask: the clip is either fully hidden (black) or fully
  // visible. No intermediate opacity => no green bleed-through, ever.
  // The first clip shows immediately; every subsequent clip holds black
  // for GREEN_MASK_FRAMES so the decoder has real pixel data ready.
  const isRevealed = isFirst || frame >= GREEN_MASK_FRAMES;

  // Visual transition effect (zoom/glitch/flash) — only the transform/filter
  // part, NOT opacity. Opacity is handled exclusively by isRevealed above.
  const transitionFrames = getTransitionFrames(transitionType);
  const isInTransition = !isFirst && frame < transitionFrames;
  const transitionStyle = isInTransition
    ? getTransitionEffect(transitionType, frame, transitionFrames)
    : {};

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "black",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          // Hard step: 0 or 1, nothing in between
          visibility: isRevealed ? "visible" : "hidden",
          ...transitionStyle,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            ...scaleStyle,
          }}
        >
          <Video
            src={src}
            trimBefore={trimBefore}
            trimAfter={trimAfter}
            playbackRate={playbackRate}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      </div>
    </div>
  );
};

function getScaleStyle(
  clip: ClipConfig,
  frame: number,
  sequenceDuration: number,
): React.CSSProperties {
  const baseScale = clip.scale ?? 1.0;

  if (baseScale <= 1.0) return {};

  const anchor = clip.scaleAnchor ?? { x: 0.5, y: 0.5 };

  const progress = Math.min(frame / Math.max(sequenceDuration, 1), 1);
  const animatedScale = interpolate(progress, [0, 1], [baseScale, baseScale + 0.05]);

  const originX = anchor.x * 100;
  const originY = anchor.y * 100;

  return {
    transform: `scale(${animatedScale})`,
    transformOrigin: `${originX}% ${originY}%`,
  };
}

function resolveClipSrc(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  return staticFile(src);
}

function getTransitionFrames(type: EffectsConfig["transitions"]): number {
  switch (type) {
    case "cut":
      return 0;
    case "zoom":
      return 3;
    case "glitch":
      return 4;
    case "flash":
      return 3;
  }
}

// Returns only transform/filter effects — NO opacity.
// Opacity is handled by the visibility mask to prevent green bleed.
function getTransitionEffect(
  type: EffectsConfig["transitions"],
  frame: number,
  totalFrames: number,
): React.CSSProperties {
  const progress = frame / totalFrames;

  switch (type) {
    case "cut":
      return {};

    case "zoom":
      return {
        transform: `scale(${interpolate(progress, [0, 1], [1.05, 1])})`,
      };

    case "glitch":
      return {
        filter: `hue-rotate(${interpolate(progress, [0, 1], [90, 0])}deg)`,
        transform: `translateX(${interpolate(progress, [0, 0.5, 1], [8, -4, 0])}px)`,
      };

    case "flash":
      return {
        filter: `brightness(${interpolate(progress, [0, 1], [3, 1])})`,
      };
  }
}
