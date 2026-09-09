/**
 * The pre-JS launch window: one flat cream field, and nothing else.
 *
 * ── THE BUG THIS FIXES ────────────────────────────────────────────────
 *
 * Cold-starting the app flashed a grey wireframe — a 5x5 grid with three
 * concentric rings, stretched to fill the screen — for a beat before the
 * branded video intro appeared. It is not one of this project's assets and
 * nobody added it. It ships inside `expo/template.tgz`:
 *
 *     package/android/app/src/main/res/drawable-*(/splashscreen_logo.png
 *
 * That is Expo's PLACEHOLDER artwork, and the bare template wires it straight
 * into the launch theme as a full-bleed window background:
 *
 *     <style name="Theme.App.SplashScreen" parent="AppTheme">
 *       <item name="android:windowBackground">@drawable/splashscreen_logo</item>
 *     </style>
 *
 * `AndroidManifest.xml` gives MainActivity that theme, so it is what the
 * system paints into the starting window before the activity exists. Normally
 * the expo-splash-screen config plugin overwrites the drawable with the app's
 * own; this project deliberately does not depend on that package, so nothing
 * ever replaced it and the placeholder shipped to Play.
 *
 * A `<bitmap>` used as a windowBackground is also STRETCHED, not fitted, which
 * is why a square grid arrived as tall ellipses on a 20:9 phone.
 *
 * ── WHY A FLAT COLOUR AND NOT A BRAND IMAGE ───────────────────────────
 *
 * The intro this app actually wants is assets/splash-video.mp4, and neither
 * platform can play video from the launch window — that surface is a static
 * drawable on Android and a storyboard on iOS. So the launch window's only job
 * is to hand over to src/components/AnimatedSplash.tsx without a visible seam.
 *
 * A still frame cannot do that job. The video is rendered `contentFit="cover"`,
 * so its crop depends on the device's aspect ratio, while an Android
 * windowBackground bitmap always stretches and a storyboard image scales on its
 * own terms. The two would disagree on every phone, and a logo that jumps and
 * resizes at the handoff reads worse than no logo at all.
 *
 * One flat colour cannot disagree with anything. Paired with the fade-in at the
 * top of AnimatedSplash — the video rises out of this exact colour rather than
 * cutting in over it — the whole cold start is: cream, cream, video. No step,
 * no stretch, no placeholder.
 *
 * ── WHY CREAM AND NOT THE VIDEO'S OWN NAVY ────────────────────────────
 *
 * Because the launch theme is NOT the last thing painted before JS. MainActivity
 * calls `setTheme(R.style.AppTheme)` in onCreate, so the window background
 * becomes AppTheme's — `@color/activityBackground`, which is `expo.backgroundColor`,
 * which is cream — for the remainder of startup. Matching the video's navy here
 * would buy one seamless frame and then step to cream anyway. Cream matches what
 * follows it, so there is no step at all.
 *
 * ── WHAT THIS DOES ON EACH PLATFORM ───────────────────────────────────
 *
 *   Android  Repoints Theme.App.SplashScreen at @color/activityBackground and
 *            DELETES the placeholder PNGs, so the asset cannot come back by
 *            being referenced from somewhere this plugin does not read. A plain
 *            colour windowBackground is also what Android 12+ wants: the system
 *            splash screen adopts a single-colour windowBackground as its own
 *            background, so the launcher icon lands on cream instead of on
 *            whatever `?android:colorBackground` happened to be.
 *
 *   iOS      Rewrites SplashScreen.storyboard as a bare cream view. The
 *            template's storyboard centres an image view bound to an asset
 *            named "SplashScreen" that this project never generates, on
 *            `systemBackgroundColor` — pure white in light mode, and pure BLACK
 *            for anyone with the phone in dark mode.
 *
 * Both directories are gitignored build output (see .gitignore), so this has to
 * be a prebuild mod: anything edited in /android or /ios by hand is deleted by
 * the next `expo prebuild --clean`.
 */

const fs = require('node:fs');
const path = require('node:path');

const { withAndroidStyles, withDangerousMod } = require('expo/config-plugins');

/**
 * The launch colour. `colors.bg` from src/theme/tokens.ts, and the same literal
 * as `backgroundColor` in app.config.ts — keep all three in step by hand, for
 * the reason app.config.ts gives: this file is evaluated by the Expo CLI
 * outside the app's module graph and cannot resolve the `@/` alias.
 */
const LAUNCH_COLOR = '#F6F2EA';

/** sRGB components of LAUNCH_COLOR, for the storyboard. */
const LAUNCH_RGB = {
  red: (0xf6 / 255).toFixed(6),
  green: (0xf2 / 255).toFixed(6),
  blue: (0xea / 255).toFixed(6),
};

