// Mirror of onesatclient/utils/satsBounds.ts — keep in sync.
// When you change this validator on one side, update the other in the same commit.
import { MIN_SATS_PER_VOTE_FLOOR, MAX_SATS_PER_VOTE_CEILING } from '../config/AppConfig.js'

export const validateSatsMin = (label: string, value: number | null | undefined): string | null => {
  if (value == null || !Number.isInteger(value) || value < MIN_SATS_PER_VOTE_FLOOR) {
    return `${label} must be at least ${MIN_SATS_PER_VOTE_FLOOR} sat`
  }
  if (value > MAX_SATS_PER_VOTE_CEILING) {
    return `${label} must be at most ${MAX_SATS_PER_VOTE_CEILING.toLocaleString()} sats (1 BTC)`
  }
  return null
}

export const validateSatsMax = (label: string, value: number | null | undefined): string | null => {
  if (value == null || !Number.isInteger(value)) return `${label} is invalid`
  if (value > MAX_SATS_PER_VOTE_CEILING) {
    return `${label} must be at most ${MAX_SATS_PER_VOTE_CEILING.toLocaleString()} sats (1 BTC)`
  }
  return null
}
