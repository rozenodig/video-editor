import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { TikTokPage, TikTokToken } from "@remotion/captions";
import type { CaptionStyleConfig } from "../types/VideoConfig";

interface CaptionRendererProps {
  pages: TikTokPage[];
  style: CaptionStyleConfig;
}

export const CaptionRenderer: React.FC<CaptionRendererProps> = ({
  pages,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTimeMs = (frame / fps) * 1000;

  const activePage = pages.find(
    (page) =>
      currentTimeMs >= page.startMs &&
      currentTimeMs < page.startMs + page.durationMs,
  );

  if (!activePage) return null;

  // VFX preset gets its own full-screen renderer
  if (style.preset === "vfx") {
    return (
      <VfxCaptionRenderer
        page={activePage}
        currentTimeMs={currentTimeMs}
        style={style}
        frame={frame}
        fps={fps}
      />
    );
  }

  const positionStyle = getPositionStyle(style.position);

  return (
    <div
      style={{
        position: "absolute",
        ...positionStyle,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "0 40px",
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "8px 12px",
          maxWidth: "90%",
        }}
      >
        {activePage.tokens.map((token, i) => (
          <AnimatedWord
            key={`${activePage.startMs}-${i}`}
            token={token}
            currentTimeMs={currentTimeMs}
            style={style}
            frame={frame}
            fps={fps}
            tokenIndex={i}
            pageStartMs={activePage.startMs}
          />
        ))}
      </div>
    </div>
  );
};

// ─── VFX CAPTION RENDERER ──────────────────────────────────────────────
// Full-screen takeover: each word gets its own position, size, rotation,
// and VFX treatment. Designed for high-energy music video edits.

interface VfxRendererProps {
  page: TikTokPage;
  currentTimeMs: number;
  style: CaptionStyleConfig;
  frame: number;
  fps: number;
}

const VfxCaptionRenderer: React.FC<VfxRendererProps> = ({
  page,
  currentTimeMs,
  style,
  frame,
  fps,
}) => {
  // Find the currently active token
  const activeIdx = page.tokens.findIndex(
    (t) => currentTimeMs >= t.fromMs && currentTimeMs < t.toMs,
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {page.tokens.map((token, i) => {
        const isActive = i === activeIdx;
        const isPast = currentTimeMs >= token.toMs;
        const isFuture = currentTimeMs < token.fromMs;

        if (isFuture) return null;

        const activationFrame = Math.round((token.fromMs / 1000) * fps);
        const frameSinceActive = frame - activationFrame;
        const tokenDurationFrames = Math.round(
          ((token.toMs - token.fromMs) / 1000) * fps,
        );

        return (
          <VfxWord
            key={`vfx-${page.startMs}-${i}`}
            token={token}
            isActive={isActive}
            isPast={isPast}
            frameSinceActive={frameSinceActive}
            tokenDurationFrames={tokenDurationFrames}
            frame={frame}
            fps={fps}
            style={style}
            tokenIndex={i}
            totalTokens={page.tokens.length}
          />
        );
      })}
    </div>
  );
};

interface VfxWordProps {
  token: TikTokToken;
  isActive: boolean;
  isPast: boolean;
  frameSinceActive: number;
  tokenDurationFrames: number;
  frame: number;
  fps: number;
  style: CaptionStyleConfig;
  tokenIndex: number;
  totalTokens: number;
}

const VfxWord: React.FC<VfxWordProps> = ({
  token,
  isActive,
  isPast,
  frameSinceActive,
  tokenDurationFrames,
  frame,
  fps,
  style,
  tokenIndex,
}) => {
  const text = token.text.trim();
  if (!text) return null;

  // ── Entry animation ─────────────────────────────────────────────
  const entrySpring =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 8, mass: 0.3, stiffness: 280 },
          durationInFrames: 10,
        })
      : 0;

  // ── Exit: fast fade when no longer active ───────────────────────
  const exitFrame = frameSinceActive - tokenDurationFrames;
  const exitOpacity = isPast
    ? interpolate(exitFrame, [0, 6], [1, 0], { extrapolateRight: "clamp" })
    : 1;

  if (isPast && exitOpacity <= 0) return null;

  // ── Positioning: deterministic pseudo-random per token ──────────
  const seed = tokenIndex * 7919;
  const posPattern = seed % 5;

  // 5 position zones across the screen (vertical variety)
  const positions = [
    { top: "35%", left: "50%" },  // upper center
    { top: "50%", left: "50%" },  // dead center
    { top: "60%", left: "50%" },  // lower center
    { top: "42%", left: "45%" },  // slightly left
    { top: "55%", left: "55%" },  // slightly right
  ];
  const pos = positions[posPattern];

  // ── Entry direction ─────────────────────────────────────────────
  const entryPattern = seed % 6;
  const entryDirections = [
    { x: 0, y: 80 },     // from below
    { x: 0, y: -80 },    // from above
    { x: -120, y: 0 },   // from left
    { x: 120, y: 0 },    // from right
    { x: 0, y: 0 },      // scale in (no translate)
    { x: 0, y: 40 },     // subtle up
  ];
  const entryDir = entryDirections[entryPattern];

  const translateX = interpolate(entrySpring, [0, 1], [entryDir.x, 0]);
  const translateY = interpolate(entrySpring, [0, 1], [entryDir.y, 0]);

  // ── Scale: punch in on entry, then settle ───────────────────────
  const entryScale = interpolate(entrySpring, [0, 1], [1.8, 1]);
  const activeScale = isActive ? 1 : 0.85;

  // ── Rotation: slight tilt based on token ────────────────────────
  const baseRotation = ((seed % 7) - 3) * 1.5; // -4.5 to +4.5 degrees
  const rotation = interpolate(entrySpring, [0, 1], [baseRotation * 3, baseRotation]);

  // ── Impact shake on entry (first 4 frames) ─────────────────────
  const isImpacting = isActive && frameSinceActive >= 0 && frameSinceActive < 4;
  const shakeX = isImpacting ? Math.sin(frameSinceActive * 9) * (4 - frameSinceActive) : 0;
  const shakeY = isImpacting ? Math.cos(frameSinceActive * 7) * (3 - frameSinceActive * 0.5) : 0;

  // ── Chromatic aberration on entry ───────────────────────────────
  const chromaIntensity =
    isActive && frameSinceActive >= 0 && frameSinceActive < 6
      ? interpolate(frameSinceActive, [0, 6], [4, 0], { extrapolateRight: "clamp" })
      : 0;

  // ── Font size: active word is BIG ───────────────────────────────
  const fontSize = isActive ? style.fontSize : style.fontSize * 0.7;

  // ── Dynamic glow on active word ─────────────────────────────────
  const glowColor = style.glowColor ?? "#FF0055";
  const glowPulse = isActive
    ? 0.7 + 0.3 * Math.sin((frame / fps) * Math.PI * 6)
    : 0;

  const textShadow = isActive
    ? [
        `0 0 ${20 * glowPulse}px ${glowColor}`,
        `0 0 ${40 * glowPulse}px ${glowColor}80`,
        `0 0 ${80 * glowPulse}px ${glowColor}40`,
        "0 4px 20px rgba(0,0,0,0.9)",
        "0 2px 6px rgba(0,0,0,0.8)",
      ].join(", ")
    : [
        "0 4px 20px rgba(0,0,0,0.9)",
        "0 2px 6px rgba(0,0,0,0.8)",
        "0 0 30px rgba(0,0,0,0.5)",
      ].join(", ");

  const color = isActive ? style.activeColor : style.inactiveColor;
  const opacity = interpolate(entrySpring, [0, 1], [0, 1]) * exitOpacity;

  // ── Chromatic aberration layers ─────────────────────────────────
  const chromaOffset = Math.round(chromaIntensity);

  return (
    <div
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        transform: [
          `translate(-50%, -50%)`,
          `translate(${translateX + shakeX}px, ${translateY + shakeY}px)`,
          `scale(${entryScale * activeScale})`,
          `rotate(${rotation}deg)`,
        ].join(" "),
        opacity,
        zIndex: isActive ? 20 : 10,
      }}
    >
      {/* Chromatic aberration - red channel */}
      {chromaOffset > 0 && (
        <span
          style={{
            position: "absolute",
            left: -chromaOffset * 2,
            top: -chromaOffset,
            fontSize,
            fontFamily: style.fontFamily,
            fontWeight: 900,
            color: "rgba(255,0,50,0.5)",
            whiteSpace: "nowrap",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            mixBlendMode: "screen",
          }}
        >
          {text}
        </span>
      )}

      {/* Chromatic aberration - cyan channel */}
      {chromaOffset > 0 && (
        <span
          style={{
            position: "absolute",
            left: chromaOffset * 2,
            top: chromaOffset,
            fontSize,
            fontFamily: style.fontFamily,
            fontWeight: 900,
            color: "rgba(0,200,255,0.5)",
            whiteSpace: "nowrap",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            mixBlendMode: "screen",
          }}
        >
          {text}
        </span>
      )}

      {/* Main text */}
      <span
        style={{
          position: "relative",
          fontSize,
          fontFamily: style.fontFamily,
          fontWeight: 900,
          color,
          whiteSpace: "nowrap",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          textShadow,
          WebkitTextStroke: isActive ? "1.5px rgba(0,0,0,0.3)" : "1px rgba(0,0,0,0.2)",
        }}
      >
        {text}
      </span>
    </div>
  );
};

