import crypto from 'crypto'
import pg from 'pg'

const { Pool } = pg

const connectionString = process.env.DATABASE_URL

const pool = new Pool({
  connectionString,
})

export interface StoredConversation {
  id: string
  type: string
  title: string | null
  slug: string | null
  is_public: boolean
  created_by: string | null
  participant_role?: string | null
}

export interface StoredMessage {
  id: number
  room: string
  username: string
  message: string
  created_at: Date
  user_id: string | null
  reply_to_message_id: number | null
  edited_at: Date | null
  deleted_at: Date | null
  deleted_by: string | null
}

export interface StoredMessageAttachment {
  id: number
  message_id: number | null
  uploader_user_id: string | null
  url: string
  public_id: string
  mime_type: string | null
  file_size: number | null
  original_filename: string | null
  created_at: Date
}

export interface StoredMessageReaction {
  message_id: number
  user_id: string
  emoji: string
}

export interface StoredReadReceipt {
  id: number
  room: string
  user_id: string
  last_read_message_id: number
  updated_at: Date
}

export interface StoredUnreadCountRow {
  room: string
  unread_count: number
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      avatar_url TEXT,
      status TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      global_role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS global_role TEXT NOT NULL DEFAULT 'member';

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_account_id)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id UUID PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      slug TEXT UNIQUE,
      is_public BOOLEAN NOT NULL DEFAULT false,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id BIGSERIAL PRIMARY KEY,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS reply_to_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS message_attachments (
      id SERIAL PRIMARY KEY,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      uploader_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      public_id TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      original_filename TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (message_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      id SERIAL PRIMARY KEY,
      room TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (room, user_id)
    );

    CREATE TABLE IF NOT EXISTS friends (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, friend_user_id)
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, blocked_user_id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail) {
    await pool.query(
      `UPDATE users
       SET global_role = 'superadmin'
       WHERE LOWER(email) = LOWER($1)
         AND global_role <> 'superadmin'`,
      [adminEmail],
    )
  }
}

export interface ChannelMemberRow {
  user_id: string
  email: string
  display_name: string
  role: string
}

export async function getChannelMembers(channelId: string): Promise<ChannelMemberRow[]> {
  const result = await pool.query<ChannelMemberRow>(
    `SELECT cp.user_id,
            u.email,
            u.display_name,
            cp.role
     FROM conversation_participants cp
     JOIN users u ON u.id = cp.user_id
     WHERE cp.conversation_id = $1
     ORDER BY u.display_name ASC`,
    [channelId],
  )

  return result.rows
}

export async function removeUserFromChannel(params: {
  channelId: string
  userId: string
}): Promise<void> {
  const { channelId, userId } = params
  await pool.query(
    `DELETE FROM conversation_participants
     WHERE conversation_id = $1 AND user_id = $2`,
    [channelId, userId],
  )
}

