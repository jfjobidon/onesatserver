// Mirror of the test cases in onesatclient/docs/specs-for-server.md
// (section "signup — username validation"). When you add a case there,
// add it here too — the table is the source of truth.
import { describe, it, expect } from 'vitest'
import { validateUsername } from './userBounds.js'
import { MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH } from '../config/AppConfig.js'

describe('validateUsername', () => {
  // Case #1 — happy path lowercase
  it('returns null for a valid lowercase username', () => {
    expect(validateUsername('jfjobidon')).toBeNull()
  })

  // Case #2 — mixed case is allowed (casing is preserved at storage)
  it('returns null for a mixed-case username', () => {
    expect(validateUsername('JFjobidon')).toBeNull()
  })

  // Case #3 — allowed special chars
  it('returns null for letters + digits + underscore + dash', () => {
    expect(validateUsername('a_b-9')).toBeNull()
  })

  // Case #4 — null
  it('returns "Username is required" for null', () => {
    expect(validateUsername(null)).toBe('Username is required')
  })

  // Case #5 — undefined
  it('returns "Username is required" for undefined', () => {
    expect(validateUsername(undefined)).toBe('Username is required')
  })

  // Case #6 — empty string
  it('returns "Username is required" for empty string', () => {
    expect(validateUsername('')).toBe('Username is required')
  })

  // Case #7 — whitespace only (trim makes it empty)
  it('returns "Username is required" for whitespace only', () => {
    expect(validateUsername('   ')).toBe('Username is required')
  })

  // Case #8 — too short (length 2)
  it('returns length-min error when below MIN_USERNAME_LENGTH', () => {
    expect(validateUsername('jf')).toBe(
      `Username must be at least ${MIN_USERNAME_LENGTH} characters`,
    )
  })

  // Case #9 — exactly at MIN length boundary
  it('returns null at exact MIN_USERNAME_LENGTH boundary', () => {
    expect(validateUsername('jfj')).toBeNull()
  })

  // Case #10 — exactly at MAX length boundary
  it('returns null at exact MAX_USERNAME_LENGTH boundary', () => {
    expect(validateUsername('a'.repeat(MAX_USERNAME_LENGTH))).toBeNull()
  })

  // Case #11 — 1 char over MAX
  it('returns length-max error when above MAX_USERNAME_LENGTH', () => {
    expect(validateUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toBe(
      `Username must be at most ${MAX_USERNAME_LENGTH} characters`,
    )
  })

  // Case #12 — space inside
  it('rejects username containing a space', () => {
    expect(validateUsername('jf jobidon')).toBe(
      'Username can only contain letters, numbers, underscore (_) and dash (-)',
    )
  })

  // Case #13 — disallowed special char
  it('rejects username containing @', () => {
    expect(validateUsername('jf@gmail')).toBe(
      'Username can only contain letters, numbers, underscore (_) and dash (-)',
    )
  })

  // Case #14 — accented Unicode
  it('rejects username with accented characters (homoglyph protection)', () => {
    expect(validateUsername('jfjöbidon')).toBe(
      'Username can only contain letters, numbers, underscore (_) and dash (-)',
    )
  })

  // Case #15 — reserved word lowercase
  it('rejects reserved username "admin"', () => {
    expect(validateUsername('admin')).toBe('This username is reserved')
  })

  // Case #16 — reserved word uppercase (case-insensitive match)
  it('rejects reserved username "ADMIN" (case-insensitive)', () => {
    expect(validateUsername('ADMIN')).toBe('This username is reserved')
  })

  // Case #17 — brand reserved
  it('rejects brand-reserved username "Bitcoin"', () => {
    expect(validateUsername('Bitcoin')).toBe('This username is reserved')
  })

  // Case #18 — leading/trailing whitespace is trimmed
  it('trims surrounding whitespace before validating', () => {
    expect(validateUsername('  jfjobidon  ')).toBeNull()
  })

  // Case #19 — non-string input (number)
  it('returns "Username is required" for non-string input', () => {
    expect(validateUsername(123 as any)).toBe('Username is required')
  })
})
