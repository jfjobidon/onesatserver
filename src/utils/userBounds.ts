// Mirror of onesatclient/utils/userBounds.ts — keep in sync — update both in same commit
// Reference pattern: satsBounds.ts, dateBounds.ts.
import {
  MIN_USERNAME_LENGTH,
  MAX_USERNAME_LENGTH,
  USERNAME_CHARSET_REGEX,
  RESERVED_USERNAMES,
} from '../config/AppConfig.js'

/**
 * Validates a username (format only — uniqueness is enforced by the DB
 * unique index on userName/userNameLower). Returns an error message string,
 * or null if valid.
 *
 * Pure function: no I/O. Order of checks defines the UX message priority.
 */
export const validateUsername = (raw: string | null | undefined): string | null => {
  if (raw == null || typeof raw !== 'string') return 'Username is required'
  const value = raw.trim()
  if (value.length === 0) return 'Username is required'
  if (value.length < MIN_USERNAME_LENGTH) {
    return `Username must be at least ${MIN_USERNAME_LENGTH} characters`
  }
  if (value.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters`
  }
  if (!USERNAME_CHARSET_REGEX.test(value)) {
    return 'Username can only contain letters, numbers, underscore (_) and dash (-)'
  }
  if (RESERVED_USERNAMES.includes(value.toLowerCase())) {
    return 'This username is reserved'
  }
  return null
}
