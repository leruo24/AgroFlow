// The loading video on web, as a plain <video>, the same way the admin site's splash does it.
// expo-video's web player leaves out what iPhone Safari needs: it adds no muted, playsinline or
// autoplay attributes and waits for `canplay` before playing, but Safari does not load a video
// until it is played, so on an iPhone nothing ever started.
// The first frame shows at once (poster), so the screen is never blank while the video loads.
// If the video cannot play (blocked, Low Power Mode, a slow network, an error), the finished
// logo frame is shown instead and the overlay closes as soon as the app is ready: never a
// blank screen and never a play button.
import { useEffect, useRef, useState } from 'react';

// Served from public/media, a web-only folder. H.264 High, yuv420p, BT.709, faststart, no audio,
// 1920x1080 at 30 fps, 9.0 s. "-v2" so a phone holding the old portrait video in its cache
// cannot mix the two.
const VIDEO_SRC = '/media/agroflow-loading-v2.mp4';
// Frame 0 of the video: what the video starts on, shown before it plays.
const FIRST_FRAME_SRC = '/media/agroflow-loading-v2-poster.png';
// The last frame (the logo): shown if the video will not play, since frame 0 is an empty field.
const LOGO_FRAME_SRC = '/media/agroflow-loading-v2-final.jpg';

// The video's own background colour. The overlay uses it too, so there is no visible box
// around the picture on a screen with a different shape from the video.
export const WEB_LOADING_BACKGROUND = '#F9FBF8';

// No frame within this time counts as "will not play".
const START_TIMEOUT_MS = 2000;

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } as const;

type Props = {
  // 'video' plays it; 'still' shows the logo frame (reduced motion); 'pending' shows the first
  // frame while the motion preference is still unknown.
  mode: 'video' | 'still' | 'pending';
  // Called once in 'video' mode: when the video ends, or as soon as it is clear it will not play.
  onDone: () => void;
};

export function WebLoadingVideo({ mode, onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [state, setState] = useState<'waiting' | 'playing' | 'failed'>('waiting');

  useEffect(() => {
    const video = videoRef.current;
    if (mode !== 'video' || !video) return;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDoneRef.current();
    };
    const giveUp = () => {
      setState('failed');
      video.pause();
      finish();
    };

    // Real attributes and properties, set before play(): iOS decides whether a video may play
    // inline without a tap from these.
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    const onPlaying = () => {
      if (!finished) setState('playing');
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('ended', finish);
    video.addEventListener('error', giveUp);

    const startTimer = setTimeout(() => {
      if (video.paused || video.currentTime === 0) giveUp();
    }, START_TIMEOUT_MS);

    const played = video.play();
    if (played && typeof played.catch === 'function') played.catch(giveUp);

    return () => {
      clearTimeout(startTimer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('ended', finish);
      video.removeEventListener('error', giveUp);
      video.pause();
    };
  }, [mode]);

  if (mode !== 'video') {
    return (
      <div style={{ position: 'absolute', inset: 0, backgroundColor: WEB_LOADING_BACKGROUND }}>
        <img src={mode === 'still' ? LOGO_FRAME_SRC : FIRST_FRAME_SRC} alt="AgroFlow" style={fill} />
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, backgroundColor: WEB_LOADING_BACKGROUND }}>
      <img src={state === 'failed' ? LOGO_FRAME_SRC : FIRST_FRAME_SRC} alt="" aria-hidden="true" style={fill} />
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        poster={FIRST_FRAME_SRC}
        muted
        autoPlay
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        // Hidden until a frame is really playing, so Safari's own play button never covers the
        // poster.
        style={{ ...fill, opacity: state === 'playing' ? 1 : 0 }}
      />
    </div>
  );
}