// ─── STANDARD PRESET HELPERS ──────────────────────────────────────────

function getPositionStyle(
  position: "bottom" | "center" | "top",
): React.CSSProperties {
  switch (position) {
    case "top":
      return { top: 180 };
    case "center":
      return { top: "50%", transform: "translateY(-50%)" };
    case "bottom":
      return { bottom: 200 };
  }
}

interface AnimatedWordProps {
  token: TikTokToken;
  currentTimeMs: number;
  style: CaptionStyleConfig;
  frame: number;
  fps: number;
  tokenIndex: number;
  pageStartMs: number;
}

const AnimatedWord: React.FC<AnimatedWordProps> = ({
  token,
  currentTimeMs,
  style,
  frame,
  fps,
  tokenIndex,
}) => {
  const isActive = currentTimeMs >= token.fromMs && currentTimeMs < token.toMs;
  const hasBeenActive = currentTimeMs >= token.fromMs;

  const activationFrame = Math.round((token.fromMs / 1000) * fps);
  const frameSinceActive = frame - activationFrame;

  switch (style.preset) {
    case "bounce":
      return (
        <BounceWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
        />
      );
    case "glow":
      return (
        <GlowWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          frame={frame}
          fps={fps}
          style={style}
        />
      );
    case "slide":
      return (
        <SlideWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
          tokenIndex={tokenIndex}
        />
      );
    case "typewriter":
      return (
        <TypewriterWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
        />
      );
    case "explosion":
      return (
        <ExplosionWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
        />
      );
    case "neon":
      return (
        <NeonWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          frame={frame}
          fps={fps}
          style={style}
        />
      );
    case "3d":
      return (
        <ThreeDWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
        />
      );
    case "glitch":
      return (
        <GlitchWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          frame={frame}
          fps={fps}
          style={style}
        />
      );
    case "kinetic":
      return (
        <KineticWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
          tokenIndex={tokenIndex}
        />
      );
    case "wave":
      return (
        <WaveWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          frame={frame}
          fps={fps}
          style={style}
        />
      );
    case "highlight":
      return (
        <HighlightWord
          token={token}
          isActive={isActive}
          hasBeenActive={hasBeenActive}
          frameSinceActive={frameSinceActive}
          fps={fps}
          style={style}
        />
      );
    default:
      return null;
  }
};

