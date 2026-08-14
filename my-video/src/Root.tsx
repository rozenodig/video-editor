import "./index.css";
import { Composition, Folder } from "remotion";
import React from "react";
import { VideoComposition } from "./VideoComposition";
import type { VideoConfig } from "./types/VideoConfig";

import trackAEdit from "../configs/auto-generated/track-a-edit-10s-33s.json";
import sxg3bEdit from "../configs/auto-generated/sxg3b-edit-0s-20s.json";
import musikvideoEdit from "../configs/auto-generated/musikvideo-edit-0s-25s.json";
import musikvideoEdit2 from "../configs/auto-generated/musikvideo-edit-16s-40s.json";
import musikvideoVibe from "../configs/auto-generated/musikvideo-vibe-16s-40s.json";
import musikvideoEdit3 from "../configs/auto-generated/musikvideo-edit-16s-45s.json";
import musikvideoEdit3v2 from "../configs/auto-generated/musikvideo-edit-16s-45s-v2.json";
import musikvideoEdit3v3 from "../configs/auto-generated/musikvideo-edit-16s-45s-v3.json";
import musikvideoVibe2 from "../configs/auto-generated/musikvideo-vibe-16s-45s.json";
import musikvideoVibe2v2 from "../configs/auto-generated/musikvideo-vibe-16s-45s-v2.json";
import musikvideoVibe3 from "../configs/auto-generated/musikvideo-vibe-52s-95s.json";
import musikvideoChill from "../configs/auto-generated/musikvideo-chill-52s-99s.json";
import musikvideoVibey from "../configs/auto-generated/musikvideo-vibey-68s-99s.json";
import musikvideoSmooth from "../configs/auto-generated/musikvideo-smooth-68s-99s.json";
import musikvideoExperimental from "../configs/auto-generated/musikvideo-experimental-68s-99s.json";
import musikvideoCalm from "../configs/auto-generated/musikvideo-calm-68s-99s.json";
import musikvideoCool from "../configs/auto-generated/musikvideo-cool-68s-99s.json";

const autoConfigs = [musikvideoVibey, musikvideoSmooth, musikvideoExperimental, musikvideoCalm, musikvideoCool, musikvideoChill, musikvideoVibe3, musikvideoVibe2, musikvideoVibe2v2, musikvideoEdit3, musikvideoEdit3v2, musikvideoEdit3v3, musikvideoVibe, musikvideoEdit2, musikvideoEdit, sxg3bEdit, trackAEdit] as VideoConfig[];

function ConfigFolder({
  name,
  configs,
}: {
  name: string;
  configs: VideoConfig[];
}) {
  return (
    <Folder name={name}>
      {configs.map((config) => (
        <Composition
          key={config.id}
          id={config.id}
          component={VideoComposition}
          durationInFrames={Math.round(
            config.output.durationInSeconds * config.output.fps,
          )}
          fps={config.output.fps}
          width={config.output.width}
          height={config.output.height}
          defaultProps={{ config }}
        />
      ))}
    </Folder>
  );
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <ConfigFolder name="Auto-Generated" configs={autoConfigs} />
    </>
  );
};
