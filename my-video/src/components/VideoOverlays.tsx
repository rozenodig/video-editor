import React from "react";
import { useCurrentFrame } from "remotion";

interface VideoOverlaysProps {
  vignette: boolean;
  colorGrade?: string;
  filmGrain?: boolean;
  letterbox?: boolean;
}

export const VideoOverlays: React.FC<VideoOverlaysProps> = ({
  vignette,
  colorGrade,
  filmGrain = false,
  letterbox = false,
}) => {
  return (
    <>
      {colorGrade && <ColorGradeOverlay grade={colorGrade} />}
      {vignette && <VignetteOverlay />}
      {filmGrain && <FilmGrainOverlay />}
      {letterbox && <LetterboxOverlay />}
    </>
  );
};

// ─── VIGNETTE ───────────────────────────────────────────────────────────

const VignetteOverlay: React.FC = () => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background:
        "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)",
      pointerEvents: "none",
      zIndex: 20,
    }}
  />
);

// ─── FILM GRAIN ─────────────────────────────────────────────────────────
// Subtle animated noise overlay using SVG filter.

const FilmGrainOverlay: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 21,
        opacity: 0.06,
        mixBlendMode: "overlay",
      }}
    >
      <svg width="100%" height="100%">
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="4"
            seed={frame}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  );
};

// ─── LETTERBOX ──────────────────────────────────────────────────────────

const LetterboxOverlay: React.FC = () => (
  <>
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "8%",
        background: "black",
        zIndex: 22,
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "8%",
        background: "black",
        zIndex: 22,
      }}
    />
  </>
);

// ─── COLOR GRADE ────────────────────────────────────────────────────────
// CSS filter combinations for different looks.

const COLOR_GRADES: Record<string, React.CSSProperties> = {
  cinematic: {
    filter: "contrast(1.1) saturate(0.85) brightness(0.95)",
  },
  warmVintage: {
    filter: "sepia(0.15) contrast(1.05) saturate(1.1) brightness(1.02)",
  },
  coldBlue: {
    filter: "saturate(0.8) brightness(1.05) hue-rotate(-10deg)",
  },
  highContrast: {
    filter: "contrast(1.3) saturate(1.2) brightness(0.9)",
  },
  moody: {
    filter: "contrast(1.15) saturate(0.7) brightness(0.85)",
  },
  vibrant: {
    filter: "contrast(1.05) saturate(1.4) brightness(1.05)",
  },
};

const ColorGradeOverlay: React.FC<{ grade: string }> = ({ grade }) => {
  const gradeStyle = COLOR_GRADES[grade];
  if (!gradeStyle) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        ...gradeStyle,
        pointerEvents: "none",
        zIndex: 19,
      }}
    />
  );
};
