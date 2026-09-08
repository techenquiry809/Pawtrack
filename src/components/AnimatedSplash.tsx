/**
 * The launch intro: the branded video, played once, full-bleed.
 *
 * ── WHY THIS ISN'T THE NATIVE LAUNCH SCREEN ───────────────────────────
 *
 * Neither iOS nor Android can play video from the pre-JS launch screen (the
 * storyboard / windowBackground shown before the bridge starts) — that surface
 * only supports a static image. So the native launch screen stays a plain
 * background for the brief moment before JS boots, and this component takes
 * over the instant it does, filling the whole window before anything else in
 * the tree gets a frame.
 *
 * ── contentFit="cover", NOT "contain" ─────────────────────────────────
 *
 * The source clip is a fixed 9:16 recording. Every phone and tablet has a
 * different aspect ratio, and "contain" would letterbox on all of them —
 * exactly the "not built for my device" look this is meant to avoid. "cover"
 * fills the frame on any screen size, cropping only the edges, which is the
 * standard full-bleed technique and needs no per-device math.
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { colors } from '@/theme/tokens';

const SPLASH_VIDEO = require('../../assets/splash-video.mp4');

// If the file fails to decode or playback stalls, the app must not be stuck
// behind an intro forever — this is well past the clip's own ~3s length.
const MAX_INTRO_MS = 6000;

export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const finishedRef = useRef(false);

  const player = useVideoPlayer(SPLASH_VIDEO, (instance) => {
    instance.loop = false;
    instance.play();
  });

  useEffect(() => {
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinish();
    };

    const playToEndSub = player.addListener('playToEnd', finish);
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') finish();
    });
    const timeout = setTimeout(finish, MAX_INTRO_MS);

    return () => {
      playToEndSub.remove();
      statusSub.remove();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <View style={styles.container} pointerEvents="none">
      <VideoView
        style={styles.video}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  video: { flex: 1 },
});
