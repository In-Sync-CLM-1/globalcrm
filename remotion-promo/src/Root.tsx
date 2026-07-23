import React from 'react';
import { Composition } from 'remotion';
import { Promo } from './Promo';
import { NARRATION_SECONDS } from './timings';

const FPS = 30;
const DURATION_SECONDS = NARRATION_SECONDS + 1.3;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={Math.round(DURATION_SECONDS * FPS)}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="PromoVertical"
        component={Promo}
        durationInFrames={Math.round(DURATION_SECONDS * FPS)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ vertical: true }}
      />
    </>
  );
};
