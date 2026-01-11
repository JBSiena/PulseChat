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
}

export function signAccessToken(user: DbUser) {
  const secret = getJwtSecret()
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    displayName: user.display_name,
  }
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): JwtPayload {
  const secret = getJwtSecret()
  return jwt.verify(token, secret) as JwtPayload
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload
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
    const decoded = jwt.verify(token, secret) as JwtPayload
    req.user = decoded
    return next()
  } catch (error) {
    console.error('Failed to verify JWT', error)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
