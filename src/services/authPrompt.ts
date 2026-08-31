/**
 * Whether to offer the sign-in screen at launch.
 *
 * ── WHY SIGNED-OUT DOES NOT MEAN "SHOW A LOGIN WALL" ──────────────────
 *
 * Accounts are optional in this app and always will be. Every record works
 * offline, the local database is the source of truth, and an account adds
 * backup and a second device on top of that — it is not a prerequisite for
 * anything.
 *
 * So the sign-in screen is offered ONCE. If the owner says "not now", the gate
 * stops routing them there and the app opens straight to their dog, exactly as
 * it did before accounts existed. They can sign in from More whenever they
 * want, and §7's claim flow makes sure nothing recorded in the meantime is
 * lost when they do.
 *
 * Putting a login wall in front of a seizure timer would be a poor trade for
 * the owner and an obvious one for us.
 */

import { getSyncValue, setSyncValue } from '@/db/syncState';

const KEY = 'auth_prompt_dismissed';

export async function isAuthPromptDismissed(): Promise<boolean> {
  return (await getSyncValue(KEY)) === '1';
}

export async function dismissAuthPrompt(): Promise<void> {
  await setSyncValue(KEY, '1');
}

/** Signing out puts the offer back on the table for the next person. */
export async function resetAuthPrompt(): Promise<void> {
  await setSyncValue(KEY, '0');
}
