/**
 * The iOS home-screen / lock-screen widget target.
 *
 * ── WHY THIS LIVES OUTSIDE /ios ───────────────────────────────────────
 *
 * `/ios` and `/android` are gitignored in this project — they are prebuild
 * OUTPUT, regenerated from app.config.ts on every `npx expo prebuild --clean`.
 * A WidgetKit extension added by hand in Xcode would be deleted by the next
 * prebuild, silently, and would take the widget off everyone's home screen at
 * the following release.
 *
 * So the widget is a SOURCE directory here, and @bacons/apple-targets links it
 * into the generated Xcode project as a real app-extension target during
 * prebuild. Edit these files, never the copy Xcode shows inside `expo:targets`
 * — that is the same file, but /ios around it is disposable.
 *
 * ── AFTER CHANGING THIS FILE ──────────────────────────────────────────
 *
 *     npx expo prebuild -p ios --clean
 *
 * Target settings (name, colors, deployment target) are read at prebuild time
 * only. Editing them without re-running prebuild changes nothing.
 *
 * Signing: the extension is a second bundle id and needs the same Apple team
 * as the app. `ios.appleTeamId` in app.config.ts carries it; see the note
 * there on why it is read from the environment.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'widget',

  // Shown in the widget gallery under the app's name. The gallery already
  // says "PawTrack", so this says what the widget DOES rather than repeating
  // the brand — "PawTrack › PawTrack" helps nobody find it in a hurry.
  name: 'SeizureWidget',
  displayName: 'Record Seizure',

  // Appended to the app's own bundle id: com.pawtrack.app.seizurewidget.
  // Leading dot is the plugin's syntax for "extend the parent".
  bundleIdentifier: '.seizurewidget',

  icon: '../../assets/icon.png',

  /**
   * iOS 16, not the plugin's iOS 18 default.
   *
   * 16 is what the lock-screen accessory families need, and it is as far back
   * as this widget can go — `containerBackground` is iOS 17 and is behind an
   * availability check in index.swift so 16 still renders correctly.
   *
   * Going lower would drop the lock-screen complication, which for a seizure
   * app is the single most valuable placement: it is reachable without
   * unlocking the phone.
   */
  deploymentTarget: '16.0',

  frameworks: ['SwiftUI', 'WidgetKit'],

  /**
   * Generated as colorsets inside the target's asset catalog, referenced from
   * Swift as `Color("$widgetBackground")`.
   *
   * These are the app's own seizure red (colors.red / colors.redDeep in
   * src/theme/tokens.ts). Duplicated rather than imported because a WidgetKit
   * extension is a separate binary that cannot read the JS theme — so if the
   * token ever changes, change it in BOTH places.
   */
  colors: {
    // `{ light, dark }` — NOT the `{ color, darkColor }` shape the plugin's
    // README shows. That form is stale: with-widget.js reads `.light`/`.dark`,
    // so the README's keys land as `undefined` and write an EMPTY colorset,
    // which Swift then resolves to transparent at runtime rather than failing
    // to build. Verified against node_modules/@bacons/apple-targets@5.0.0.
    $widgetBackground: { light: '#D0483F', dark: '#A93327' },
    $widgetBackgroundDeep: { light: '#A93327', dark: '#7E251C' },
    $accent: '#D0483F',
  },
};