// ─── BOUNCE PRESET ──────────────────────────────────────────────────────

interface WordPresetProps {
  token: TikTokToken;
  isActive: boolean;
  hasBeenActive: boolean;
  frameSinceActive: number;
  fps: number;
  style: CaptionStyleConfig;
}

const BounceWord: React.FC<WordPresetProps> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
}) => {
  const scale =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 10, mass: 0.5, stiffness: 200 },
          durationInFrames: 15,
        })
      : 0;

  const wordScale = hasBeenActive ? interpolate(scale, [0, 1], [0.85, 1]) : 1;
  const color = isActive ? style.activeColor : style.inactiveColor;

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `scale(${wordScale})`,
        display: "inline-block",
        textShadow: "0 4px 12px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.5)",
        WebkitTextStroke: isActive ? "1px rgba(0,0,0,0.3)" : "none",
        transition: "color 0.05s",
      }}
    >
      {token.text}
    </span>
  );
};

// ─── GLOW PRESET ────────────────────────────────────────────────────────

const GlowWord: React.FC<WordPresetProps & { frame: number }> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  frame,
  fps,
  style,
}) => {
  const glowColor = style.glowColor ?? "#00FF88";

  const glowPulse = isActive
    ? interpolate(Math.sin((frame / fps) * Math.PI * 4), [-1, 1], [0.6, 1])
    : 0;

  const entryScale =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 12, mass: 0.4, stiffness: 180 },
          durationInFrames: 12,
        })
      : 0;

  const wordScale = hasBeenActive ? interpolate(entryScale, [0, 1], [0.9, 1]) : 1;
  const color = isActive ? style.activeColor : style.inactiveColor;

  const glowShadow = isActive
    ? `0 0 ${20 * glowPulse}px ${glowColor}, 0 0 ${40 * glowPulse}px ${glowColor}, 0 0 ${60 * glowPulse}px ${glowColor}40`
    : "0 4px 12px rgba(0,0,0,0.7)";

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `scale(${wordScale})`,
        display: "inline-block",
        textShadow: glowShadow,
      }}
    >
      {token.text}
    </span>
  );
};