export async function deleteChannelById(channelId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM conversations
     WHERE id = $1
       AND type = 'channel'`,
    [channelId],
  )

  return (result.rowCount ?? 0) > 0
}

export async function createChannelForUser(params: {
  userId: string
  name: string
}): Promise<StoredConversation> {
  const { userId, name } = params

  const id = crypto.randomUUID()
  const title = name.trim()

  const created = await pool.query<StoredConversation>(
    `INSERT INTO conversations (id, type, title, slug, is_public, created_by)
     VALUES ($1, 'channel', $2, $3, $4, $5)
     RETURNING id, type, title, slug, is_public, created_by`,
    [id, title, null, false, userId],
  )

  await pool.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [id, userId],
  )

  return created.rows[0]
}

export async function getChannelsForUser(userId: string): Promise<StoredConversation[]> {
  const result = await pool.query<StoredConversation>(
    `SELECT c.id,
            c.type,
            c.title,
            c.slug,
            c.is_public,
            c.created_by,
            cp.role AS participant_role
     FROM conversations c
     JOIN conversation_participants cp
       ON cp.conversation_id = c.id
     WHERE c.type = 'channel'
       AND cp.user_id = $1
     ORDER BY c.created_at ASC`,
    [userId],
  )

  return result.rows
}

export async function getChannelParticipantRole(params: {
  channelId: string
  userId: string
}): Promise<string | null> {
  const { channelId, userId } = params
  const result = await pool.query<{ role: string }>(
    `SELECT role
     FROM conversation_participants
     WHERE conversation_id = $1
       AND user_id = $2`,
    [channelId, userId],
  )

  const row = result.rows[0]
  return row ? row.role : null
}

export async function addUserToChannel(params: {
  channelId: string
  userId: string
}): Promise<void> {
  const { channelId, userId } = params
  await pool.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [channelId, userId],
  )
}

export async function saveMessage(params: {
  room: string
  username: string
  message: string
  userId?: string
  replyToMessageId?: number | null
}) {
  const { room, username, message, userId, replyToMessageId } = params
  const result = await pool.query<StoredMessage>(
    'INSERT INTO messages (room, username, message, user_id, reply_to_message_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [room, username, message, userId ?? null, replyToMessageId ?? null],
  )
  return result.rows[0]
}

export async function getMessagesForRoom(room: string, limit = 50) {
  const result = await pool.query<StoredMessage>(
    'SELECT id, room, username, message, created_at, user_id, reply_to_message_id, edited_at, deleted_at, deleted_by FROM messages WHERE room = $1 ORDER BY created_at DESC LIMIT $2',
    [room, limit],
  )
  // Return messages in ascending chronological order for the UI, while still
  // limiting to the most recent `limit` messages.
  return result.rows.reverse()
}

export async function getAttachmentsForMessages(
  messageIds: number[],
): Promise<StoredMessageAttachment[]> {
  if (messageIds.length === 0) return []

  const result = await pool.query<StoredMessageAttachment>(
    `SELECT id,
            message_id,
            uploader_user_id,
            url,
            public_id,
            mime_type,
            file_size,
            original_filename,
            created_at
     FROM message_attachments
     WHERE message_id = ANY($1)`,
    [messageIds],
  )

  return result.rows
}

export async function getReadReceiptsForRoom(room: string): Promise<StoredReadReceipt[]> {
  const result = await pool.query<StoredReadReceipt>(
    `SELECT id, room, user_id, last_read_message_id, updated_at
     FROM message_reads
     WHERE room = $1`,
    [room],
  )
  return result.rows
}

export async function blockUserForUser(params: {
  userId: string
  blockedUserId: string
}): Promise<void> {
  const { userId, blockedUserId } = params
  await pool.query(
    `INSERT INTO blocked_users (user_id, blocked_user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
    [userId, blockedUserId],
  )
}

export async function unblockUserForUser(params: {
  userId: string
  blockedUserId: string
}): Promise<void> {
  const { userId, blockedUserId } = params
  await pool.query(
    `DELETE FROM blocked_users
     WHERE user_id = $1 AND blocked_user_id = $2`,
    [userId, blockedUserId],
  )
}

export async function getBlockedUsersForUser(userId: string): Promise<DbUser[]> {
  const result = await pool.query<DbUser>(
    `SELECT u.id,
            u.email,
            u.display_name,
            u.password_hash,
            u.avatar_url,
            u.status,
            u.email_verified,
            u.global_role,
            u.created_at,
            u.updated_at
     FROM blocked_users b
     JOIN users u ON b.blocked_user_id = u.id
     WHERE b.user_id = $1
     ORDER BY u.display_name ASC`,
    [userId],
  )
  return result.rows
}

