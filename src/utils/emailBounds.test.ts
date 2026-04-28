// Mirror of the test cases in onesatclient/docs/specs-for-server.md
// (section "signup — username validation"). When you add a case there,
// add it here too — the table is the source of truth.
import { describe, it, expect } from 'vitest'
import { validateEmail } from './emailBounds.js'
import { MAX_EMAIL_LENGTH } from '../config/AppConfig.js'

describe('validateEmail', () => {
  // Case #1 — happy path
  it('returns null for a typical valid email', () => {
    expect(validateEmail('alice@example.com')).toBeNull()
  })

  // Case #2 — common subdomains and TLDs
  it('returns null for emails with subdomains', () => {
    expect(validateEmail('user@mail.example.co.uk')).toBeNull()
  })

  // Case #3 — local-part with allowed special chars
  it('returns null for local-part with + and . and _', () => {
    expect(validateEmail('alice.smith+tag_42@example.com')).toBeNull()
  })

  // Case #4 — null
  it('returns "Email is required" for null', () => {
    expect(validateEmail(null)).toBe('Email is required')
  })

  // Case #5 — undefined
  it('returns "Email is required" for undefined', () => {
    expect(validateEmail(undefined)).toBe('Email is required')
  })

  // Case #6 — empty string
  it('returns "Email is required" for empty string', () => {
    expect(validateEmail('')).toBe('Email is required')
  })

  // Case #7 — whitespace only (trim makes it empty)
  it('returns "Email is required" for whitespace only', () => {
    expect(validateEmail('   ')).toBe('Email is required')
  })

  // Case #8 — leading/trailing whitespace is trimmed before validating
  it('trims surrounding whitespace before validating', () => {
    expect(validateEmail('  alice@example.com  ')).toBeNull()
  })

  // Case #9 — missing @
  it('rejects an address without @', () => {
    expect(validateEmail('aliceexample.com')).toBe('Email format is invalid')
  })

  // Case #10 — missing dot in domain
  it('rejects a domain without a dot (no TLD)', () => {
    expect(validateEmail('alice@example')).toBe('Email format is invalid')
  })

  // Case #11 — space inside
  it('rejects an address containing a space', () => {
    expect(validateEmail('alice @example.com')).toBe('Email format is invalid')
  })

  // Case #12 — multiple @
  it('rejects an address with multiple @ signs', () => {
    expect(validateEmail('alice@@example.com')).toBe('Email format is invalid')
  })

  // Case #13 — empty local part
  it('rejects an address with empty local part', () => {
    expect(validateEmail('@example.com')).toBe('Email format is invalid')
  })

  // Case #14 — empty domain
  it('rejects an address with empty domain', () => {
    expect(validateEmail('alice@')).toBe('Email format is invalid')
  })

  // Case #15 — too long (over MAX_EMAIL_LENGTH after trim)
  it('rejects an address longer than MAX_EMAIL_LENGTH', () => {
    // Build a syntactically valid but too-long address: many a's + @example.com
    const localPart = 'a'.repeat(MAX_EMAIL_LENGTH - '@example.com'.length + 1)
    const tooLong = `${localPart}@example.com`
    expect(tooLong.length).toBe(MAX_EMAIL_LENGTH + 1) // sanity
    expect(validateEmail(tooLong)).toBe(
      `Email must be at most ${MAX_EMAIL_LENGTH} characters`,
    )
  })

  // Case #16 — exactly at MAX boundary
  it('returns null at exact MAX_EMAIL_LENGTH boundary', () => {
    const localPart = 'a'.repeat(MAX_EMAIL_LENGTH - '@example.com'.length)
    const exact = `${localPart}@example.com`
    expect(exact.length).toBe(MAX_EMAIL_LENGTH) // sanity
    expect(validateEmail(exact)).toBeNull()
  })

  // Case #17 — non-string input
  it('returns "Email is required" for non-string input', () => {
    expect(validateEmail(123 as any)).toBe('Email is required')
  })

  // Case #18 — uppercase is allowed (server lowercases later, the regex doesn't care)
  it('accepts uppercase emails (server lowercases at storage)', () => {
    expect(validateEmail('Alice@Example.COM')).toBeNull()
  })
})