// ─── SLIDE PRESET ───────────────────────────────────────────────────────

const SlideWord: React.FC<WordPresetProps & { tokenIndex: number }> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
  tokenIndex,
}) => {
  const slideProgress =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 14, mass: 0.6, stiffness: 160 },
          durationInFrames: 18,
        })
      : 0;

  const direction = tokenIndex % 2 === 0 ? -1 : 1;
  const translateX = hasBeenActive
    ? interpolate(slideProgress, [0, 1], [60 * direction, 0])
    : 60 * direction;
  const opacity = hasBeenActive ? interpolate(slideProgress, [0, 1], [0, 1]) : 0;
  const color = isActive ? style.activeColor : style.inactiveColor;

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `translateX(${translateX}px)`,
        opacity,
        display: "inline-block",
        textShadow: "0 4px 12px rgba(0,0,0,0.7)",
      }}
    >
      {token.text}
    </span>
  );
};

// ─── TYPEWRITER PRESET ──────────────────────────────────────────────────

const TypewriterWord: React.FC<WordPresetProps> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
}) => {
  const text = token.text;
  const totalLetters = text.replace(/\s/g, "").length;
  const framesPerLetter = 2;

  const color = isActive ? style.activeColor : style.inactiveColor;

  if (!hasBeenActive) {
    return (
      <span
        style={{
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          fontWeight: 900,
          color: "transparent",
          display: "inline-block",
        }}
      >
        {text}
      </span>
    );
  }

  const visibleCount = Math.min(
    totalLetters,
    Math.floor(frameSinceActive / framesPerLetter) + 1,
  );

  let charIndex = 0;

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        display: "inline-block",
        textShadow: "0 4px 12px rgba(0,0,0,0.7)",
      }}
    >
      {text.split("").map((char, i) => {
        const isSpace = char === " ";
        if (!isSpace) charIndex++;
        const isVisible = isSpace || charIndex <= visibleCount;

        const isLatest = !isSpace && charIndex === visibleCount;
        const letterScale =
          isLatest && frameSinceActive >= 0
            ? spring({
                frame: frameSinceActive % framesPerLetter,
                fps,
                config: { damping: 10, mass: 0.3, stiffness: 300 },
                durationInFrames: framesPerLetter,
              })
            : 1;

        return (
          <span
            key={i}
            style={{
              color: isVisible ? color : "transparent",
              display: "inline",
              transform: isLatest ? `scale(${interpolate(letterScale, [0, 1], [1.3, 1])})` : undefined,
            }}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
};

// ─── EXPLOSION PRESET ───────────────────────────────────────────────────

const ExplosionWord: React.FC<WordPresetProps> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
}) => {
  const explosionScale =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 8, mass: 0.4, stiffness: 250 },
          durationInFrames: 20,
        })
      : 0;

  const wordScale = hasBeenActive
    ? interpolate(explosionScale, [0, 1], [2.5, 1])
    : 0;
  const opacity = hasBeenActive
    ? interpolate(explosionScale, [0, 0.3, 1], [0, 1, 1])
    : 0;
  const color = isActive ? style.activeColor : style.inactiveColor;
  const glowColor = style.glowColor ?? "#FF6600";

  const impactGlow =
    isActive && frameSinceActive < 10
      ? `0 0 30px ${glowColor}, 0 0 60px ${glowColor}80`
      : "0 4px 12px rgba(0,0,0,0.7)";

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `scale(${wordScale})`,
        opacity,
        display: "inline-block",
        textShadow: impactGlow,
      }}
    >
      {token.text}
    </span>
  );
};

