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
    // iOS shows these strings in the permission dialog. Apple REJECTS apps
    // whose strings are vague, so each one names the concrete user benefit.
    infoPlist: {
      NSCameraUsageDescription:
        "Paws Journal uses the camera so you can record video of your dog's seizure to show your veterinarian.",
      NSMicrophoneUsageDescription:
        "Paws Journal records audio with seizure videos, because vocalisation can be clinically relevant.",
      NSPhotoLibraryUsageDescription:
        'Paws Journal lets you attach a video you already recorded to a seizure record.',
      // The seizure timer must keep running while the phone is in the owner's
      // pocket or face-down next to the dog.
      UIBackgroundModes: ['audio'],
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
    permissions: [
      'CAMERA',
      'RECORD_AUDIO',
      'READ_MEDIA_VIDEO',
      'POST_NOTIFICATIONS',
      'SCHEDULE_EXACT_ALARM',
      'VIBRATE',
    ],
  },

  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        cameraPermission:
          "Paws Journal uses the camera so you can record your dog's seizure for your veterinarian.",
        microphonePermission:
          'Paws Journal records audio with seizure videos, because vocalisation can be clinically relevant.',
        recordAudioAndroid: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Paws Journal lets you attach a video you already recorded to a seizure record.',
      },
    ],
    [
      'expo-notifications',
      {
        // Local notifications only — medication and check-in reminders.
        // There is no push server; nothing leaves the device.
        icon: './assets/icon.png',
        color: '#2F7E86',
      },
    ],
    'expo-sqlite',
  ],

  experiments: {
    typedRoutes: true, // gives us type-safe router.push() paths
  },

  extra: {
    eas: {
      // Filled in automatically the first time you run `eas init`.
      projectId: process.env.EAS_PROJECT_ID ?? undefined,
    },
  },
};

export default config;
