import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import type { BeatTimestamp } from "../types/VideoConfig";

interface BeatEffectsProps {
  beats: BeatTimestamp[];
  children: React.ReactNode;
}

export const BeatEffects: React.FC<BeatEffectsProps> = ({
  beats,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTimeSec = frame / fps;

  // Find the closest active beat (within 0.3s window)
  const activeBeat = beats.find((beat) => {
    const diff = currentTimeSec - beat.timeInSeconds;
    return diff >= 0 && diff < 0.3;
  });

  if (!activeBeat) {
    return <div style={{ position: "absolute", inset: 0 }}>{children}</div>;
  }

  const beatFrame = Math.round(activeBeat.timeInSeconds * fps);
  const frameSinceBeat = frame - beatFrame;
  const intensity = activeBeat.intensity ?? 1;

  const effectStyle = getBeatEffectStyle(
    activeBeat.effect,
    frameSinceBeat,
    fps,
    intensity,
  );

  return (
    <div style={{ position: "absolute", inset: 0, ...effectStyle }}>
      {children}
    </div>
  );
};

function getBeatEffectStyle(
  effect: BeatTimestamp["effect"],
  frameSinceBeat: number,
  fps: number,
  intensity: number,
): React.CSSProperties {
  const decay = spring({
    frame: frameSinceBeat,
    fps,
    config: { damping: 15, mass: 0.3, stiffness: 300 },
    durationInFrames: 10,
  });

  switch (effect) {
    case "shake": {
      const shakeAmount = (1 - decay) * 12 * intensity;
      const shakeX = Math.sin(frameSinceBeat * 5) * shakeAmount;
      const shakeY = Math.cos(frameSinceBeat * 7) * shakeAmount;
      return {
        transform: `translate(${shakeX}px, ${shakeY}px)`,
      };
    }

    case "pulse": {
      const pulseScale = interpolate(
        decay,
        [0, 1],
        [1 + 0.08 * intensity, 1],
      );
      return {
        transform: `scale(${pulseScale})`,
      };
    }

    case "flash": {
      const brightness = interpolate(decay, [0, 1], [1 + 1.5 * intensity, 1]);
      return {
        filter: `brightness(${brightness})`,
      };
    }
  }
}