export interface PasswordResetTokenRow {
  id: number
  user_id: string
  token: string
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

export async function createPasswordResetTokenForUser(params: {
  userId: string
  expiresInMinutes?: number
}): Promise<PasswordResetTokenRow> {
  const { userId, expiresInMinutes = 60 } = params
  const int = crypto.randomInt(0, 1_000_000)
  const token = int.toString().padStart(6, '0')
  const result = await pool.query<PasswordResetTokenRow>(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
     RETURNING id, user_id, token, expires_at, used_at, created_at`,
    [userId, token, String(expiresInMinutes)],
  )
  return result.rows[0]
}

export async function findValidPasswordResetToken(
  token: string,
): Promise<PasswordResetTokenRow | null> {
  const result = await pool.query<PasswordResetTokenRow>(
    `SELECT id, user_id, token, expires_at, used_at, created_at
     FROM password_reset_tokens
     WHERE token = $1
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [token],
  )
  return result.rows[0] ?? null
}

export async function createMessageAttachments(params: {
  uploaderUserId: string
  uploads: {
    url: string
    publicId: string
    mimeType?: string | null
    fileSize?: number | null
    originalFilename?: string | null
  }[]
}): Promise<StoredMessageAttachment[]> {
  const { uploaderUserId, uploads } = params
  if (uploads.length === 0) return []

  const values: (string | number | null)[] = []
  const placeholders: string[] = []

  uploads.forEach((upload, index) => {
    const baseIndex = index * 6
    placeholders.push(
      `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`,
    )
    values.push(
      uploaderUserId,
      upload.url,
      upload.publicId,
      upload.mimeType ?? null,
      upload.fileSize ?? null,
      upload.originalFilename ?? null,
    )
  })

  const result = await pool.query<StoredMessageAttachment>(
    `INSERT INTO message_attachments (
       uploader_user_id,
       url,
       public_id,
       mime_type,
       file_size,
       original_filename
     )
     VALUES ${placeholders.join(', ')}
     RETURNING id,
               message_id,
               uploader_user_id,
               url,
               public_id,
               mime_type,
               file_size,
               original_filename,
               created_at`,
    values,
  )

  return result.rows
}

export async function assignAttachmentsToMessage(params: {
  attachmentIds: number[]
  messageId: number
  userId: string
}): Promise<StoredMessageAttachment[]> {
  const { attachmentIds, messageId, userId } = params
  if (attachmentIds.length === 0) return []

  const result = await pool.query<StoredMessageAttachment>(
    `UPDATE message_attachments
     SET message_id = $1
     WHERE id = ANY($2)
       AND uploader_user_id = $3
       AND message_id IS NULL
     RETURNING id,
               message_id,
               uploader_user_id,
               url,
               public_id,
               mime_type,
               file_size,
               original_filename,
               created_at`,
    [messageId, attachmentIds, userId],
  )

  return result.rows
}

export async function markPasswordResetTokenUsed(id: number): Promise<void> {
  await pool.query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE id = $1`,
    [id],
  )
}

export interface EmailVerificationCodeRow {
  id: number
  user_id: string
  code: string
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

export async function createEmailVerificationCodeForUser(params: {
  userId: string
  expiresInMinutes?: number
}): Promise<EmailVerificationCodeRow> {
  const { userId, expiresInMinutes = 15 } = params
  const int = crypto.randomInt(0, 1_000_000)
  const code = int.toString().padStart(6, '0')
  const result = await pool.query<EmailVerificationCodeRow>(
    `INSERT INTO email_verification_codes (user_id, code, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)
     RETURNING id, user_id, code, expires_at, used_at, created_at`,
    [userId, code, String(expiresInMinutes)],
  )
  return result.rows[0]
}

export async function findValidEmailVerificationCodeForUser(params: {
  userId: string
  code: string
}): Promise<EmailVerificationCodeRow | null> {
  const { userId, code } = params
  const result = await pool.query<EmailVerificationCodeRow>(
    `SELECT id, user_id, code, expires_at, used_at, created_at
     FROM email_verification_codes
     WHERE user_id = $1
       AND code = $2
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [userId, code],
  )
  return result.rows[0] ?? null
}

export async function markEmailVerificationCodeUsed(id: number): Promise<void> {
  await pool.query(
    `UPDATE email_verification_codes
     SET used_at = NOW()
     WHERE id = $1`,
    [id],
  )
}

export async function upsertReadReceipt(params: {
  room: string
  userId: string
  lastReadMessageId: number
}): Promise<StoredReadReceipt> {
  const { room, userId, lastReadMessageId } = params
  const result = await pool.query<StoredReadReceipt>(
    `INSERT INTO message_reads (room, user_id, last_read_message_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (room, user_id)
     DO UPDATE SET last_read_message_id = GREATEST(message_reads.last_read_message_id, EXCLUDED.last_read_message_id),
                   updated_at = NOW()
     RETURNING id, room, user_id, last_read_message_id, updated_at`,
    [room, userId, lastReadMessageId],
  )
  return result.rows[0]
}

export async function getMessageCountForRoom(room: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM messages WHERE room = $1',
    [room],
  )
  const row = result.rows[0]
  return row ? Number.parseInt(row.count, 10) : 0
}

