// Native stub. The web build uses WebLoadingVideo.web.tsx; Android and iOS play the loading
// video through expo-video in LoadingAnimation and never render this.
type Props = { mode: 'video' | 'still' | 'pending'; onDone: () => void };

export function WebLoadingVideo(_props: Props) {
  return null;
}
