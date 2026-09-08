/**
 * Strips the entitlements a free Apple "Personal Team" cannot provision.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Building onto a physical device with a personal (free) Apple ID fails at
 * signing, not at compile, and the message names the profile rather than the
 * cause:
 *
 *     No profiles for 'com.pawtrack.app' were found: Xcode couldn't find any
 *     iOS App Development provisioning profiles matching 'com.pawtrack.app'.
 *
 * Xcode cannot CREATE one either, because the app asks for two capabilities
 * that require enrolment in the paid Apple Developer Program:
 *
 *   aps-environment                      Push Notifications
 *   com.apple.developer.applesignin      Sign In with Apple
 *
 * A personal team can sign an app and an extension, install for 7 days, and
 * nothing else. So for a device test the two have to come off.
 *
 * ── NEITHER REMOVAL CHANGES WHAT THE APP DOES ON THAT BUILD ───────────
 *
 * `aps-environment` is for REMOTE push. This app has no push server — see the
 * expo-notifications entry in app.config.ts — and medication reminders are
 * local notifications, which need no entitlement at all. They keep working.
 *
 * Sign In with Apple has no button on the sign-in screen right now; it was
 * pulled and is due back before submission (see app/(auth)/sign-in.tsx). So
 * on a dev build there is nothing to break.
 *
 * ── IT IS OFF BY DEFAULT, AND MUST STAY OFF FOR THE STORE ─────────────
 *
 * Gated on APPLE_PERSONAL_TEAM=1 in .env rather than applied unconditionally,
 * because BOTH capabilities are required for release: App Store guideline 4.8
 * demands Sign In with Apple wherever Google sign-in is offered, and a build
 * that quietly shipped without it would be rejected. A local flag cannot
 * reach EAS or CI, which is the point — the only way to lose these is to set
 * the variable deliberately on your own machine.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

/** Capabilities the paid programme gates. */
const PAID_ONLY = ['aps-environment', 'com.apple.developer.applesignin'];

const withPersonalTeamEntitlements = (config) =>
  withEntitlementsPlist(config, (config) => {
    if (process.env.APPLE_PERSONAL_TEAM !== '1') return config;

    for (const key of PAID_ONLY) delete config.modResults[key];
    console.log(
      '[personal-team] stripped paid-only entitlements for a free-team build: ' +
        PAID_ONLY.join(', '),
    );
    return config;
  });

module.exports = withPersonalTeamEntitlements;
module.exports.PAID_ONLY = PAID_ONLY;
