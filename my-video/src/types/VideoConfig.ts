export interface ClipConfig {
  src: string;
  startFrom: number;     // start time in SOURCE video (seconds)
  endAt: number;         // end time in SOURCE video (seconds)
  showAt: number;        // when this clip appears in OUTPUT timeline (seconds)
  playbackRate?: number; // 0.3 = slowmo, 1.0 = normal, 1.5 = speedup. Default 1.0
  scale?: number;        // 1.0 = normal, 1.2 = 20% zoom in. Default 1.0
  scaleAnchor?: { x: number; y: number }; // zoom anchor (0.5, 0.5 = center)
  transition?: "cut" | "zoom" | "glitch" | "flash"; // per-clip transition override
}

export interface CaptionStyleConfig {
  preset:
    | "bounce"
    | "glow"
    | "slide"
    | "typewriter"
    | "explosion"
    | "neon"
    | "3d"
    | "glitch"
    | "kinetic"
    | "wave"
    | "highlight"
    | "vfx";
  fontSize: number;
  fontFamily: string;
  activeColor: string;
  inactiveColor: string;
  glowColor?: string;
  backgroundColor?: string;
  position: "bottom" | "center" | "top";
  combineTokensWithinMs: number;
}

export interface BeatTimestamp {
  timeInSeconds: number;
  effect: "shake" | "pulse" | "flash";
  intensity?: number;
}

export interface EffectsConfig {
  beatSync: boolean;
  beats?: BeatTimestamp[];
  transitions: "cut" | "zoom" | "glitch" | "flash";
  colorGrade?: string;
  vignette: boolean;
}

export interface OutputConfig {
  width: 1080;
  height: 1920;
  fps: 30;
  durationInSeconds: number;
}

export interface VideoConfig {
  id: string;
  title: string;
  mode: "lyric" | "edit";
  audioSrc: string;
  audioStartFrom?: number; // start time in audio file (seconds) — for trimming
  captionsPath?: string;
  clips: ClipConfig[];
  captionStyle?: CaptionStyleConfig;
  effects: EffectsConfig;
  output: OutputConfig;
}
