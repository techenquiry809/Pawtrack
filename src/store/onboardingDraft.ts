/**
 * The half-filled first-run profile.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────
 *
 * Onboarding used to hold the name and age in `useState`, and the breed picker
 * handed its choice back with `router.replace('/onboarding', { breedId })`.
 * A replace MOUNTS A NEW ONBOARDING SCREEN, so every one of those useState
 * hooks reinitialised to '' — the owner typed their dog's name, went to pick a
 * breed, came back to an empty name field and a disabled "Create profile"
 * button, with nothing on screen explaining why. It also pushed a second
 * onboarding entry onto the stack, so going back landed on a stale copy.
 *
 * Keeping the draft outside the component fixes both halves: the picker now
 * returns with `router.back()` (one screen, no remount) and reads/writes the
 * choice here, so nothing depends on the screen instance staying alive.
 *
 * Deliberately NOT persisted to disk. This is a few seconds of typing on the
 * way to creating a dog, not a record — once `createDog` succeeds the draft is
 * reset and the store goes back to being empty.
 */

import { create } from 'zustand';
import type { BreedOption } from '@/constants/breeds';

type OnboardingDraftState = {
  name: string;
  age: string;
  breed: BreedOption | null;
  /** Free text that pairs with Mixed Breed / Other, never a breed name. */
  breedDesc: string;

  setName: (name: string) => void;
  setAge: (age: string) => void;
  /** Called by the breed picker on its way back to onboarding. */
  setBreed: (breed: BreedOption | null, description: string) => void;
  reset: () => void;
};

const EMPTY = { name: '', age: '', breed: null, breedDesc: '' } as const;

export const useOnboardingDraft = create<OnboardingDraftState>((set) => ({
  ...EMPTY,

  setName: (name) => set({ name }),
  setAge: (age) => set({ age }),
  setBreed: (breed, description) => set({ breed, breedDesc: description }),
  reset: () => set({ ...EMPTY }),
}));
