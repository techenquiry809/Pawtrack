/**
 * Caps the legacy Android storage permissions with `android:maxSdkVersion`.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * expo-media-library's config plugin adds READ_EXTERNAL_STORAGE and
 * WRITE_EXTERNAL_STORAGE to the manifest. It adds them through
 * `AndroidConfig.Permissions.withPermissions`, whose `addPermissionToManifest`
 * writes a single attribute:
 *
 *     manifestPermissions.push({ $: { 'android:name': permission } });
 *
 * There is no maxSdkVersion anywhere in that path. So both permissions land
 * UNCAPPED, and an uncapped WRITE_EXTERNAL_STORAGE is requested on every
 * Android version — including the ones where it does nothing.
 *
 * That is a Play Console problem, not a cosmetic one. WRITE_EXTERNAL_STORAGE is
 * a sensitive permission: declaring it on a modern target invites a Data Safety
 * declaration and a permissions review for access this app does not use and
 * cannot use. Scoped storage replaced it at API 29, and READ_EXTERNAL_STORAGE
 * was superseded by the granular READ_MEDIA_* permissions at API 33 — which
 * expo-media-library already declares.
 *
 * ── WHY A MOD RATHER THAN app.config.ts ───────────────────────────────
 *
 * `android.permissions` in app config is a list of plain strings; the schema
 * has nowhere to put an attribute. Editing the manifest after the plugin has
 * run is the only place the cap can be applied.
 *
 * This runs as a `withAndroidManifest` mod, so it executes during prebuild
 * after every other plugin has contributed its permissions.
 */

const { withAndroidManifest } = require('expo/config-plugins');

/**
 * The last SDK level on which each permission still does anything.
 *   28 — Android 9. API 29 (Android 10) introduced scoped storage, after which
 *        WRITE_EXTERNAL_STORAGE is ignored for shared media.
 *   32 — Android 12L. API 33 (Android 13) replaced READ_EXTERNAL_STORAGE with
 *        READ_MEDIA_IMAGES / _VIDEO / _AUDIO.
 */
const CAPS = {
  'android.permission.WRITE_EXTERNAL_STORAGE': '28',
  'android.permission.READ_EXTERNAL_STORAGE': '32',
};

/** Exported for the unit check in scripts/; keep it pure. */
function capLegacyStoragePermissions(androidManifest) {
  const permissions = androidManifest.manifest['uses-permission'];
  if (!Array.isArray(permissions)) return androidManifest;

  for (const permission of permissions) {
    const name = permission.$?.['android:name'];
    const cap = CAPS[name];
    // Only ever ADD the cap. If something upstream already set one, it knows
    // something we do not and overwriting it would be the same class of
    // silent repair this app refuses everywhere else.
    if (cap && permission.$['android:maxSdkVersion'] === undefined) {
      permission.$['android:maxSdkVersion'] = cap;
    }
  }

  return androidManifest;
}

const withCappedLegacyStorage = (config) =>
  withAndroidManifest(config, (config) => {
    config.modResults = capLegacyStoragePermissions(config.modResults);
    return config;
  });

module.exports = withCappedLegacyStorage;
module.exports.capLegacyStoragePermissions = capLegacyStoragePermissions;
module.exports.CAPS = CAPS;
