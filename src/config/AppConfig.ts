// App-level constants (invariant across dev/prod).
// Env-specific values (DB URI, ports, keys) live in /config/*.json via node-config.

// The two constants below mirror onesatclient/config/AppConfig.ts — keep in sync.
// When you change a value on one side, update the other in the same commit.
export const MIN_SATS_PER_VOTE_FLOOR = 1
export const MAX_SATS_PER_VOTE_CEILING = 100_000_000

export const MAX_TITLE_LENGTH = 100
export const MAX_DESCRIPTION_LENGTH = 1000

// DEV ONLY — see README TODO #9. Toggle to true to run the campaign-status
// cron locally during testing (published → active when startingDate reached,
// active → ended when endingDate passed). In production this flag should be
// removed and the cron always-on.
export const STATUS_CRON_ENABLED = false
export const STATUS_CRON_INTERVAL_MS = 60_000 // 1 minute
