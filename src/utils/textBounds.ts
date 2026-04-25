import { MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '../config/AppConfig.js'

// Trim and collapse internal whitespace runs to a single space.
// Used for both storage (so the DB never holds "Round  1" with 2 spaces)
// and uniqueness comparison (after .toLowerCase()).
export const normalizeText = (value: string | null | undefined): string => {
  if (value == null) return ''
  return value.trim().replace(/\s+/g, ' ')
}

export const validateTitle = (value: string | null | undefined): string | null => {
  if (value == null || value.trim() === '') return 'Title is required'
  if (value.length > MAX_TITLE_LENGTH) {
    return `Title must be at most ${MAX_TITLE_LENGTH} characters`
  }
  return null
}

export const validateDescription = (value: string | null | undefined): string | null => {
  if (value == null || value.trim() === '') return 'Description is required'
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    return `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`
  }
  return null
}
