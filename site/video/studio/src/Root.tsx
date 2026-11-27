import React from 'react';
import { Composition } from 'remotion';
import { Scene01, SCENE01_FRAMES } from './Scene01';
import { Main } from './Main';
import { TOTAL_SECONDS } from './lib';

const FPS = 30;
export const Root: React.FC = () => (
  <>
    <Composition id="Scene01" component={Scene01} durationInFrames={SCENE01_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="Orbie" component={Main} durationInFrames={Math.round(TOTAL_SECONDS * FPS)} fps={FPS} width={1920} height={1080} />
  </>
);
