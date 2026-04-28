// App-level constants (invariant across dev/prod).
// Env-specific values (DB URI, ports, keys) live in /config/*.json via node-config.

// The two constants below mirror onesatclient/config/AppConfig.ts — keep in sync.
// When you change a value on one side, update the other in the same commit.
export const MIN_SATS_PER_VOTE_FLOOR = 1
export const MAX_SATS_PER_VOTE_CEILING = 100_000_000

export const MAX_TITLE_LENGTH = 100
export const MAX_DESCRIPTION_LENGTH = 1000

// Campaign date constraints — anti-spam / anti-DoS bounds.
// Max scheduling horizon: startingDate ≤ now + 6 months.
// Caps how far in the future a campaign can be scheduled.
// keep in sync with onesatclient/config/AppConfig.ts
export const MAX_CAMPAIGN_START_AHEAD_MS = 182 * 24 * 60 * 60 * 1000

// Max campaign duration: endingDate ≤ startingDate + 1 year.
// Prevents accidental / abusive multi-year campaigns.
// keep in sync with onesatclient/config/AppConfig.ts
export const MAX_CAMPAIGN_DURATION_MS = 365 * 24 * 60 * 60 * 1000

// Min campaign duration: endingDate ≥ startingDate + 5 minutes.
// Prevents race conditions with the status cron (60s polling) and rejects
// accidental same-minute campaigns (typo, dates rounded to same minute).
// keep in sync with onesatclient/config/AppConfig.ts
export const MIN_CAMPAIGN_DURATION_MS = 5 * 60 * 1000

// Tolerate up to 1 minute of clock skew between client and server when checking
// "starting date must be now or in the future".
// keep in sync with onesatclient/config/AppConfig.ts
export const STARTING_DATE_GRACE_MS = 60_000

// Username — display name shown in profile, mentions, etc.
// keep in sync with onesatclient/config/AppConfig.ts
export const MIN_USERNAME_LENGTH = 3
export const MAX_USERNAME_LENGTH = 30

// Allowed characters: alphanumeric, underscore, dash. No spaces, no emoji,
// no Unicode (homoglyph protection — cyrillic 'а' vs latin 'a' etc.).
export const USERNAME_CHARSET_REGEX = /^[a-zA-Z0-9_-]+$/

// Reserved usernames that no user can register (case-insensitive match).
// Add more as the product grows.
export const RESERVED_USERNAMES = [
  'admin', 'administrator', 'root', 'system',
  'support', 'help', 'api',
  'null', 'undefined',
  // Brand / product names — protect against impersonation and dilution.
  'osov', 'onesat', 'onesatonevote', 'bitcoin', 'satoshi',
]

// Email — defense-in-depth against malformed payloads. Firebase already validates
// the email at createUserWithEmailAndPassword, but the GraphQL signup mutation is
// independent of Firebase: an attacker (or a buggy client) could submit a different
// or malformed email. Server re-validates regardless.
//
// 254 chars = RFC 5321 hard limit on the entire address (local-part 64 + @ + domain 255 - 1).
// keep in sync with onesatclient/config/AppConfig.ts
export const MAX_EMAIL_LENGTH = 254

// Pragmatic email regex: <something-without-spaces-or-@>@<something>.<something>.
// Not full RFC 5322 (which is a nightmare and rejects valid addresses anyway) —
// matches what HTML5 `input type="email"` does.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// DEV ONLY — see README TODO #9. Toggle to true to run the campaign-status
// cron locally during testing (published → active when startingDate reached,
// active → ended when endingDate passed). In production this flag should be
// removed and the cron always-on.
export const STATUS_CRON_ENABLED = false
export const STATUS_CRON_INTERVAL_MS = 60_000 // 1 minute
