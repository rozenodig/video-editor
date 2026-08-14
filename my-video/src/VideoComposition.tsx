import React from "react";
import {
  staticFile,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { createTikTokStyleCaptions } from "@remotion/captions";
import type { Caption } from "@remotion/captions";
import type { VideoConfig } from "./types/VideoConfig";
import { CaptionRenderer } from "./components/CaptionRenderer";
import { ClipSequence } from "./components/ClipSequence";
import { BeatEffects } from "./components/BeatEffects";
import { VideoOverlays } from "./components/VideoOverlays";

interface VideoCompositionProps extends Record<string, unknown> {
  config: VideoConfig;
}

export const VideoComposition: React.FC<VideoCompositionProps> = ({
  config,
}) => {
  const { fps } = useVideoConfig();
  const durationInFrames = Math.round(config.output.durationInSeconds * fps);

  const isEditMode = config.mode === "edit";

  // Load captions when captionsPath is present (lyric or edit mode with lyrics)
  const [captions, setCaptions] = React.useState<Caption[]>([]);
  const hasCaptions = !!config.captionsPath && !!config.captionStyle;

  React.useEffect(() => {
    if (!config.captionsPath) return;
    fetch(staticFile(config.captionsPath))
      .then((res) => res.json())
      .then((data: Caption[]) => setCaptions(data))
      .catch(() => setCaptions([]));
  }, [config.captionsPath]);

  const pages =
    hasCaptions && config.captionStyle
      ? createTikTokStyleCaptions({
          captions,
          combineTokensWithinMilliseconds:
            config.captionStyle.combineTokensWithinMs,
        }).pages
      : [];

  const beats = config.effects.beats ?? [];
  const beatSyncEnabled = config.effects.beatSync && beats.length > 0;

  const content = (
    <div
      style={{
        width: config.output.width,
        height: config.output.height,
        position: "relative",
        overflow: "hidden",
        backgroundColor: "black",
      }}
    >
      {/* Layer 1: Video clips */}
      <ClipSequence
        clips={config.clips}
        effects={config.effects}
        durationInFrames={durationInFrames}
      />

      {/* Layer 2: Overlays — edit mode gets film grain + heavier vignette */}
      <VideoOverlays
        vignette={config.effects.vignette}
        colorGrade={config.effects.colorGrade}
        filmGrain={isEditMode}
      />

      {/* Layer 3: Captions */}
      {hasCaptions && config.captionStyle && (
        <CaptionRenderer pages={pages} style={config.captionStyle} />
      )}

      {/* Layer 4: Audio track */}
      <Audio
        src={staticFile(config.audioSrc)}
        trimBefore={Math.round((config.audioStartFrom ?? 0) * fps)}
      />
    </div>
  );

  // Beat effects wrap everything
  if (beatSyncEnabled) {
    return <BeatEffects beats={beats}>{content}</BeatEffects>;
  }

  return content;
};