export async function getUnreadCountsForUser(
  userId: string,
): Promise<StoredUnreadCountRow[]> {
  const result = await pool.query<StoredUnreadCountRow>(
    `WITH last_reads AS (
       SELECT room, last_read_message_id
       FROM message_reads
       WHERE user_id = $1
     )
     SELECT m.room AS room,
            COUNT(*)::int AS unread_count
     FROM messages m
     LEFT JOIN last_reads lr
       ON lr.room = m.room
     WHERE (lr.last_read_message_id IS NULL OR m.id > lr.last_read_message_id)
       AND m.user_id IS DISTINCT FROM $1
       AND m.deleted_at IS NULL
     GROUP BY m.room`,
    [userId],
  )
  return result.rows
}

export async function getMentionUnreadCountsForUser(
  userId: string,
): Promise<StoredUnreadCountRow[]> {
  const result = await pool.query<StoredUnreadCountRow>(
    `WITH me AS (
       SELECT id, display_name
       FROM users
       WHERE id = $1
     ),
     last_reads AS (
       SELECT room, last_read_message_id
       FROM message_reads
       WHERE user_id = $1
     )
     SELECT m.room AS room,
            COUNT(*)::int AS unread_count
     FROM messages m
     JOIN me ON TRUE
     LEFT JOIN last_reads lr
       ON lr.room = m.room
     WHERE (lr.last_read_message_id IS NULL OR m.id > lr.last_read_message_id)
       AND m.user_id IS DISTINCT FROM $1
       AND m.deleted_at IS NULL
       AND m.message ILIKE '%' || '@' || me.display_name || '%'
     GROUP BY m.room`,
    [userId],
  )
  return result.rows
}

export async function getReactionsForMessages(messageIds: number[]) {
  if (messageIds.length === 0) return [] as StoredMessageReaction[]

  const result = await pool.query<StoredMessageReaction>(
    'SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id = ANY($1)',
    [messageIds],
  )
  return result.rows
}

export async function addReactionForUser(params: {
  messageId: number
  userId: string
  emoji: string
}): Promise<void> {
  const { messageId, userId, emoji } = params
  await pool.query(
    `INSERT INTO message_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
    [messageId, userId, emoji],
  )
}

export async function removeReactionForUser(params: {
  messageId: number
  userId: string
  emoji: string
}): Promise<void> {
  const { messageId, userId, emoji } = params
  await pool.query(
    'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
    [messageId, userId, emoji],
  )
}

export async function editMessageForUser(params: {
  messageId: number
  userId: string
  newContent: string
}): Promise<StoredMessage | null> {
  const { messageId, userId, newContent } = params
  const result = await pool.query<StoredMessage>(
    `UPDATE messages
     SET message = $1,
         edited_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [newContent, messageId, userId],
  )
  return result.rows[0] ?? null
}

export async function softDeleteMessageForUser(params: {
  messageId: number
  userId: string
}): Promise<StoredMessage | null> {
  const { messageId, userId } = params
  const result = await pool.query<StoredMessage>(
    `UPDATE messages
     SET deleted_at = NOW(),
         deleted_by = $1
     WHERE id = $2 AND user_id = $1
     RETURNING *`,
    [userId, messageId],
  )
  return result.rows[0] ?? null
}