// ─── NEON PRESET ───────────────────────────────────────────────────────

const NeonWord: React.FC<WordPresetProps & { frame: number }> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  frame,
  fps,
  style,
}) => {
  const glowColor = style.glowColor ?? "#FF00FF";

  const entryScale =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 12, mass: 0.4, stiffness: 200 },
          durationInFrames: 10,
        })
      : 0;

  const wordScale = hasBeenActive ? interpolate(entryScale, [0, 1], [0.9, 1]) : 1;

  const flicker = isActive
    ? 0.85 + 0.15 * Math.sin(frame * 0.8) * Math.sin(frame * 1.3)
    : 1;

  const baseColor = isActive ? style.activeColor : style.inactiveColor;

  const neonGlow = isActive
    ? [
        `0 0 7px ${glowColor}`,
        `0 0 10px ${glowColor}`,
        `0 0 21px ${glowColor}`,
        `0 0 42px ${glowColor}`,
        `0 0 82px ${glowColor}40`,
      ].join(", ")
    : hasBeenActive
      ? `0 0 7px ${glowColor}60, 0 0 10px ${glowColor}30`
      : "0 4px 12px rgba(0,0,0,0.7)";

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color: baseColor,
        transform: `scale(${wordScale})`,
        opacity: flicker,
        display: "inline-block",
        textShadow: neonGlow,
      }}
    >
      {token.text}
    </span>
  );
};

// ─── 3D PRESET ─────────────────────────────────────────────────────────

