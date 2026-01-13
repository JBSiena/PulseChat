import type { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { DbUser } from './db'

const JWT_EXPIRES_IN = '7d'

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  return secret
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export interface JwtPayload {
  sub: string
  email: string
  displayName: string
  globalRole: string
}

export function signAccessToken(user: DbUser) {
  const secret = getJwtSecret()
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    displayName: user.display_name,
    globalRole: user.global_role,
  }
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN })
}

const GLOBAL_ROLE_RANK: Record<string, number> = {
  guest: 0,
  member: 1,
  moderator: 2,
  admin: 3,
  superadmin: 4,
}

export type GlobalRole = keyof typeof GLOBAL_ROLE_RANK

export function hasGlobalRoleAtLeast(
  role: string | null | undefined,
  required: GlobalRole,
): boolean {
  const normalized = (role ?? 'member').toLowerCase()
  const currentRank = GLOBAL_ROLE_RANK[normalized] ?? GLOBAL_ROLE_RANK.member
  const requiredRank = GLOBAL_ROLE_RANK[required]
  return currentRank >= requiredRank
}

export function verifyToken(token: string): JwtPayload {
  const secret = getJwtSecret()
  return jwt.verify(token, secret) as JwtPayload
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload & { sub: string }
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' })
  }

  const token = header.slice('Bearer '.length)

  try {
    const secret = getJwtSecret()
    const decodedAny = jwt.verify(token, secret) as JwtPayload & {
      globalRole?: string
    }
    const decoded: JwtPayload = {
      sub: decodedAny.sub,
      email: decodedAny.email,
      displayName: decodedAny.displayName,
      globalRole: decodedAny.globalRole ?? 'member',
    }
    req.user = decoded
    return next()
  } catch (error) {
    console.error('Failed to verify JWT', error)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