export async function addFriendForUser(params: {
  userId: string
  friendUserId: string
}): Promise<void> {
  const { userId, friendUserId } = params
  await pool.query(
    `INSERT INTO friends (user_id, friend_user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
    [userId, friendUserId],
  )
}

export async function getFriendsForUser(userId: string): Promise<DbUser[]> {
  const result = await pool.query<DbUser>(
    `SELECT u.id,
            u.email,
            u.display_name,
            u.password_hash,
            u.avatar_url,
            u.status,
            u.email_verified,
            u.global_role,
            u.created_at,
            u.updated_at
     FROM friends f
     JOIN users u ON f.friend_user_id = u.id
     WHERE f.user_id = $1
     ORDER BY u.display_name ASC`,
    [userId],
  )
  return result.rows
}

export interface FeedbackRow {
  id: number
  user_id: string
  category: string | null
  message: string
  created_at: Date
}

export async function createFeedback(params: {
  userId: string
  category?: string | null
  message: string
}): Promise<FeedbackRow> {
  const { userId, category = null, message } = params
  const result = await pool.query<FeedbackRow>(
    `INSERT INTO feedback (user_id, category, message)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, category, message, created_at`,
    [userId, category, message],
  )
  return result.rows[0]
}

export interface FeedbackWithUserRow {
  id: number
  user_id: string
  user_email: string
  user_display_name: string
  category: string | null
  message: string
  created_at: Date
}

export async function getRecentFeedbackWithUsers(
  limit = 100,
): Promise<FeedbackWithUserRow[]> {
  const result = await pool.query<FeedbackWithUserRow>(
    `SELECT f.id,
            f.user_id,
            u.email AS user_email,
            u.display_name AS user_display_name,
            f.category,
            f.message,
            f.created_at
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

export interface DbUser {
  id: string
  email: string
  display_name: string
  password_hash: string | null
  avatar_url: string | null
  status: string | null
  email_verified: boolean
  global_role: string
  created_at: Date
  updated_at: Date
}

export async function updateUserPassword(params: {
  userId: string
  passwordHash: string
}): Promise<void> {
  const { userId, passwordHash } = params
  await pool.query(
    `UPDATE users
     SET password_hash = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, userId],
  )
}

export async function markUserEmailVerified(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET email_verified = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [userId],
  )
}

export async function updateUserProfile(params: {
  userId: string
  displayName?: string
  status?: string | null
  avatarUrl?: string | null
}): Promise<DbUser | null> {
  const { userId, displayName, status, avatarUrl } = params

  const setClauses: string[] = []
  const values: (string | null)[] = []

  if (displayName !== undefined) {
    setClauses.push('display_name = $' + (setClauses.length + 1))
    values.push(displayName)
  }

  if (status !== undefined) {
    setClauses.push('status = $' + (setClauses.length + 1))
    values.push(status)
  }

  if (avatarUrl !== undefined) {
    setClauses.push('avatar_url = $' + (setClauses.length + 1))
    values.push(avatarUrl)
  }

  if (setClauses.length === 0) {
    const existing = await getUserById(userId)
    return existing
  }

  setClauses.push('updated_at = NOW()')

  const result = await pool.query<DbUser>(
    `UPDATE users
     SET ${setClauses.join(', ')}
     WHERE id = $${values.length + 1}
     RETURNING id, email, display_name, password_hash, avatar_url, status, email_verified, global_role, created_at, updated_at`,
    [...values, userId],
  )

  return result.rows[0] ?? null
}

export interface OAuthAccount {
  id: number
  user_id: string
  provider: string
  provider_account_id: string
  created_at: Date
}

export async function createUser(params: {
  email: string
  displayName: string
  passwordHash: string | null
  avatarUrl?: string | null
}): Promise<DbUser> {
  const id = crypto.randomUUID()
  const { email, displayName, passwordHash, avatarUrl = null } = params
  const result = await pool.query<DbUser>(
    `INSERT INTO users (id, email, display_name, password_hash, avatar_url, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, display_name, password_hash, avatar_url, status, email_verified, global_role, created_at, updated_at`,
    [id, email, displayName, passwordHash, avatarUrl, null],
  )
  return result.rows[0]
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT id, email, display_name, password_hash, avatar_url, status, email_verified, global_role, created_at, updated_at
     FROM users
     WHERE email = $1`,
    [email],
  )
  return result.rows[0] ?? null
}

export async function findUserByDisplayName(displayName: string): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT id, email, display_name, password_hash, avatar_url, status, email_verified, global_role, created_at, updated_at
     FROM users
     WHERE LOWER(display_name) = LOWER($1)`,
    [displayName],
  )
  return result.rows[0] ?? null
}

export async function getUserById(id: string): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `SELECT id, email, display_name, password_hash, avatar_url, status, email_verified, global_role, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findOrCreateUserWithOAuth(params: {
  provider: string
  providerAccountId: string
  email: string
  displayName: string
}): Promise<DbUser> {
  const { provider, providerAccountId, email, displayName } = params

  const existingByAccount = await pool.query<DbUser>(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.avatar_url, u.email_verified, u.global_role, u.created_at, u.updated_at
     FROM oauth_accounts oa
     JOIN users u ON oa.user_id = u.id
     WHERE oa.provider = $1 AND oa.provider_account_id = $2`,
    [provider, providerAccountId],
  )
  if (existingByAccount.rows[0]) {
    return existingByAccount.rows[0]
  }

  const existingByEmail = await findUserByEmail(email)
  const user =
    existingByEmail ?? (await createUser({ email, displayName, passwordHash: null }))

  await pool.query<OAuthAccount>(
    `INSERT INTO oauth_accounts (user_id, provider, provider_account_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
    [user.id, provider, providerAccountId],
  )

  return user
}
