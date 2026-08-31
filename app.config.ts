import type { ExpoConfig } from 'expo/config';

/**
 * Expo app configuration.
 *
 * This is a .ts file (not app.json) so we can read environment variables and
 * switch values per build profile. Anything secret belongs in .env / EAS
 * secrets, never in this file — it is committed to git.
 */

// IMPORTANT: these identifiers are permanent once you publish to the stores.
// Change them BEFORE your first submission, never after.
const BUNDLE_ID = 'com.pawsjournal.app';

const config: ExpoConfig = {
  name: 'Paws Journal',
  slug: 'paws-journal',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'pawsjournal', // enables deep links, required by expo-router
  userInterfaceStyle: 'light',

  icon: './assets/icon.png',

  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID,
    // Sign in with Apple. NOT optional: App Store guideline 4.8 requires an
    // equivalent privacy-preserving option wherever a third-party social login
    // is offered, and this app offers Google. Shipping Google without this is
    // a guaranteed rejection.
    usesAppleSignIn: true,
    // iOS shows these strings in the permission dialog. Apple REJECTS apps
    // whose strings are vague, so each one names the concrete user benefit.
    //
    // KEEP ALL THREE. They look like they belong to expo-camera, which has no
    // importers — but they are required by expo-image-picker, which IS used:
    // src/services/videoService.ts calls launchCameraAsync() to record a
    // seizure. iOS hard-crashes an app that touches the camera without a usage
    // string, so deleting these alongside the expo-camera plugin entry would
    // crash the one feature owners use mid-emergency.
    infoPlist: {
      NSCameraUsageDescription:
        "Paws Journal uses the camera so you can record video of your dog's seizure to show your veterinarian.",
      NSMicrophoneUsageDescription:
        "Paws Journal records audio with seizure videos, because vocalisation can be clinically relevant.",
      NSPhotoLibraryUsageDescription:
        'Paws Journal lets you attach a video you already recorded to a seizure record.',
      // ADD-ONLY, and deliberately separate from the string above. Saving a
      // seizure video back to Photos does not require the ability to read the
      // owner's library, and iOS shows a materially gentler prompt for
      // add-only access — so the narrower ask also gets granted more often.
      // expo-media-library is requested with writeOnly: true to match.
      NSPhotoLibraryAddUsageDescription:
        'Paws Journal saves seizure videos to your photo library so you can keep them or send them to your veterinarian.',
      // expo-local-authentication, for the OPT-IN app lock in Settings.
      //
      // This is a device lock, not a session policy. It protects the records
      // if someone picks up an unlocked phone, requires no network, and — the
      // reason it is the right tool — it cannot log anyone out at the wrong
      // moment. An app that demands re-authentication at 3am has failed at the
      // one moment it exists for.
      NSFaceIDUsageDescription:
        'Paws Journal can use Face ID to unlock your dog\u2019s health records.',
      // NOTE: there is deliberately NO UIBackgroundModes entry here.
      // The seizure timer does not need one — elapsed time is derived from an
      // absolute start timestamp and recomputed the instant the app returns to
      // the foreground, so suspending JS costs nothing. Declaring the `audio`
      // background mode without actually playing audio does not keep the timer
      // running and is a documented App Review rejection (guideline 2.5.4).
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#F6F2EA',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Same rule as infoPlist above: the first three serve expo-image-picker's
    // camera launch, not expo-camera. VIBRATE serves expo-haptics on the live
    // seizure screen.
    //
    // POST_NOTIFICATIONS is back because medication reminders now exist and
    // schedule notifications — native config lands with the feature that needs
    // it, never ahead of it.
    //
    // SCHEDULE_EXACT_ALARM stays OUT. A daily medication reminder does not need
    // to fire to the second, and it is a policy-restricted permission that
    // requires a Play Console declaration form. An inexact daily alarm is the
    // right trade.
    permissions: [
      'CAMERA',
      'RECORD_AUDIO',
      'READ_MEDIA_VIDEO',
      'POST_NOTIFICATIONS',
      'VIBRATE',
      // Needed only on Android 9 and below, where saving into shared media
      // still goes through the legacy external-storage path. Android 10+ uses
      // scoped storage and ignores it.
      //
      // expo-media-library's plugin declares this itself, UNCAPPED — its
      // withPermissions path writes android:name and nothing else. Listing it
      // here is therefore redundant for presence but useful as the record of
      // why it is in the manifest at all. The maxSdkVersion cap that keeps it
      // off modern devices comes from ./plugins/withCappedLegacyStorage.
      'WRITE_EXTERNAL_STORAGE',
    ],
  },

  /**
   * RULE: native configuration lands in the SAME PR as the feature that needs
   * it, never ahead of it. Scaffolding that costs nothing in a web app costs a
   * review cycle in a mobile one — Apple checks that declared permissions
   * correspond to functionality that exists (guideline 5.1.1), and Google Play
   * treats an over-broad Data Safety declaration as a policy violation in the
   * other direction.
   *
   * Removed until they have real importers:
   *   expo-camera — no imports; video capture goes through expo-image-picker's
   *                 system camera by design
   *
   * expo-notifications EARNED ITS ENTRY BACK in the medication-reminder change:
   * src/services/medicationReminders.ts schedules repeating daily reminders.
   *
   * expo-print and expo-sharing are installed but were never plugin-configured,
   * so there is nothing to remove; they earn entries when the vet report ships.
   */
  plugins: [
    'expo-router',
    [
      'expo-notifications',
      {
        // Local notifications only — medication reminders. There is no push
        // server; nothing about the dog leaves the device.
        icon: './assets/icon.png',
        color: '#2F7E86',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Paws Journal lets you attach a video you already recorded to a seizure record.',
      },
    ],
    'expo-sqlite',
    [
      'expo-media-library',
      {
        savePhotosPermission:
          'Paws Journal saves seizure videos to your photo library so you can keep them or send them to your veterinarian.',
        // We never read the library through this module — video IMPORT goes
        // through expo-image-picker, which has its own narrower prompt. Asking
        // for read access here would be scope we do not use.
        photosPermission:
          'Paws Journal saves seizure videos to your photo library so you can keep them or send them to your veterinarian.',
        isAccessMediaLocationEnabled: false,
      },
    ],
    // Playback in the gallery. expo-video replaces expo-av's Video component,
    // which is deprecated — do not add expo-av back for this.
    'expo-video',
    // Session tokens live in the iOS keychain / Android keystore, never in
    // AsyncStorage. These are bearer tokens for veterinary health records and
    // AsyncStorage is plaintext on disk.
    'expo-secure-store',
    'expo-apple-authentication',
    [
      '@react-native-google-signin/google-signin',
      {
        // The REVERSED iOS client id, e.g. com.googleusercontent.apps.123-abc.
        // Read from the environment because it differs per Firebase/GCP
        // project and must not be hardcoded into a committed file.
        iosUrlScheme:
          process.env.GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.PLACEHOLDER',
      },
    ],
    'expo-local-authentication',
    // MUST come after expo-media-library: it caps the legacy storage
    // permissions that plugin adds uncapped. See the file for why.
    './plugins/withCappedLegacyStorage',
  ],

  experiments: {
    typedRoutes: true, // gives us type-safe router.push() paths
  },

  extra: {
    eas: {
      // Filled in automatically the first time you run `eas init`.
      projectId: process.env.EAS_PROJECT_ID ?? undefined,
    },

    /**
     * Supabase connection details.
     *
     * Both of these are PUBLIC by design and safe in a client bundle. The anon
     * key is a signed JWT asserting the `anon` role and nothing more; Row
     * Level Security is what actually protects the data, which is why
     * supabase/tests/rls_smoke_test.sql runs in CI.
     *
     * The SERVICE ROLE key must NEVER appear here, in .env, or anywhere else
     * this file can reach. It bypasses RLS completely. If it ever ships in a
     * build, every account's records are readable by anyone who unzips the
     * app.
     */
    /**
     * Both naming conventions are accepted, EXPO_PUBLIC_ first.
     *
     * Supabase's own Expo quickstart tells you to name these
     * EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY, so that is the
     * name most people will already have in .env. The unprefixed name is kept
     * as a fallback rather than dropped, because silently ignoring a variable
     * someone has clearly set is how you get an app that builds fine, runs
     * fine, and never syncs — with nothing anywhere saying why.
     *
     * Note these are read HERE and passed through `extra`, not read from
     * process.env inside a source file. Metro only inlines EXPO_PUBLIC_* at
     * build time, so a value that is present when you run `expo start` can be
     * undefined at runtime if it is read from the wrong place.
     */
    supabaseUrl:
      process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',

    /**
     * The client key, under any of the names Supabase's docs have used.
     *
     * Supabase is mid-migration from legacy JWT keys (`anon` / `service_role`,
     * `eyJ…`) to the new API keys (`sb_publishable_…` / `sb_secret_…`), and
     * their guides name the variable differently depending on vintage. Both
     * key types work identically as the second argument to createClient, and
     * both map to the `anon` Postgres role — so RLS is still the thing
     * protecting the data either way.
     *
     * Accepting the realistic set beats one canonical name, because the
     * failure mode of guessing wrong is silent: the app builds, runs, and
     * simply never syncs.
     */
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_KEY ??
      '',

    // OAuth client ids for the NATIVE id-token flow. Also public: they
    // identify the app to Google, they do not authorise anything on their own.
    googleWebClientId:
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
      process.env.GOOGLE_WEB_CLIENT_ID ??
      '',
    googleIosClientId:
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
      process.env.GOOGLE_IOS_CLIENT_ID ??
      '',
  },
};

export default config;
