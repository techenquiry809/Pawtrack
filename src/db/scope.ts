/**
 * Who the rows on this phone belong to.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────
 *
 * One phone can hold rows for more than one account over its life: someone
 * signs out and a partner signs in, or a device is handed on. Every read has
 * to be fenced to the signed-in user, or one person's veterinary records show
 * up under another's name.
 *
 * ── WHY NOT WIPE ON SIGN-OUT INSTEAD ──────────────────────────────────
 *
 * Because sign-out is not a statement about the data. An owner who signs out
 * to help a friend log in should not lose their dog's history, and a phone
 * with an undrained outbox must not throw those records away. Filtering means
 * the first user's rows survive for when they sign back in, and the second
 * user sees their own.
 *
 * Wiping is a separate, explicit action — "Remove this account's data from
 * this phone" — which also deletes the video FILES, because those exist
 * nowhere else. See src/services/sync/localData.ts.
 *
 * ── THE THREE STATES ──────────────────────────────────────────────────
 *
 *   signed out       user_id IS NULL   rows not yet claimed by any account
 *   signed in as U   user_id = 'U'     that account's rows
 *   (never)          both              see below
 *
 * Unclaimed rows are deliberately NOT visible to a signed-in user. They become
 * visible by being CLAIMED, which is a decision the owner makes once, with the
 * two dogs named in front of them — see src/services/sync/claim.ts. Silently
 * folding stray rows into whoever signs in next is how one account ends up
 * holding another animal's seizure history.
 */

/**
 * Module-level rather than in the Zustand store on purpose. Repositories are
 * plain async functions called from services and effects that have no React
 * context, and threading a user id through every signature would put an
 * ownership concern into forty call sites that do not otherwise care.
 *
 * src/store/authStore.ts is the only writer.
 */
let activeUserId: string | null = null;

export function setActiveUserId(userId: string | null): void {
  activeUserId = userId;
}

export type Scope = { sql: string; params: string[] };

/**
 * The ownership predicate for a read, ready to concatenate into a WHERE.
 *
 * Always returns a real predicate — never an empty string — so a caller cannot
 * accidentally build `WHERE  AND foo = ?`, and more importantly so that
 * forgetting to interpolate it produces a syntax error rather than a query
 * that quietly returns everyone's rows.
 */
export function ownerScope(alias?: string): Scope {
  const column = alias ? `${alias}.user_id` : 'user_id';
  return activeUserId === null
    ? { sql: `${column} IS NULL`, params: [] }
    : { sql: `${column} = ?`, params: [activeUserId] };
}

/**
 * The owner to stamp on a NEW row.
 *
 * Null while signed out, which is correct and is what the claim flow later
 * resolves. A row written offline before anyone has signed in is not
 * ownerless by accident; it is ownerless because nobody has said who owns it.
 */
export function newRowOwner(): string | null {
  return activeUserId;
}
