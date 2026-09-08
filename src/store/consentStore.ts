/**
 * The agreement state, shared between the gate screen and the route gate.
 *
 * ── WHY THIS IS A STORE AND NOT LOCAL STATE IN _layout ────────────────
 *
 * Two screens have to agree about one fact. The root layout decides whether to
 * route to /consent; the consent screen is what makes the answer change. With
 * the flag held in the layout's useState, accepting would write to the account
 * and leave the layout still believing consent was missing — and the layout's
 * `routedFor` guard would then quietly swallow the redirect that should have
 * followed, stranding a new owner on an empty screen.
 *
 * ── IT IS SCOPED TO A USER, AND RESETS WHEN THE USER CHANGES ──────────
 *
 * Consent now belongs to the account (see services/consent.ts). A store that
 * remembered `granted: true` across a sign-out would tell the next person to
 * sign in on the same phone that they had already agreed. So the store records
 * WHICH user the answer is about, and `load` for a different user replaces it
 * rather than merging.
 */

import { create } from 'zustand';
import {
  flushPendingConsent,
  grantConsent,
  readConsent,
  type ConsentState,
} from '@/services/consent';

type ConsentStore = {
  /**
   * Whether both documents are accepted at their current versions.
   *
   * Starts `false` and is only trusted once `loaded` is true for the user in
   * question. The route gate checks `loaded` before acting, so this default
   * never causes a flash of the agreement screen — and defaulting the other
   * way would let someone through the gate on an assumption, which is the
   * failure that actually matters here.
   */
  granted: boolean;
  /** True when this user agreed to an older version and must review again. */
  isUpdate: boolean;
  /** Which user `granted` describes. Null before anything has been loaded. */
  userId: string | null;
  /** True once a real answer has been obtained for `userId`. */
  loaded: boolean;

  load: (userId: string) => Promise<ConsentState>;
  accept: (userId: string) => Promise<void>;
  /** Called on sign-out and on account switch. */
  reset: () => void;
};

export const useConsentStore = create<ConsentStore>((set) => ({
  granted: false,
  isUpdate: false,
  userId: null,
  loaded: false,

  load: async (userId) => {
    const state = await readConsent(userId);
    set({
      granted: state.granted,
      isUpdate: state.isUpdate,
      userId,
      loaded: true,
    });
    // An acceptance recorded offline on a previous run may still be waiting to
    // reach the account. Cheap when there is nothing outstanding.
    if (state.granted) void flushPendingConsent(userId).catch(() => {});
    return state;
  },

  accept: async (userId) => {
    // Written through to storage FIRST. Flipping the flag before the write
    // would let a failure leave the app believing it had consent it never
    // recorded, and the next launch would ask again with no explanation.
    await grantConsent(userId);
    set({ granted: true, isUpdate: false, userId, loaded: true });
  },

  reset: () => set({ granted: false, isUpdate: false, userId: null, loaded: false }),
}));
