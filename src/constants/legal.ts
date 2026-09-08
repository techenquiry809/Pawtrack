/**
 * The Privacy Policy and the Terms of Service, as data.
 *
 * ── WHY THIS IS STRUCTURED CONTENT AND NOT A PDF OR A WEBVIEW ─────────
 *
 * These two documents are the one thing in the app an owner MUST be able to
 * read before they can use it, which rules out both of the easy options:
 *
 *   A bundled PDF needs a viewer, does not reflow, ignores the OS text-size
 *   setting, and is unreadable one-handed on a phone — and this is the screen
 *   where someone decides whether to trust us with their dog's medical
 *   history.
 *
 *   A WebView pointing at a hosted page needs a network connection. The
 *   consent gate is the FIRST screen a new owner sees, and an app that cannot
 *   be agreed to on a train is an app that cannot be opened on a train.
 *
 * So the text lives here, as typed blocks, rendered by React Native's own Text
 * with the app's own tokens. It scales with the OS text-size setting, works
 * offline, is searchable in the repo, and diffs like code when the policy
 * changes — which matters, because a legal document whose changes are
 * invisible in review is a legal document nobody reviews.
 *
 * ── KEEPING THIS HONEST ───────────────────────────────────────────────
 *
 * The privacy text below is a faithful transcription of
 * PawTrack_Privacy_Policy.pdf (Ausasi LLC, last updated 6 September 2026).
 * Do not "tidy" its meaning. If the policy changes, change it here AND bump
 * PRIVACY_VERSION, or owners will go on being shown the version they agreed
 * to rather than the one in force.
 *
 * Two claims in it are load-bearing and are also architectural facts this
 * codebase enforces, not aspirations:
 *
 *   "Seizure videos never leave your device" — video file paths are declared
 *   deviceLocal in src/db/syncSchema.ts and there is no upload path anywhere.
 *
 *   "We do not collect GPS or precise location" — the app records a timezone
 *   OFFSET on a seizure (tz_offset_min) and nothing else positional.
 *
 * If either ever stops being true in the code, it has to stop being claimed
 * here in the same commit.
 */

/* ------------------------------------------------------------------ */
/* The content model                                                   */
/* ------------------------------------------------------------------ */

export type LegalBlock =
  /** A paragraph. */
  | { kind: 'p'; text: string }
  /** A bulleted list. */
  | { kind: 'list'; items: string[] }
  /** A lettered or named sub-heading inside a section. */
  | { kind: 'sub'; text: string }
  /**
   * A tinted aside. Used for the two corrections the policy makes about
   * earlier drafts, and for the points an owner most needs to actually read
   * rather than scroll past.
   */
  | { kind: 'note'; text: string };

export type LegalSection = {
  /** Numbered as in the source document; null for an unnumbered preamble. */
  number: number | null;
  title: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  id: 'privacy' | 'terms';
  /** Shown in the header and on the consent screen's buttons. */
  title: string;
  /** Human-readable date, shown under the title. */
  updated: string;
  /**
   * Bumped whenever the text materially changes. The consent gate compares
   * this against what the owner accepted and asks again when it moves — see
   * src/services/consent.ts.
   */
  version: string;
  /** One-line summary for the consent screen and the Settings row. */
  summary: string;
  sections: LegalSection[];
};

export const PRIVACY_VERSION = '2026-09-06';
export const TERMS_VERSION = '2026-09-06';

/** Who to contact, in one place so the two documents cannot disagree. */
export const LEGAL_ENTITY = 'Ausasi LLC — Tyler, Texas, United States';
export const LEGAL_EMAIL = 'ausasi.socials@gmail.com';

/* ------------------------------------------------------------------ */
/* Terms of Service                                                    */
/* ------------------------------------------------------------------ */

/**
 * Written for this app specifically, not adapted from a generic template.
 *
 * Every clause below describes something PawTrack actually does — an optional
 * account, a local-first database, videos that never sync, shared accounts
 * with no permission tiers, reports the owner generates and sends themselves.
 * A template's clauses about user-generated content, public profiles or
 * payment terms would be describing an app nobody has built, and boilerplate
 * that does not match the product is worse than no boilerplate: it teaches
 * owners that this document is not worth reading.
 *
 * The medical framing is the part that matters most and is stated three times
 * on purpose — in the summary, in §3, and in §4. This app sits next to a sick
 * animal, and the one misunderstanding that could actually hurt someone's dog
 * is believing PawTrack decides whether a seizure is an emergency.
 */
