# Google sign-in

What to do when the sign-in screen shows **"Google sign-in is not set up
correctly"**.

That card is `describeAuthError`'s response to `DEVELOPER_ERROR` (code 10) from
Google Play Services. Everything in this file is about that one error.

---

## The one thing to understand first

`DEVELOPER_ERROR` is **never** a bug in this repository, and no code change can
fix it. It is Google Play Services saying:

> No OAuth client in your Google Cloud project matches the app that just asked
> me for a token.

Play Services identifies the asking app by **two** things together:

| | where it comes from |
|---|---|
| the applicationId | `BUNDLE_ID` in `app.config.ts` — currently `com.pawtrack.ausasi` |
| the SHA-1 of the certificate the installed APK is signed with | whichever key signed the build **on the device** |

If the pair does not match an **Android OAuth client** in the Cloud project,
you get code 10. There is no third possibility, and the error carries no detail
about which half was wrong.

The app logs both values it knows about when this happens — filter logcat for
`[auth]`:

```sh
adb logcat -s ReactNativeJS:V | grep -i '\[auth\]'
```

It cannot log the SHA-1: an app cannot see which OAuth clients exist.

---

## Cause 1 — the applicationId changed (check this first)

The Android applicationId was renamed during release prep:

```
com.pawtrack.app   →   com.pawtrack.ausasi
```

An Android OAuth client created before that rename still says
`com.pawtrack.app`, and will therefore match nothing. **The package name on an
existing OAuth client cannot be edited** — you delete it and create a new one.

Google Cloud console → **APIs & Services → Credentials**:

1. Look at every **OAuth 2.0 Client ID** of type *Android*.
2. If its package name is not `com.pawtrack.ausasi`, that is the fault.
3. Create a new Android client with:
   - **Package name** — `com.pawtrack.ausasi` (exactly; no trailing space)
   - **SHA-1** — from Cause 2 below
4. Delete the stale one only once the new one works.

> An Android client ID is never referenced in this codebase and does not go in
> `.env`. It exists purely so Play Services can recognise the app. Only the
> **web** client id is read by the app (`GOOGLE_WEB_CLIENT_ID`).

---

## Cause 2 — the SHA-1 is the wrong certificate

This is the one that bites specifically on a Play test track, because **the AAB
you upload is not the APK your testers install**.

With Play App Signing (on by default), Google strips your upload signature and
re-signs with an **app signing key** that it holds. So a build installed from
Play has a different fingerprint from the same build installed over USB.

Register **all** of the fingerprints below that apply. Extra SHA-1s on a client
are harmless; a missing one is code 10.

| build | where to get its SHA-1 |
|---|---|
| **installed from Play** (internal test, closed, production) | Play Console → your app → **Test and release → Setup → App integrity → App signing key certificate** → SHA-1 |
| an AAB/APK built by EAS but installed directly | Play Console, same page, **Upload key certificate** → SHA-1 — or `npx eas-cli credentials -p android` → the build credentials' fingerprint |
| a local debug build (`npm run android`) | `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android` |

Add each one to the Android OAuth client in **Credentials → your Android client
→ SHA-1 certificate fingerprint**.

Google's OAuth changes are not always instant. Give it a few minutes, then
force-stop the app before retrying — Play Services caches the rejection.

---

## Cause 3 — the web client id

The app sends Google's id token to Supabase, which validates its **audience**
against the web client id. Two places must hold the same value:

1. `.env` → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, read by `app.config.ts` into
   `extra.googleWebClientId` (see `src/services/supabase.ts`).
2. Supabase dashboard → **Authentication → Providers → Google → Authorized
   Client IDs**.

A wrong value here usually surfaces as *"The app did not get what it needed from
Google"* rather than code 10 — but an empty one produces code 10, because
`GoogleSignin.configure({ webClientId: '' })` asks Play Services about no client
at all.

**If the value never reached the build**, the Google button does not render at
all — `isGoogleSignInConfigured()` hides it, with its divider. So: *button
visible* rules Cause 3 out on that build, and *button missing* means the
environment did not reach the build, not that the OAuth client is wrong.

### Making sure it reaches an EAS build

`.env` is gitignored, and EAS builds from your git tree — so **`.env` is not
uploaded**. On EAS the values must come from EAS environment variables
(`eas env:list`, or the Expo dashboard), stored in the environment the build
profile uses. If a future build renders no Google button, that is where to look.

---

## Checking a fix

Order matters — the cheapest check first:

1. Sign-in screen shows a **Google button** → the client id reached the build
   (Cause 3 cleared).
2. Tap it, pick an account, and read logcat.
   - Card says *"not set up correctly"* → still Cause 1 or 2. The log line names
     the package the build is actually using; compare it to the OAuth client.
   - Signed in → done.
3. If sign-in succeeds but Supabase rejects the token, that is Cause 3's second
   half — the Authorized Client ID in the Supabase dashboard.

---

## What the owner sees while this is broken

Nothing is lost and nothing is blocked. Email and password sign-in is
unaffected, the error card says so explicitly, and it offers no "Try again"
because retrying a misconfiguration cannot succeed. Records are local-first and
sync when an account is available.
