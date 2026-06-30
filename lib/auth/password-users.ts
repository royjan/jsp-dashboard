/**
 * Password-based dashboard users (small fixed allowlist).
 *
 * Passwords are NEVER stored in plaintext — only scrypt hashes (`scrypt$<saltHex>$<hashHex>`).
 * Verification runs in the Node runtime (login API route), not in middleware/Edge.
 * To add/rotate a user, regenerate the hash:
 *   node -e "const{scryptSync,randomBytes}=require('crypto');const s=randomBytes(16);console.log('scrypt$'+s.toString('hex')+'$'+scryptSync(PASSWORD,s,64).toString('hex'))"
 */
import { scryptSync, timingSafeEqual } from 'crypto'

export interface PasswordUser {
  email: string
  name: string
  hash: string
}

const USERS: PasswordUser[] = [
  {
    email: 'roy@jan.co.il',
    name: 'Roy',
    hash: 'scrypt$afa9eeb5881d6b86fb3674fc44257f5a$bf6fa09e667e6cbce51e34725a77806e96c8970938e095d0a44ad57f30005d8f43f5465da2c9cabb0927be3c0d04df57f0b7854d2ff419da51999d8b9c6e6c3b',
  },
  {
    email: 'avi@jan.co.il',
    name: 'Avi',
    hash: 'scrypt$6ed07317185128bbb9a8ec86ecbde11a$064b4bc18ecc12425e0b76aa11c92377d3b5a6f2e175b4d23161c2c6fea1c3eea902177e49d8e3dd9bfe678ae9f4fda6371028cfc865158b864b8cac6ec3daa9',
  },
]

/** Verify an email + password against the allowlist. Returns the user (sans hash) or null. */
export function verifyPassword(email: string, password: string): { email: string; name: string } | null {
  const e = (email || '').toLowerCase().trim()
  const u = USERS.find(x => x.email.toLowerCase() === e)
  if (!u || !password) return null
  const [, saltHex, hashHex] = u.hash.split('$')
  if (!saltHex || !hashHex) return null
  let derived: Buffer
  try {
    derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  } catch {
    return null
  }
  const expected = Buffer.from(hashHex, 'hex')
  if (derived.length !== expected.length || !timingSafeEqual(derived, expected)) return null
  return { email: u.email, name: u.name }
}