const ThreeDWord: React.FC<WordPresetProps> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
}) => {
  const entryScale =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 10, mass: 0.5, stiffness: 180 },
          durationInFrames: 15,
        })
      : 0;

  const wordScale = hasBeenActive ? interpolate(entryScale, [0, 1], [0.8, 1]) : 1;
  const rotateX = isActive ? -5 : 0;
  const rotateY = isActive ? 3 : 0;
  const color = isActive ? style.activeColor : style.inactiveColor;

  const extrusionColor = "rgba(0,0,0,0.4)";
  const shadow3d = isActive
    ? [
        `1px 1px 0 ${extrusionColor}`,
        `2px 2px 0 ${extrusionColor}`,
        `3px 3px 0 ${extrusionColor}`,
        `4px 4px 0 ${extrusionColor}`,
        `5px 5px 10px rgba(0,0,0,0.6)`,
      ].join(", ")
    : "2px 2px 0 rgba(0,0,0,0.3), 4px 4px 8px rgba(0,0,0,0.5)";

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `scale(${wordScale}) perspective(500px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
        display: "inline-block",
        textShadow: shadow3d,
        WebkitTextStroke: "1px rgba(0,0,0,0.2)",
      }}
    >
      {token.text}
    </span>
  );
};

// ─── GLITCH PRESET ─────────────────────────────────────────────────────

const GlitchWord: React.FC<WordPresetProps & { frame: number }> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  frame,
  fps,
  style,
}) => {
  const entryProgress =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 8, mass: 0.3, stiffness: 300 },
          durationInFrames: 8,
        })
      : 0;

  const color = isActive ? style.activeColor : style.inactiveColor;

  const isGlitching = isActive && frameSinceActive >= 0 && frameSinceActive < 8;
  const glitchIntensity = isGlitching
    ? interpolate(frameSinceActive, [0, 8], [1, 0])
    : 0;

  const rgbOffset = Math.round(glitchIntensity * 3);
  const skewX = glitchIntensity * (Math.sin(frame * 2) * 8);

  const wordScale = hasBeenActive ? interpolate(entryProgress, [0, 1], [0.9, 1]) : 1;

  if (isGlitching) {
    return (
      <span
        style={{
          position: "relative",
          display: "inline-block",
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          fontWeight: 900,
          transform: `scale(${wordScale}) skewX(${skewX}deg)`,
        }}
      >
        <span
          style={{
            position: "absolute",
            left: -rgbOffset,
            top: 0,
            color: "rgba(255,0,0,0.7)",
            mixBlendMode: "screen",
          }}
        >
          {token.text}
        </span>
        <span
          style={{
            position: "absolute",
            left: rgbOffset,
            top: -rgbOffset,
            color: "rgba(0,255,0,0.7)",
            mixBlendMode: "screen",
          }}
        >
          {token.text}
        </span>
        <span style={{ color: "rgba(100,100,255,0.9)", position: "relative" }}>
          {token.text}
        </span>
      </span>
    );
  }

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `scale(${wordScale})`,
        display: "inline-block",
        textShadow: "0 4px 12px rgba(0,0,0,0.7)",
      }}
    >
      {token.text}
    </span>
  );
};

// ─── KINETIC PRESET ────────────────────────────────────────────────────

const KineticWord: React.FC<WordPresetProps & { tokenIndex: number }> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
  tokenIndex,
}) => {
  const slideProgress =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 12, mass: 0.5, stiffness: 150 },
          durationInFrames: 20,
        })
      : 0;

  const directions = [
    { x: -120, y: 0 },
    { x: 120, y: 0 },
    { x: 0, y: -80 },
    { x: 0, y: 80 },
    { x: -80, y: -60 },
    { x: 80, y: 60 },
  ];
  const dir = directions[tokenIndex % directions.length];

  const translateX = hasBeenActive
    ? interpolate(slideProgress, [0, 1], [dir.x, 0])
    : dir.x;
  const translateY = hasBeenActive
    ? interpolate(slideProgress, [0, 1], [dir.y, 0])
    : dir.y;
  const opacity = hasBeenActive ? interpolate(slideProgress, [0, 1], [0, 1]) : 0;
  const scale = isActive ? 1.15 : 1;
  const color = isActive ? style.activeColor : style.inactiveColor;

  return (
    <span
      style={{
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        opacity,
        display: "inline-block",
        textShadow: "0 4px 12px rgba(0,0,0,0.7)",
        transition: "transform 0.05s, color 0.05s",
      }}
    >
      {token.text}
    </span>
  );
};

// ─── WAVE PRESET ───────────────────────────────────────────────────────

const WaveWord: React.FC<WordPresetProps & { frame: number }> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  frame,
  fps,
  style,
}) => {
  const entryProgress =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 14, mass: 0.5, stiffness: 180 },
          durationInFrames: 12,
        })
      : 0;

  const opacity = hasBeenActive ? interpolate(entryProgress, [0, 1], [0, 1]) : 0;
  const color = isActive ? style.activeColor : style.inactiveColor;

  return (
    <span
      style={{
        display: "inline-block",
        opacity,
        textShadow: "0 4px 12px rgba(0,0,0,0.7)",
      }}
    >
      {token.text.split("").map((char, i) => {
        const waveOffset = isActive
          ? Math.sin((frame / fps) * Math.PI * 3 + i * 0.6) * 8
          : 0;

        return (
          <span
            key={i}
            style={{
              fontSize: style.fontSize,
              fontFamily: style.fontFamily,
              fontWeight: 900,
              color,
              display: "inline-block",
              transform: `translateY(${waveOffset}px)`,
            }}
          >
            {char}
          </span>
        );
      })}
    </span>
  );
};

// ─── HIGHLIGHT PRESET ──────────────────────────────────────────────────

const HighlightWord: React.FC<WordPresetProps> = ({
  token,
  isActive,
  hasBeenActive,
  frameSinceActive,
  fps,
  style,
}) => {
  const highlightProgress =
    frameSinceActive >= 0
      ? spring({
          frame: frameSinceActive,
          fps,
          config: { damping: 14, mass: 0.4, stiffness: 200 },
          durationInFrames: 12,
        })
      : 0;

  const bgWidth = hasBeenActive
    ? `${interpolate(highlightProgress, [0, 1], [0, 105])}%`
    : "0%";

  const highlightColor = style.glowColor ?? "#FF3366";
  const textColor = isActive ? "#FFFFFF" : style.inactiveColor;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        fontWeight: 900,
        color: textColor,
        padding: "2px 8px",
        textShadow: isActive ? "none" : "0 4px 12px rgba(0,0,0,0.7)",
      }}
    >
      {hasBeenActive && (
        <span
          style={{
            position: "absolute",
            left: -4,
            top: -2,
            bottom: -2,
            width: bgWidth,
            backgroundColor: isActive ? highlightColor : `${highlightColor}60`,
            borderRadius: 4,
            zIndex: -1,
          }}
        />
      )}
      {token.text}
    </span>
  );
};
