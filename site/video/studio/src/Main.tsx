import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { Scene01 } from './Scene01';
import { Scene02, Scene03, Scene04, Scene05, Scene06, Scene07 } from './Scenes';
import { DUR, START, FPS } from './lib';

const SCENES: Record<number, React.FC> = { 1: Scene01, 2: Scene02, 3: Scene03, 4: Scene04, 5: Scene05, 6: Scene06, 7: Scene07 };
export const Main: React.FC = () => (
  <AbsoluteFill style={{ background: '#07070d' }}>
    {Object.keys(SCENES).map((k) => {
      const n = Number(k), C = SCENES[n];
      return <Sequence key={n} from={Math.round(START[n] * FPS)} durationInFrames={Math.round(DUR[n] * FPS)}><C /></Sequence>;
    })}
    <Audio src={staticFile('sfx/master.wav')} volume={0.85} />
  </AbsoluteFill>
);
