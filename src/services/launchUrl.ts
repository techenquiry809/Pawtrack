/**
 * Classifying the URL that opened the app.
 *
 * Split out from launchIntent.ts and importing NOTHING, for the same reason
 * clock.ts does: `npm test` runs node's native type stripping with no bundler
 * and no module mocks, so a file that reaches for `expo-linking` cannot be
 * tested at all. The half that has the logic in it lives here; the half that
 * talks to the platform lives next door.
 *
 * See launchIntent.ts for why any of this exists.
 */

export type LaunchIntent =
  /** Opened by the widget, straight into the seizure flow. Skip everything skippable. */
  | 'emergency'
  /** Everything else: the icon, a notification, an ordinary deep link. */
  | 'ordinary';

/**
 * Routes that mean "a seizure is happening now".
 *
 * `seizure/start` is what the widget opens — see the PendingIntent in
 * plugins/withSeizureWidget.js and the WidgetKit link on iOS. `seizure/live`
 * is here because it is the timer itself, and a future entry point that links
 * straight to it deserves the same treatment rather than a second bug report.
 */
const EMERGENCY_ROUTES = ['seizure/start', 'seizure/live'];

/**
 * The route part of a launch URL: no scheme, host, query or fragment.
 *
 * Written by hand rather than with `Linking.parse` because that reports the
 * first path segment of a custom-scheme URL as `hostname` — so `pawtrack://
 * seizure/start` comes back as hostname 'seizure', path 'start', and the
 * caller has to reassemble the path anyway. Reassembly that is wrong fails
 * silently, in the direction of "not an emergency", which is the direction
 * nobody would notice.
 */
export function routeOfLaunchUrl(url: string): string {
  /*
   * The development client wraps the real link as ?url=<encoded>. Unwrapped
   * here so a dev build classifies the same as a release build — without it
   * the fast path would be invisible in exactly the build used to test it.
   *
   * One level only: a wrapper inside a wrapper is not a thing either platform
   * produces, and recursing without a bound on attacker-supplied input is how
   * you get a hang on the launch path.
   */
  const wrapped = /[?&]url=([^&]+)/.exec(url);
  const target = wrapped?.[1] ? safeDecode(wrapped[1]) : url;

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target)?.[1]?.toLowerCase();
  const afterScheme = scheme ? target.slice(scheme.length + 1) : target;

  /*
   * ── THE ONE THING THAT IS EASY TO GET WRONG HERE ──────────────────────
   *
   * What follows `//` is only a HOST for the web schemes. In a custom-scheme
   * link it is the first segment of the path: in `pawtrack://seizure/start`
   * the route is `seizure/start`, not `start`. Stripping an authority from
   * both — which is what a single `//[^/]*` does, and what `Linking.parse`
   * effectively reports — silently drops `seizure` and the widget link stops
   * matching, in the direction nobody notices.
   */
  const isWebScheme = scheme === 'http' || scheme === 'https';
  const withoutAuthority = isWebScheme
    ? afterScheme.replace(/^\/\/[^/?#]*/, '')
    : afterScheme.replace(/^\/\//, '');

  const path = withoutAuthority.split(/[?#]/)[0] ?? '';
  return path.replace(/^\/+|\/+$/g, '');
}

/** `decodeURIComponent` throws on a malformed escape; a launch must not. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * What kind of launch this URL represents. `null` is an ordinary (icon) launch.
 */
export function classifyLaunchUrl(url: string | null | undefined): LaunchIntent {
  if (!url) return 'ordinary';
  return EMERGENCY_ROUTES.includes(routeOfLaunchUrl(url)) ? 'emergency' : 'ordinary';
}
