// Mirror of onesatclient/utils/emailBounds.ts — keep in sync — update both in same commit.
// Reference pattern: userBounds.ts, satsBounds.ts, dateBounds.ts.
//
// Why this exists even though Firebase Auth validates email at sign-up:
//   - The GraphQL signup mutation is independent of Firebase. The server cannot assume
//     `userInput.email` came from a verified Firebase credential — it's just a string in
//     the payload.
//   - A buggy or malicious client could submit a malformed email (or one different from
//     the Firebase one). Defense in depth: revalidate at every trust boundary.
//
// This is a *format* check only. Uniqueness is enforced by the DB unique index on `email`.
import { MAX_EMAIL_LENGTH, EMAIL_REGEX } from '../config/AppConfig.js'

/**
 * Validates an email format. Returns an error message string, or null if valid.
 *
 * Pure function: no I/O. Order of checks defines the UX message priority.
 */
export const validateEmail = (raw: string | null | undefined): string | null => {
  if (raw == null || typeof raw !== 'string') return 'Email is required'
  const value = raw.trim()
  if (value.length === 0) return 'Email is required'
  if (value.length > MAX_EMAIL_LENGTH) {
    return `Email must be at most ${MAX_EMAIL_LENGTH} characters`
  }
  if (!EMAIL_REGEX.test(value)) {
    return 'Email format is invalid'
  }
  return null
}
