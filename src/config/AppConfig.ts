// App-level constants (invariant across dev/prod).
// Env-specific values (DB URI, ports, keys) live in /config/*.json via node-config.
export const MIN_SATS_PER_VOTE_FLOOR = 1
export const MAX_SATS_PER_VOTE_CEILING = 100_000_000

export const MAX_TITLE_LENGTH = 100
export const MAX_DESCRIPTION_LENGTH = 1000