/**
 * The resource Expo already generates from `expo.backgroundColor`. Reusing it
 * rather than minting a second colour means the launch window and the activity
 * window are the same value BY CONSTRUCTION — they cannot drift when someone
 * edits app.config.ts.
 */
const LAUNCH_BACKGROUND_REF = '@color/activityBackground';

const PLACEHOLDER_DRAWABLE = 'splashscreen_logo.png';

/* ------------------------------------------------------------------ */
/* Android — the launch theme                                          */
/* ------------------------------------------------------------------ */

/**
 * Points every `android:windowBackground` in the splash theme at the flat
 * colour. Exported for the unit check; keep it pure.
 */
function useFlatLaunchBackground(styles) {
  const list = styles?.resources?.style;
  if (!Array.isArray(list)) return styles;

  for (const style of list) {
    if (style?.$?.name !== 'Theme.App.SplashScreen') continue;

    if (!Array.isArray(style.item)) style.item = [];
    const existing = style.item.find(
      (i) => i?.$?.name === 'android:windowBackground',
    );

    if (existing) existing._ = LAUNCH_BACKGROUND_REF;
    else {
      style.item.push({
        $: { name: 'android:windowBackground' },
        _: LAUNCH_BACKGROUND_REF,
      });
    }
  }

  return styles;
}

/**
 * Removes the placeholder from every density bucket.
 *
 * Belt and braces next to the style edit above: the drawable is what actually
 * flashed, so it should not survive in the APK for some other reference — a
 * library manifest, a future template change — to find.
 */
function deletePlaceholderDrawables(resDir) {
  const removed = [];
  if (!fs.existsSync(resDir)) return removed;

  for (const entry of fs.readdirSync(resDir)) {
    if (!entry.startsWith('drawable')) continue;
    const file = path.join(resDir, entry, PLACEHOLDER_DRAWABLE);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      removed.push(file);
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* iOS — the launch storyboard                                         */
/* ------------------------------------------------------------------ */

/**
 * A launch storyboard holding one view and one colour.
 *
 * Deliberately written whole rather than patched. The template's version
 * references an image asset this project does not produce, so there is nothing
 * in it worth preserving, and a full write is the only version of this edit
 * that is idempotent across prebuilds.
 */
const STORYBOARD = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by plugins/withLaunchScreen.js on every prebuild. Do not edit:
  /ios is build output and this file is overwritten. See the plugin for why the
  launch screen is a flat colour rather than a logo.
-->
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="24093.7" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="EXPO-VIEWCONTROLLER-1">
    <device id="retina6_12" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="24053.1"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EXPO-SCENE-1">
            <objects>
                <viewController storyboardIdentifier="SplashScreenViewController" id="EXPO-VIEWCONTROLLER-1" sceneMemberID="viewController">
                    <view key="view" userInteractionEnabled="NO" contentMode="scaleToFill" insetsLayoutMarginsFromSafeArea="NO" id="EXPO-ContainerView" userLabel="ContainerView">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <viewLayoutGuide key="safeArea" id="Rmq-lb-GrQ"/>
                        <color key="backgroundColor" red="${LAUNCH_RGB.red}" green="${LAUNCH_RGB.green}" blue="${LAUNCH_RGB.blue}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="EXPO-PLACEHOLDER-1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
</document>
`;

/* ------------------------------------------------------------------ */

const withLaunchScreen = (config) => {
  let next = withAndroidStyles(config, (cfg) => {
    cfg.modResults = useFlatLaunchBackground(cfg.modResults);
    return cfg;
  });

  next = withDangerousMod(next, [
    'android',
    (cfg) => {
      deletePlaceholderDrawables(
        path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res'),
      );
      return cfg;
    },
  ]);

  next = withDangerousMod(next, [
    'ios',
    (cfg) => {
      // The storyboard's name is fixed by the template and referenced from both
      // the Xcode project and Info.plist's UILaunchStoryboardName, so this
      // writes over the existing path rather than adding a file that would then
      // need registering as a build resource.
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        cfg.modRequest.projectName ?? '',
        'SplashScreen.storyboard',
      );
      if (fs.existsSync(file)) fs.writeFileSync(file, STORYBOARD, 'utf8');
      return cfg;
    },
  ]);

  return next;
};

module.exports = withLaunchScreen;
module.exports.useFlatLaunchBackground = useFlatLaunchBackground;
module.exports.deletePlaceholderDrawables = deletePlaceholderDrawables;
module.exports.LAUNCH_COLOR = LAUNCH_COLOR;
module.exports.LAUNCH_BACKGROUND_REF = LAUNCH_BACKGROUND_REF;
