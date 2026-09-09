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
 * ── AND IT FADES, AT BOTH ENDS ────────────────────────────────────────
 *
 * Cutting from a full-bleed video to the Home screen in one frame reads as the
 * app restarting. The fade is short enough not to be a wait and long enough to
 * be a handoff. Skipped under Reduce Motion, where the swap is instant — see
 * src/theme/motion.ts on why that setting is honoured rather than negotiated.
 *
 * The fade IN exists for a different reason. What is on screen before this
 * component mounts is the native launch window, which plugins/withLaunchScreen
 * makes a flat `colors.bg` cream — a video whose first frame is a deep navy
 * gradient cannot cut into that without a hard step. So the video rises out of
 * the same cream, and the cold start is one continuous move rather than three
 * stacked screens.
 *
 * It is also a correctness guard, not only a polish one: VideoView paints an
 * empty surface until the decoder produces a frame, so revealing it on mount
 * risks a black rectangle in front of a cream app. The reveal is therefore
 * driven by `readyToPlay`, not by a timer — see FADE_IN_MS.
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

/**
 * The reveal, from the cream launch window into the clip's first frame.
 *
 * Shorter than FADE_MS on purpose. The fade OUT is covering a change of
 * context — intro to app — and wants to be felt. This one is covering a change
 * of colour on a screen the owner has been looking at for a few hundred
 * milliseconds, and only wants to not be seen.
 */
const FADE_IN_MS = 220;

/**
 * THERE IS DELIBERATELY NO TIMER BEHIND THE REVEAL.
 *
 * The obvious safety net — reveal anyway after N ms — is the wrong net for this
 * failure. A player that has not reported ready has, by definition, no frame to
 * show, so the timer would swap a cream screen for an undefined surface and
 * make a silent degradation into a visible one.
 *
 * Not revealing costs nothing the owner can perceive: the layer stays cream,
 * over an app whose background is the same cream, and startup proceeds
 * underneath exactly as it always does. The only loss is the intro, which is
 * the thing that was already broken.
 */

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

  /**
   * The video layer alone, separate from `opacity` above.
   *
   * They cannot share one value: the container's cream is what the reveal fades
   * up FROM, so it has to stay opaque while the video appears, and then leave
   * with it. Two values, two jobs.
   */
  const videoOpacity = useRef(new Animated.Value(0)).current;
  const revealedRef = useRef(false);

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

  /**
   * Bring the video up out of the cream. Idempotent, because there are two
   * callers for one event: the status listener below, and the status read that
   * covers a player already ready before the listener was attached.
   */
  const reveal = useRef<() => void>(() => {});
  reveal.current = () => {
    if (revealedRef.current) return;
    revealedRef.current = true;

    if (reducedMotion) {
      videoOpacity.setValue(1);
      return;
    }
    Animated.timing(videoOpacity, {
      toValue: 1,
      duration: FADE_IN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  // The clip ending, a decode failure, and the ceiling. All still apply.
  useEffect(() => {
    const playToEndSub = player.addListener('playToEnd', () => leave.current());
    const statusSub = player.addListener('statusChange', ({ status }) => {
      /*
       * Ready is the cue to fade the video in. Error is the cue to leave, and
       * pointedly NOT to reveal: a failed player's surface is undefined — a
       * black rectangle on Android — and fading that in front of a cream app
       * would turn a silent degradation into a visible fault. Left at zero the
       * layer is cream over cream, and the failure costs the owner nothing but
       * the intro they cannot miss what they never saw.
       */
      if (status === 'error') leave.current();
      else if (status === 'readyToPlay') reveal.current();
    });

    /*
     * Mount can land AFTER the player is already ready — `useVideoPlayer` runs
     * its setup callback during render and a cached local file can decode
     * before this effect subscribes. The listener would then never fire for a
     * transition that already happened, so the current status is read once
     * here. This is the ordinary path on a warm start, not an edge case.
     */
    if (player.status === 'readyToPlay') reveal.current();

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
      <Animated.View style={[styles.video, { opacity: videoOpacity }]}>
        <VideoView
          style={styles.video}
          player={player}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
      </Animated.View>
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
