/**
 * Encryption for ArchView source client secrets.
 *
 * A source's OAuth client secret is stored in MongoDB, so it is encrypted at
 * rest with AES-256-GCM. Every value gets its own random 12-byte IV; the tag
 * makes a changed or truncated value fail closed. The key is the 32-byte
 * `ARCHVIEW_SECRET_KEY` environment variable, base64 encoded:
 *
 *     openssl rand -base64 32
 *
 * The stored form is `v1.<iv>.<tag>.<ciphertext>`, all base64. The version
 * prefix leaves room for a future key rotation without guessing at the format.
 *
 * Errors name the missing or invalid setting but never include the secret or
 * the key, so they are safe to log.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const VERSION = 'v1'

type SecretEnv = {
  ARCHVIEW_SECRET_KEY?: string
  [key: string]: string | undefined
}

export class ArchviewSecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchviewSecretError'
  }
}

const readKey = (env: SecretEnv = process.env): Buffer => {
  const raw = typeof env.ARCHVIEW_SECRET_KEY === 'string' ? env.ARCHVIEW_SECRET_KEY.trim() : ''
  if (!raw) {
    throw new ArchviewSecretError(
      'ARCHVIEW_SECRET_KEY is not set. Generate one with `openssl rand -base64 32` and configure it before storing or reading ArchView client secrets.',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new ArchviewSecretError(
      'ARCHVIEW_SECRET_KEY must be 32 bytes encoded as base64. Generate one with `openssl rand -base64 32`.',
    )
  }

  return key
}

/** True when `value` already has the envelope written by `encryptArchviewSecret`. */
export const isEncryptedArchviewSecret = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false
  }

  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts[0] === VERSION &&
    parts.slice(1).every((part) => part.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(part))
  )
}

/**
 * Encrypts a plaintext secret. An already-encrypted value is returned unchanged
 * so an update that carries the stored ciphertext through does not wrap it
 * twice.
 */
export const encryptArchviewSecret = (
  plaintext: string,
  env: SecretEnv = process.env,
): string => {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new ArchviewSecretError('Cannot store an empty ArchView client secret')
  }
  if (isEncryptedArchviewSecret(plaintext)) {
    return plaintext
  }

  const key = readKey(env)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    '.',
  )
}

/**
 * Decrypts a stored secret. A missing key, a tampered value, or a key that no
 * longer matches all throw `ArchviewSecretError`; nothing is ever returned as
 * plaintext on a failure.
 */
export const decryptArchviewSecret = (
  value: string,
  env: SecretEnv = process.env,
): string => {
  // Read the key first so a missing setting is reported as such even when the
  // stored value is malformed.
  const key = readKey(env)

  if (!isEncryptedArchviewSecret(value)) {
    throw new ArchviewSecretError(
      'The stored ArchView client secret is not encrypted. Re-save the source in the admin so it is stored with AES-256-GCM.',
    )
  }

  const [, ivPart, tagPart, ciphertextPart] = value.split('.')
  const iv = Buffer.from(ivPart, 'base64')
  const tag = Buffer.from(tagPart, 'base64')
  const ciphertext = Buffer.from(ciphertextPart, 'base64')

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new ArchviewSecretError('The stored ArchView client secret is malformed.')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new ArchviewSecretError(
      'Unable to decrypt the ArchView client secret. Check that ARCHVIEW_SECRET_KEY has not changed.',
    )
  }
}
