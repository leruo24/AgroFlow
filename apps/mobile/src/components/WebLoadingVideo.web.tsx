// The loading video on web, as a plain <video>, the same way the admin site's splash does it.
// expo-video's web player leaves out what iPhone Safari needs: it adds no muted, playsinline or
// autoplay attributes and waits for `canplay` before playing, but Safari does not load a video
// until it is played, so on an iPhone nothing ever started.
// The logo poster sits underneath and stays visible until the video is really playing. If the
// video cannot play (blocked, Low Power Mode, a slow network, an error), the poster stays and
// the overlay closes as soon as the app is ready: never a blank screen and never a play button.
import { useEffect, useRef, useState } from 'react';

// Served from public/media, a web-only folder. The MP4 is H.264 yuv420p with its index at the
// front (faststart), so Safari can start before the whole file arrives.
const VIDEO_SRC = '/media/agroflow-loading.mp4';
const POSTER_SRC = '/media/agroflow-loading-poster.jpg';

// No frame within this time counts as "will not play".
const START_TIMEOUT_MS = 2000;

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' } as const;

type Props = {
  // Called once: when the video ends, or as soon as it is clear it will not play.
  onDone: () => void;
};

export function WebLoadingVideo({ onDone }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDoneRef.current();
    };
    const giveUp = () => {
      setPlaying(false);
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
      if (!finished) setPlaying(true);
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
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, backgroundColor: '#FFFFFF' }}>
      <img src={POSTER_SRC} alt="" aria-hidden="true" style={fill} />
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        poster={POSTER_SRC}
        muted
        autoPlay
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        // Hidden until a frame is really playing, so Safari's own play button or an empty first
        // frame never covers the poster.
        style={{ ...fill, opacity: playing ? 1 : 0 }}
      />
    </div>
  );
}
