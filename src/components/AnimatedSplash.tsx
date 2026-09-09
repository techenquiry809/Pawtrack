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
 * ── IT ENDS WHEN THE APP IS READY, NOT WHEN THE CLIP IS ───────────────
 *
 * This used to hold the window until the video played out. Measured on a
 * release build on a real device, that was 3625ms of intro in front of an app
 * that finished starting at 139ms and had Home painted and settled by 507ms —
 * about three seconds of watching a logo for no reason.
 *
 * So `canFinish` (startup done) is what ends it now. The clip is still the
 * thing being shown; it is simply no longer the thing being waited for. The
 * three timings that remain each guard a different failure:
 *
 *   MIN_INTRO_MS   a floor, so a fast cold start does not flash the intro for
 *                  three frames — which reads as a glitch, not as speed
 *   playToEnd      the clip finishing is still a perfectly good reason to go,
 *                  and on a slow start it is what fires first
 *   MAX_INTRO_MS   a ceiling, for a file that fails to decode or a startup
 *                  that never reports. Never reached in normal operation.
 *
 * ── AND IT FADES ──────────────────────────────────────────────────────
 *
 * Cutting from a full-bleed video to the Home screen in one frame reads as the
 * app restarting. The fade is short enough not to be a wait and long enough to
 * be a handoff. Skipped under Reduce Motion, where the swap is instant — see
 * src/theme/motion.ts on why that setting is honoured rather than negotiated.
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
import { Animated, Easing, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { colors } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

const SPLASH_VIDEO = require('../../assets/splash-video.mp4');

// If the file fails to decode or playback stalls, the app must not be stuck
// behind an intro forever — this is well past the clip's own ~3s length.
const MAX_INTRO_MS = 6000;

/**
 * The floor.
 *
 * Startup lands at ~140ms on a warm device, and dismissing at 140ms would show
 * two or three frames of video and then something else — which looks like a
 * failed load rather than a fast launch. Long enough for the mark to register
 * as deliberate, short enough that nobody waits on it.
 */
const MIN_INTRO_MS = 700;

/** The handoff. Matches `duration.enter` in the motion tokens. */
const FADE_MS = 320;

export function AnimatedSplash({
  canFinish,
  onFinish,
}: {
  /**
   * True once startup has settled — or failed. Both are reasons to get out of
   * the way: an error screen behind an intro is worse than no intro at all.
   */
  canFinish: boolean;
  onFinish: () => void;
}) {
  const finishedRef = useRef(false);
  const mountedAt = useRef(Date.now());
  const opacity = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  const player = useVideoPlayer(SPLASH_VIDEO, (instance) => {
    instance.loop = false;
    instance.play();
  });

  /**
   * Kept in a ref so the leave sequence can be started from a listener, a
   * timer or a prop change without any of them re-subscribing the others.
   */
  const leave = useRef<() => void>(() => {});
  leave.current = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    if (reducedMotion) {
      onFinish();
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onFinish());
  };

  // The clip ending, a decode failure, and the ceiling. All still apply.
  useEffect(() => {
    const playToEndSub = player.addListener('playToEnd', () => leave.current());
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') leave.current();
    });
    const timeout = setTimeout(() => leave.current(), MAX_INTRO_MS);

    return () => {
      playToEndSub.remove();
      statusSub.remove();
      clearTimeout(timeout);
    };
  }, [player]);

  /**
   * The normal path: startup finished, so go — once the floor has passed.
   *
   * The remaining wait is computed from mount rather than slept for a fixed
   * period, so a startup that takes 900ms leaves immediately instead of
   * serving another 700ms on top of it.
   */
  useEffect(() => {
    if (!canFinish) return;
    const remaining = Math.max(0, MIN_INTRO_MS - (Date.now() - mountedAt.current));
    const timer = setTimeout(() => leave.current(), remaining);
    return () => clearTimeout(timer);
  }, [canFinish]);

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="none">
      <VideoView
        style={styles.video}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
    </Animated.View>
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