export const TERMS: LegalDocument = {
  id: 'terms',
  title: 'Terms of Service',
  updated: 'September 6, 2026',
  version: TERMS_VERSION,
  summary:
    'What PawTrack is, what it is not, and what we each agree to. It is a record-keeping tool, not a veterinarian.',
  sections: [
    {
      number: null,
      title: 'Before you start',
      blocks: [
        {
          kind: 'p',
          text: `These Terms of Service (“Terms”) are an agreement between you and ${LEGAL_ENTITY} (“Ausasi LLC,” “PawTrack,” “we,” “us,” or “our”), covering your use of the PawTrack mobile application (“PawTrack” or the “App”).`,
        },
        {
          kind: 'p',
          text: 'By tapping “I agree” or by using PawTrack, you accept these Terms and the Privacy Policy. If you do not agree, please do not use the App.',
        },
        {
          kind: 'note',
          text: 'PawTrack helps you write down and organise what happened to your pet. It does not diagnose, treat, or decide what is an emergency. If you think your pet is in danger, contact a veterinarian immediately — do not wait for the App.',
        },
      ],
    },
    {
      number: 1,
      title: 'Who May Use PawTrack',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is intended for adults. You must be at least 18 years old to create an account or use the App. By agreeing to these Terms you confirm that you are 18 or older and that you are legally able to enter into this agreement.',
        },
        {
          kind: 'p',
          text: 'If you use PawTrack on behalf of an organisation — a rescue, a boarding facility, a veterinary practice — you confirm you are authorised to accept these Terms for that organisation.',
        },
      ],
    },
    {
      number: 2,
      title: 'What PawTrack Does',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is a record-keeping tool for pet owners managing a pet with seizures or another ongoing condition. Depending on the features you use, it lets you:',
        },
        {
          kind: 'list',
          items: [
            'Time and record a seizure as it happens, or add one afterwards',
            'Record symptoms before, during and after an episode',
            'Record daily check-ins, mood, appetite, sleep and other observations',
            'Track medications, doses, schedules and missed doses',
            'Record and keep videos of an episode on your device',
            'Store veterinary and emergency contact details',
            'Generate a report you can show or send to your veterinarian',
            'Back up your records to an optional account and open them on another device',
          ],
        },
        {
          kind: 'p',
          text: 'An account is optional. PawTrack is fully usable with no account at all — your records are saved on your device either way. An account adds backup and access from a second device; it is not required to use any feature of the App.',
        },
      ],
    },
    {
      number: 3,
      title: 'PawTrack Is Not Veterinary Care',
      blocks: [
        {
          kind: 'p',
          text: 'This is the most important term in this document. PawTrack is not a veterinarian, a veterinary clinic, an emergency service, a medical device, or a provider of veterinary treatment. PawTrack does not:',
        },
        {
          kind: 'list',
          items: [
            'Diagnose seizures or any other medical condition',
            'Prescribe medication or recommend a dosage',
            'Provide veterinary treatment or veterinary advice',
            'Replace a veterinarian, or a veterinarian’s instructions',
            'Decide whether an episode is an emergency',
            'Guarantee that any record, calculation, or report is accurate or complete',
          ],
        },
        {
          kind: 'p',
          text: 'Any general information the App shows about seizures, medications or related topics is for general information only and is not veterinary advice. Always consult a qualified veterinarian about your pet’s care, and follow their instructions over anything shown in the App.',
        },
        {
          kind: 'note',
          text: 'If you believe your pet is having a medical emergency — including a seizure that is prolonged, repeated, or otherwise concerning — seek veterinary care immediately. Do not rely on PawTrack to tell you when to act.',
        },
      ],
    },
    {
      number: 4,
      title: 'Alerts, Timers and Reminders Are Not Guarantees',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may show timers, thresholds, cluster notices, and medication reminders. These are conveniences built on the information you enter and on your device’s clock and notification system. They can be late, wrong, or absent entirely — because a phone was silenced, offline, out of battery, restarted, denied notification permission, or because the operating system chose to delay or drop a scheduled notification.',
        },
        {
          kind: 'p',
          text: 'You must not rely on PawTrack as the only way you are reminded to give medication, or as the thing that tells you a seizure has gone on too long. Use your veterinarian’s emergency plan and your own judgement.',
        },
      ],
    },
    {
      number: 5,
      title: 'Emergency Features Are Started By You',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may let you save a veterinarian, an emergency hospital, and an emergency contact, and to reach them from within the App. Every one of those actions is started by you.',
        },
        {
          kind: 'p',
          text: 'PawTrack does not automatically contact a veterinarian, an emergency hospital, an emergency contact, or emergency services on your behalf, and never does so based on a seizure record alone. We cannot guarantee that any call, message, or shared record is delivered, received, or answered.',
        },
      ],
    },
    {
      number: 6,
      title: 'Your Records, and Who Can See Them',
      blocks: [
        {
          kind: 'p',
          text: 'The information you enter about you and your pet is yours. We do not claim ownership of it. You give us only the permission we need to store, back up, sync and display it so the App can work for you, and to do the things described in the Privacy Policy.',
        },
        { kind: 'sub', text: 'Shared accounts' },
        {
          kind: 'p',
          text: 'A PawTrack account may be used by more than one person — two owners in a household, or an owner and a carer. Everyone who can sign in to an account can currently see and change everything in it. There are no per-person permission levels.',
        },
        {
          kind: 'p',
          text: 'You are responsible for deciding who you let into your account and for keeping your sign-in details safe. If you share your password, you are sharing your pet’s full medical history.',
        },
        { kind: 'sub', text: 'What you share outward' },
        {
          kind: 'p',
          text: 'When you export a report, send a video, or share a record with a veterinarian, a family member, or anyone else, it leaves PawTrack. What happens to it after that is governed by whoever received it and whatever service you used to send it, not by us.',
        },
      ],
    },
    {
      number: 7,
      title: 'Where Your Records Live',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack saves your records on your device first, so the App works with no signal. If you have an account, most records are also backed up and synced so they appear on your other devices.',
        },
        {
          kind: 'note',
          text: 'Seizure videos are the exception, and always will be. Videos stay on the device that recorded or imported them. They are never uploaded to our servers and never sync to your other devices. A video exists in exactly one place, so if you lose or wipe that device, the video is gone — export anything you cannot afford to lose.',
        },
        {
          kind: 'p',
          text: 'Without an account there is no backup of any kind. Losing the device loses the records on it. This is a consequence of the design, not a fault, and it is why the App offers an account.',
        },
        {
          kind: 'p',
          text: 'We aim to keep the service available and your data intact, but we do not guarantee uninterrupted availability, and we are not a backup service. Keep your own copies of anything critical by exporting it.',
        },
      ],
    },
    {
      number: 8,
      title: 'Accounts and Security',
      blocks: [
        {
          kind: 'p',
          text: 'Where you create an account, you agree to give accurate information, to keep your credentials confidential, and to tell us promptly if you believe someone else has gained access. You are responsible for activity that happens under your account.',
        },
        {
          kind: 'p',
          text: 'You may sign in by email and password with a one-time code, or through Apple or Google where available. We apply reasonable technical and organisational safeguards, but no method of transmission or storage is completely secure and we cannot guarantee absolute security.',
        },
      ],
    },
    {
      number: 9,
      title: 'Acceptable Use',
      blocks: [
        { kind: 'p', text: 'You agree not to:' },
        {
          kind: 'list',
          items: [
            'Use PawTrack for anything unlawful, or in a way that breaks these Terms',
            'Access, or try to access, an account or records that are not yours',
            'Interfere with, disrupt, overload, or probe the App or its infrastructure',
            'Reverse engineer, decompile, or attempt to extract source code, except where the law expressly allows it',
            'Copy, resell, sublicense, or commercially redistribute the App or its content',
            'Upload anything malicious, or anything you do not have the right to upload',
            'Present PawTrack’s output as a veterinary diagnosis, or use it to give veterinary advice to others',
          ],
        },
      ],
    },
    {
      number: 10,
      title: 'Changes to the App',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is under active development. We may add, change, or remove features, and we may introduce paid features or subscriptions in the future. If we introduce paid features, the terms that apply to them will be presented before you buy anything, and purchases made through the Apple App Store or Google Play are also subject to that store’s terms.',
        },
        {
          kind: 'p',
          text: 'We will not remove your ability to export your existing records without telling you first.',
        },
      ],
    },
    {
      number: 11,
      title: 'Ending Your Use',
      blocks: [
        {
          kind: 'p',
          text: 'You may stop using PawTrack at any time. You may delete individual records, remove an account’s data from a device, or request deletion of your account. Where an account is shared, only the designated account holder may delete the whole account.',
        },
        {
          kind: 'p',
          text: 'We may suspend or end access to an account that breaks these Terms, that we reasonably believe is being used unlawfully, or where required by law. Where it is reasonable and lawful to do so, we will give notice and an opportunity to export records first.',
        },
        {
          kind: 'p',
          text: 'Deleting an account does not delete anything you have already exported or saved elsewhere — including videos saved to your device’s Photos or Gallery.',
        },
      ],
    },
    {
      number: 12,
      title: 'Our Intellectual Property',
      blocks: [
        {
          kind: 'p',
          text: 'The App itself — its software, design, text, logos, and branding — belongs to Ausasi LLC or its licensors, and is protected by intellectual property law. These Terms give you a personal, limited, non-exclusive, non-transferable, revocable licence to use PawTrack for your own pet record-keeping. They do not transfer any ownership to you.',
        },
        {
          kind: 'p',
          text: 'This does not affect your ownership of the records you create.',
        },
      ],
    },
    {
      number: 13,
      title: 'Disclaimers',
      blocks: [
        {
          kind: 'p',
          text: 'To the fullest extent permitted by law, PawTrack is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including implied warranties of merchantability, fitness for a particular purpose, accuracy, and non-infringement.',
        },
        {
          kind: 'p',
          text: 'We do not warrant that the App will be uninterrupted, error-free, or secure; that reminders or notifications will be delivered on time or at all; or that any record, duration, calculation, pattern, or report is accurate or complete.',
        },
      ],
    },
    {
      number: 14,
      title: 'Limitation of Liability',
      blocks: [
        {
          kind: 'p',
          text: 'To the fullest extent permitted by law, Ausasi LLC and its officers, employees and suppliers will not be liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for any loss of data, records, videos, profits, or goodwill, arising out of or relating to your use of PawTrack — even if we have been advised that such damages are possible.',
        },
        {
          kind: 'p',
          text: 'To the fullest extent permitted by law, our total liability for all claims relating to PawTrack is limited to the greater of the amount you paid us for the App in the twelve months before the claim, or US$50.',
        },
        {
          kind: 'note',
          text: 'Some jurisdictions do not allow the exclusion of certain warranties or the limitation of certain damages. Where that is the case, the exclusions and limits above apply only as far as the law allows, and nothing in these Terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be limited.',
        },
      ],
    },
    {
      number: 15,
      title: 'Indemnity',
      blocks: [
        {
          kind: 'p',
          text: 'You agree to indemnify and hold harmless Ausasi LLC from claims, damages, liabilities and reasonable legal costs arising from your misuse of the App, your breach of these Terms, or your infringement of someone else’s rights. This does not apply to the extent a claim arises from our own wrongdoing.',
        },
      ],
    },
    {
      number: 16,
      title: 'Governing Law',
      blocks: [
        {
          kind: 'p',
          text: 'These Terms are governed by the laws of the State of Texas, United States, without regard to its conflict-of-law rules, and the state and federal courts located in Texas will have jurisdiction — except where the law of your country of residence gives you the right to bring proceedings locally, which these Terms do not take away.',
        },
      ],
    },
    {
      number: 17,
      title: 'Changes to These Terms',
      blocks: [
        {
          kind: 'p',
          text: 'We may update these Terms as PawTrack develops or as the law changes. When we make a significant change we will update the date at the top, and ask you to review and agree again inside the App before you continue using it. Continuing to use PawTrack after an update takes effect means you accept the updated Terms, to the extent the law allows.',
        },
        {
          kind: 'p',
          text: 'You can read the current Terms and Privacy Policy at any time from Settings.',
        },
      ],
    },
    {
      number: 18,
      title: 'Contact Us',
      blocks: [
        { kind: 'p', text: 'Questions about these Terms:' },
        { kind: 'p', text: LEGAL_ENTITY },
        { kind: 'p', text: `Email: ${LEGAL_EMAIL}` },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Privacy Policy — transcribed from PawTrack_Privacy_Policy.pdf       */
/* ------------------------------------------------------------------ */

export const PRIVACY: LegalDocument = {
  id: 'privacy',
  title: 'Privacy Policy',
  updated: 'September 6, 2026',
  version: PRIVACY_VERSION,
  summary:
    'What we collect, how it is stored, and who can see it. Seizure videos never leave your device, and we do not collect location.',
  sections: [
    {
      number: null,
      title: 'Overview',
      blocks: [
        {
          kind: 'p',
          text: `${LEGAL_ENTITY.split(' — ')[0]} (“Ausasi LLC,” “PawTrack,” “we,” “us,” or “our”) operates the PawTrack mobile application (“PawTrack” or the “App”).`,
        },
        {
          kind: 'p',
          text: 'PawTrack is a pet seizure and health record-keeping application designed to help pet owners document seizure episodes, track medications and symptoms, organize veterinary information, and prepare records for veterinary visits.',
        },
        {
          kind: 'p',
          text: 'This Privacy Policy explains what information we collect, how we use it, how we store and share it, and the choices you have regarding your information.',
        },
        {
          kind: 'p',
          text: 'By using PawTrack, you acknowledge the practices described in this Privacy Policy.',
        },
      ],
    },
    {
      number: 1,
      title: 'Who We Are',
      blocks: [
        { kind: 'p', text: 'PawTrack is operated by:' },
        { kind: 'p', text: LEGAL_ENTITY },
        {
          kind: 'p',
          text: `For privacy-related questions or requests, contact us at: ${LEGAL_EMAIL}`,
        },
      ],
    },
    {
      number: 2,
      title: 'Information We Collect',
      blocks: [
        {
          kind: 'p',
          text: 'We collect information that you provide directly, information generated through your use of PawTrack, and certain technical information necessary to operate and improve the App.',
        },
        { kind: 'sub', text: 'A. Account Information' },
        {
          kind: 'p',
          text: 'Depending on how you create and access your account, we may collect:',
        },
        {
          kind: 'list',
          items: [
            'Email address',
            'Phone number',
            'Name or other basic account information provided through Apple or Google',
            'Authentication information and account identifiers',
            'Information associated with Apple Sign-In or Google Sign-In',
            'Phone verification information',
          ],
        },
        {
          kind: 'p',
          text: 'PawTrack may use third-party authentication providers, including Apple and Google, to help create and authenticate your account.',
        },
        {
          kind: 'p',
          text: 'When you use Apple Sign-In or Google Sign-In, those providers may provide PawTrack with information such as your name, email address, and provider-specific account identifier, depending on the information and settings made available by the provider.',
        },
        {
          kind: 'p',
          text: 'When you use phone-number authentication, PawTrack may use an SMS or identity-verification service to send verification codes.',
        },
      ],
    },
    {
      number: 3,
      title: 'Pet Information',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack allows you to create and maintain profiles for your pets. You may provide information including:',
        },
        {
          kind: 'list',
          items: [
            'Pet name',
            'Species',
            'Breed',
            'Date of birth or age',
            'Sex',
            'Weight',
            'Pet photographs',
            'Microchip number',
            'Other identifying information',
            'Veterinarian information',
            'Emergency veterinary information',
            'Other notes you choose to provide',
          ],
        },
        {
          kind: 'p',
          text: 'You control the information you enter into your pet’s profile.',
        },
      ],
    },
    {
      number: 4,
      title: 'Seizure and Veterinary Information',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is designed to help you document your pet’s seizure history and related veterinary information. Depending on the features you use, we may collect or store information including:',
        },
        {
          kind: 'list',
          items: [
            'Seizure date and time, and time zone',
            'Seizure history, duration and other episode details',
            'Symptoms before, during and after a seizure',
            'Pet behavior or mood',
            'Recovery information and recovery time',
            'Medication names, dosage, schedules and frequency',
            'Medication start and end dates, and missed doses',
            'Diagnosis or seizure type information entered by you',
            'Other medical conditions entered by you, and allergies',
            'Veterinary notes',
            'Veterinarian name, clinic or hospital name, and specialty',
            'Veterinary phone number, email address and clinic address',
            'Emergency veterinary hospital information',
            'Other information you choose to include',
          ],
        },
        {
          kind: 'p',
          text: 'This information is collected for the purpose of helping you organize and manage your pet’s records. PawTrack does not use this information to diagnose or treat your pet.',
        },
      ],
    },
    {
      number: 5,
      title: 'Photos and Videos',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may allow you to record or import photographs and videos of your pet, including videos recorded during a seizure.',
        },
        { kind: 'sub', text: 'Videos' },
        {
          kind: 'note',
          text: 'Seizure videos are designed to remain on your device only. PawTrack does not upload your seizure videos to PawTrack’s cloud servers or to any other cloud storage as part of the normal operation of the App. Videos stay on the device that recorded or imported them and are not part of the account data that syncs across your devices.',
        },
        {
          kind: 'p',
          text: 'You may choose to share a video using your device’s available sharing functions. Once you share a video outside PawTrack, the recipient and any third-party service you use may process that video according to their own policies.',
        },
        {
          kind: 'p',
          text: 'If you save or export a video to your device’s Photos/Gallery or another location outside PawTrack, deleting your PawTrack account does not automatically delete that separate copy.',
        },
        { kind: 'sub', text: 'Photos' },
        {
          kind: 'p',
          text: 'Pet photos may be stored and used as part of your pet profile and related App functionality.',
        },
      ],
    },
    {
      number: 6,
      title: 'Device and Technical Information',
      blocks: [
        {
          kind: 'p',
          text: 'When you use PawTrack, we may automatically collect certain technical information, including:',
        },
        {
          kind: 'list',
          items: [
            'Device type and operating system',
            'App version',
            'Device identifiers or similar technical identifiers',
            'IP address',
            'Crash and error information',
            'Diagnostic and performance information',
            'Usage and activity information',
            'Information about how you interact with the App',
          ],
        },
        {
          kind: 'p',
          text: 'This information helps us operate, maintain, troubleshoot, secure, and improve PawTrack.',
        },
      ],
    },
    {
      number: 7,
      title: 'Analytics',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may use Google Analytics or similar analytics services to understand how users interact with the App. Analytics may include information about:',
        },
        {
          kind: 'list',
          items: [
            'Screens and features used, and how frequently',
            'Button taps and interactions',
            'Session duration and general usage patterns',
            'Whether users complete certain actions',
            'Device type and operating system',
            'Crash and error information, and App performance',
          ],
        },
        {
          kind: 'p',
          text: 'We use analytics to understand how PawTrack is used and to improve functionality, reliability, and user experience. PawTrack does not use analytics to sell your personal information.',
        },
      ],
    },
    {
      number: 8,
      title: 'Notifications and Reminders',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may provide notifications and reminders, including medication reminders, seizure tracking reminders, follow-up reminders after a seizure, veterinary appointment reminders, and general App notifications.',
        },
        {
          kind: 'p',
          text: 'You may be able to control notification settings through PawTrack and/or your device settings. Where supported, you may choose whether notifications display detailed information or use more generic notification text.',
        },
        {
          kind: 'p',
          text: 'To provide push notifications, PawTrack or its service providers may process technical information such as a device or push-notification identifier.',
        },
      ],
    },
    {
      number: 9,
      title: 'Location Information',
      blocks: [
        {
          kind: 'note',
          text: 'PawTrack does not use GPS and does not collect your device’s precise location. PawTrack may record the time and time zone associated with an event, such as a seizure, medication entry, or reminder, so that records reflect when an event occurred — this is a time-zone label, not a location measurement, and is not derived from GPS or any other location service.',
        },
      ],
    },
    {
      number: 10,
      title: 'How We Use Information',
      blocks: [
        {
          kind: 'p',
          text: 'We may use information collected through PawTrack to:',
        },
        {
          kind: 'list',
          items: [
            'Create and maintain user accounts, and authenticate users',
            'Create and maintain pet profiles',
            'Record seizure episodes, and track medications, reminders, symptoms and behavior',
            'Organize veterinary information',
            'Generate veterinary visit-ready reports and allow users to export records',
            'Allow users to share information they choose to share',
            'Provide emergency contact features initiated by the user',
            'Send reminders and notifications',
            'Provide customer support and troubleshoot technical problems',
            'Detect and prevent fraud, abuse, or security issues',
            'Monitor and improve App performance, and analyze App usage',
            'Comply with applicable laws and respond to lawful requests from government authorities',
            'Protect the rights, safety, and security of PawTrack, our users, and others',
          ],
        },
        {
          kind: 'p',
          text: 'We do not sell or rent your personal information or your pet’s information.',
        },
      ],
    },
    {
      number: 11,
      title: 'Veterinary and Emergency Features',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is designed as a tracking and record-keeping tool. PawTrack may allow you to generate veterinary visit-ready reports, export seizure and pet records, share information with a veterinarian, family members, caregivers or another PawTrack user, share seizure videos, and contact a veterinarian, a veterinary emergency hospital, or a saved emergency contact.',
        },
        {
          kind: 'p',
          text: 'Emergency contact features are user-initiated. PawTrack does not automatically contact a veterinarian, emergency hospital, emergency contact, or emergency services based solely on a seizure record or event. PawTrack does not guarantee that an emergency contact, veterinarian, veterinary hospital, or other recipient will receive or respond to a communication.',
        },
      ],
    },
    {
      number: 12,
      title: 'PawTrack Is Not Veterinary or Medical Advice',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is a tracking and record-keeping tool. PawTrack is not a veterinarian, veterinary clinic, emergency service, medical device, or veterinary treatment provider. PawTrack does not:',
        },
        {
          kind: 'list',
          items: [
            'Diagnose medical conditions or seizures',
            'Prescribe medications or recommend medication dosages',
            'Provide veterinary treatment',
            'Replace a veterinarian',
            'Guarantee the accuracy of any record or report',
            'Determine whether a seizure is an emergency',
          ],
        },
        {
          kind: 'p',
          text: 'PawTrack may provide general educational information about seizures, medications, or related topics. Such information is provided for general informational purposes only and should not be treated as veterinary advice. Always consult a qualified veterinarian regarding your pet’s medical care. If you believe your pet is experiencing a medical emergency, seek appropriate veterinary care immediately.',
        },
      ],
    },
    {
      number: 13,
      title: 'Sharing Your Information',
      blocks: [
        {
          kind: 'p',
          text: 'We do not sell or rent your personal information or pet information. We may share or permit access to information in the following circumstances:',
        },
        { kind: 'sub', text: 'A. With People You Give Access To' },
        {
          kind: 'p',
          text: 'Because a PawTrack account may be shared by multiple people, anyone with access to the shared account may be able to access the information available through that account. Shared account users currently have the same level of access and permissions. You are responsible for deciding who you allow to access your PawTrack account and for protecting your login credentials.',
        },
        { kind: 'sub', text: 'B. When You Choose to Share Information' },
        {
          kind: 'p',
          text: 'You may choose to share information with veterinarians, veterinary clinics or hospitals, family members, caregivers, emergency contacts, other PawTrack users, or other recipients using your device’s sharing functionality.',
        },
        {
          kind: 'p',
          text: 'When you voluntarily share information, the recipient may use or further share that information according to their own practices and policies.',
        },
        { kind: 'sub', text: 'C. Service Providers' },
        {
          kind: 'p',
          text: 'We may use trusted third-party service providers to help us operate PawTrack. These providers may process information on our behalf for purposes such as:',
        },
        {
          kind: 'list',
          items: [
            'Authentication',
            'Cloud database services (account, pet, and record data only — never seizure videos)',
            'Analytics',
            'App infrastructure',
            'Error and crash monitoring',
            'Security',
            'Email communications (such as account verification codes)',
            'Customer support',
            'Other services necessary to operate PawTrack',
          ],
        },
        {
          kind: 'p',
          text: 'These providers are expected to process information only as necessary to provide their services to us and subject to appropriate contractual or legal protections.',
        },
        { kind: 'sub', text: 'D. Legal Requirements' },
        {
          kind: 'p',
          text: 'We may disclose information if reasonably necessary to comply with applicable law, respond to a valid legal process, court order, subpoena or government request, protect the rights or property of Ausasi LLC, protect the safety of users or others, investigate fraud, abuse or security incidents, or enforce our Terms of Service.',
        },
      ],
    },
    {
      number: 14,
      title: 'No Sale of Personal Information',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack does not sell or rent user personal information, pet information, seizure history, medication records, veterinary records, pet photos, seizure records, or other information you provide to PawTrack.',
        },
        {
          kind: 'p',
          text: 'PawTrack does not provide this information to third parties for their own advertising or marketing purposes.',
        },
      ],
    },
    {
      number: 15,
      title: 'No Third-Party Advertising',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack does not currently display third-party advertisements. We do not use third-party advertising networks to serve advertisements based on your PawTrack information. If this changes in the future, we will update this Privacy Policy and applicable privacy disclosures before introducing such functionality.',
        },
      ],
    },
    {
      number: 16,
      title: 'Account Security',
      blocks: [
        { kind: 'p', text: 'PawTrack supports account access through:' },
        {
          kind: 'list',
          items: [
            'Email and password (with a one-time verification code sent by email)',
            'Google Sign-In',
            'Apple Sign-In (where available)',
            'Phone-number authentication',
            'Biometric authentication where supported by the device',
          ],
        },
        {
          kind: 'p',
          text: 'You are responsible for keeping your account credentials and authentication methods secure. We are continuing to develop PawTrack’s security architecture. We will implement appropriate technical and organizational safeguards designed to protect information against unauthorized access, loss, misuse, alteration, or disclosure. No method of electronic transmission or storage is completely secure, and we cannot guarantee absolute security.',
        },
      ],
    },
    {
      number: 17,
      title: 'Local and Cloud Storage',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is designed to use both local device storage and cloud-based storage or synchronization for certain information, which may include account information, pet profiles, seizure records, medication records, symptoms and notes, veterinary information, reports, and other information associated with your PawTrack account.',
        },
        {
          kind: 'note',
          text: 'Seizure videos always remain on your device and are never uploaded to PawTrack’s cloud storage — this is a permanent design choice, not a temporary limitation.',
        },
        {
          kind: 'p',
          text: 'The exact cloud storage provider and synchronization architecture for the non-video information above may change as PawTrack develops. We will update this Privacy Policy when the relevant service provider and implementation are finalized.',
        },
      ],
    },
    {
      number: 18,
      title: 'Data Retention',
      blocks: [
        {
          kind: 'p',
          text: 'We retain information for as long as reasonably necessary to provide PawTrack and its features, maintain accounts, comply with legal obligations, resolve disputes, enforce agreements, and protect our services.',
        },
        {
          kind: 'p',
          text: 'If you delete information or your account, we intend to remove the applicable information from active systems promptly. Deleted information may remain in encrypted backups or disaster-recovery systems for up to 30 days before being permanently deleted or securely overwritten, unless a longer retention period is required by law or reasonably necessary for legitimate legal, security, or fraud-prevention purposes.',
        },
        {
          kind: 'p',
          text: 'Information stored separately on your personal device, including videos saved to your Photos/Gallery, is not automatically deleted when you delete your PawTrack account.',
        },
      ],
    },
    {
      number: 19,
      title: 'Your Privacy Choices and Rights',
      blocks: [
        {
          kind: 'p',
          text: 'Depending on where you live and applicable law, you may have rights regarding your personal information. These may include the right to:',
        },
        {
          kind: 'list',
          items: [
            'Request access to personal information',
            'Request correction of inaccurate information',
            'Request deletion of personal information',
            'Request a copy or export of your information',
            'Request information about how your information is collected or used',
            'Object to or restrict certain processing where applicable',
            'Withdraw consent where processing is based on consent',
            'Exercise other rights provided by applicable law',
          ],
        },
        {
          kind: 'p',
          text: 'PawTrack will honor applicable privacy rights based on the laws that apply to you. You may also manage certain information directly through the App.',
        },
      ],
    },
    {
      number: 20,
      title: 'Updating Your Information',
      blocks: [
        {
          kind: 'p',
          text: 'Where supported, you may view, update, or correct account information, pet information, veterinarian information, medication information, seizure records, and other information that can be edited through the App.',
        },
        {
          kind: 'p',
          text: 'If you cannot change information through the App, you may contact us using the information provided below.',
        },
      ],
    },
    {
      number: 21,
      title: 'Data Export',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is designed to allow users to export or download information associated with their account, which may include account information, pet profiles, seizure history, medication records, symptoms and notes, veterinary information, reports, and other information stored by PawTrack.',
        },
        {
          kind: 'p',
          text: 'Because seizure videos are stored only on your device, those videos must be exported or shared directly from your device rather than through PawTrack’s cloud data export.',
        },
      ],
    },
    {
      number: 22,
      title: 'Account Deletion',
      blocks: [
        {
          kind: 'p',
          text: 'The designated account holder may request deletion of the PawTrack account. Deleting an account may result in the deletion of associated PawTrack data, including pet profiles, seizure records, medication records, notes, and other account-associated information, subject to applicable law and the retention practices described in this Privacy Policy.',
        },
        {
          kind: 'p',
          text: 'Because a PawTrack account may be shared by multiple people, only the designated account holder may permanently delete the shared account. Other users with access to the shared account cannot independently delete the entire shared account.',
        },
        {
          kind: 'p',
          text: 'You may also be able to delete individual pet profiles, seizure records, photos, and other records. Where applicable, you may request deletion by contacting us.',
        },
      ],
    },
    {
      number: 23,
      title: 'Customer Support',
      blocks: [
        {
          kind: 'p',
          text: 'If you contact PawTrack support, you may voluntarily provide information necessary to help us resolve your issue. This may include account information, screenshots, error messages, diagnostic information, crash information, pet information, seizure information, and other information you choose to provide.',
        },
        {
          kind: 'p',
          text: 'Support personnel may access information reasonably necessary to investigate and resolve a support request. We do not expect users to provide sensitive information that is unnecessary to resolve a support issue.',
        },
      ],
    },
    {
      number: 24,
      title: 'Children’s Privacy',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is intended for adults and is not directed to individuals under 18 years of age. We do not knowingly seek to collect personal information from individuals under 18. If we learn that an account has been created by an individual under 18 where prohibited by applicable law, we may take steps to delete or restrict the account and associated information as required by applicable law. If you believe that a person under 18 has provided information to PawTrack, please contact us.',
        },
      ],
    },
    {
      number: 25,
      title: 'International Users and Data Transfers',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is intended to be available worldwide. Depending on where you live and where our service providers operate, your information may be processed or stored in the United States or other countries. Different countries may have different privacy laws from your country of residence.',
        },
        {
          kind: 'p',
          text: 'Where required by applicable law, we will implement appropriate safeguards for international transfers of personal information. The exact locations in which PawTrack data is stored or processed may depend on the cloud and service providers we use.',
        },
      ],
    },
    {
      number: 26,
      title: 'Third-Party Services',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may use third-party services to operate and improve the App. These may include:',
        },
        {
          kind: 'list',
          items: [
            'Apple Sign-In',
            'Google Sign-In',
            'Google Analytics',
            'Expo and Expo Application Services',
            'SMS or phone-number verification providers',
            'Email delivery providers (for account verification codes)',
            'Cloud database/storage providers',
            'Other infrastructure or security providers',
          ],
        },
        {
          kind: 'p',
          text: 'The specific services used may change as PawTrack develops. Third-party providers may collect or process information according to their own privacy policies. Before launching PawTrack, we intend to provide links to the current privacy policies of the third-party services actually used by the App.',
        },
      ],
    },
    {
      number: 27,
      title: 'Third-Party Links and Sharing',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may provide functionality that allows you to open, share, or send information through third-party applications or services. We are not responsible for the privacy practices of third parties that you choose to use. For example, if you choose to share a seizure video, PDF report, or other record through your device’s messaging, email, cloud-storage, or social-media applications, the information may be processed by those services according to their own policies.',
        },
      ],
    },
    {
      number: 28,
      title: 'Marketing Communications',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack does not currently rely on advertising to operate the App. In the future, Ausasi LLC may send promotional or marketing communications about PawTrack, new features, educational content, promotions, or other services. Where required by applicable law, you will be provided with an appropriate way to opt out of marketing communications. Service-related communications, such as security notices, account notices, and important operational messages, may still be sent when necessary.',
        },
      ],
    },
    {
      number: 29,
      title: 'Subscriptions and Payments',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack may introduce paid features, subscriptions, or in-app purchases in the future. If payment functionality is introduced, payments may be processed through third-party platforms such as Apple App Store, Google Play, or another payment provider. PawTrack does not currently represent that it directly collects or stores full payment-card information. If paid services are introduced, this Privacy Policy and the applicable disclosures will be updated to explain the relevant payment processing practices.',
        },
      ],
    },
    {
      number: 30,
      title: 'Social and Community Features',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack does not currently provide public social or community features. Future versions of PawTrack may introduce features such as community discussions, public profiles, messaging, or other social functionality. If such features are introduced, we will update this Privacy Policy and applicable privacy disclosures to explain how information shared through those features is handled.',
        },
      ],
    },
    {
      number: 31,
      title: 'Changes to This Privacy Policy',
      blocks: [
        {
          kind: 'p',
          text: 'We may update this Privacy Policy from time to time as PawTrack develops, laws change, or our privacy practices change. When we make changes, we may update the Privacy Policy within the App or on our website, update the “Last Updated” date, provide an in-app notification for significant changes, and send an email notification for significant changes when appropriate or required.',
        },
        {
          kind: 'p',
          text: 'We encourage you to review this Privacy Policy periodically. Your continued use of PawTrack after an updated Privacy Policy becomes effective means that you acknowledge the updated policy, to the extent permitted by applicable law.',
        },
      ],
    },
    {
      number: 32,
      title: 'Applicable Privacy Laws',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack will seek to comply with applicable federal, state, national, and international privacy laws that apply to Ausasi LLC, PawTrack, and its users. Privacy rights and obligations may differ depending on where a user lives and how PawTrack is used. Nothing in this Privacy Policy is intended to limit any privacy rights that cannot lawfully be limited under applicable law.',
        },
      ],
    },
    {
      number: 33,
      title: 'Contact Us',
      blocks: [
        {
          kind: 'p',
          text: 'If you have questions about this Privacy Policy, want to exercise a privacy right, want to request deletion of your information, or have another privacy-related concern, contact:',
        },
        { kind: 'p', text: LEGAL_ENTITY },
        { kind: 'p', text: `Email: ${LEGAL_EMAIL}` },
        {
          kind: 'p',
          text: 'When making a privacy request, we may need to verify your identity or account ownership before fulfilling the request.',
        },
      ],
    },
    {
      number: 34,
      title: 'Summary',
      blocks: [
        {
          kind: 'p',
          text: 'PawTrack is designed to give pet owners a centralized way to document and organize their pets’ seizure and veterinary information. Our core privacy commitments are:',
        },
        {
          kind: 'list',
          items: [
            'We do not sell or rent your personal information or pet information.',
            'We do not currently use third-party advertising.',
            'Seizure videos always remain on your device and are never uploaded to our servers.',
            'We do not collect GPS or precise location data.',
            'You control who you choose to share your records with.',
            'You can delete individual records and request deletion of your account.',
            'Deleted cloud data is intended to be removed from active systems and may remain in backups for up to 30 days.',
            'PawTrack is a tracking and record-keeping tool, not a veterinary diagnostic or treatment service.',
            'We use third-party services only as reasonably necessary to provide, maintain, secure, and improve PawTrack.',
            'We provide privacy rights according to applicable law.',
          ],
        },
      ],
    },
  ],
};

/** Both documents, in the order the consent screen presents them. */
export const LEGAL_DOCUMENTS: LegalDocument[] = [TERMS, PRIVACY];

export function legalDocument(id: LegalDocument['id']): LegalDocument {
  const doc = LEGAL_DOCUMENTS.find((d) => d.id === id);
  if (!doc) throw new Error(`[legal] unknown document '${id}'`);
  return doc;
}
