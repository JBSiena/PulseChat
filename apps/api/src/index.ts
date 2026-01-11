import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import 'dotenv/config'
import {
  createUser,
  findOrCreateUserWithOAuth,
  findUserByEmail,
  getMessagesForRoom,
  getUserById,
  initDb,
  saveMessage,
  addFriendForUser,
  getFriendsForUser,
  editMessageForUser,
  softDeleteMessageForUser,
  getReactionsForMessages,
  addReactionForUser,
  removeReactionForUser,
  getReadReceiptsForRoom,
  upsertReadReceipt,
  getMessageCountForRoom,
  getUnreadCountsForUser,
  getMentionUnreadCountsForUser,
  createChannelForUser,
  getChannelsForUser,
  addUserToChannel,
  createFeedback,
  getRecentFeedbackWithUsers,
  createPasswordResetTokenForUser,
  findValidPasswordResetToken,
  markPasswordResetTokenUsed,
  updateUserPassword,
  type StoredMessage,
} from './db'
import {
  authMiddleware,
  hashPassword,
  signAccessToken,
  verifyPassword,
  verifyToken,
  type AuthenticatedRequest,
} from './auth'

const app = express()
const port = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

app.post('/auth/register', async (req, res) => {
  const { email, password, displayName } = req.body as {
    email?: string
    password?: string
    displayName?: string
  }

  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'email, password and displayName are required' })
  }

  const normalizedEmail = email.toLowerCase()

  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include both letters and numbers',
    })
  }

  const existing = await findUserByEmail(normalizedEmail)
  if (existing) {
    return res.status(409).json({ error: 'Email is already in use' })
  }

  const passwordHash = await hashPassword(password)
  const user = await createUser({
    email: normalizedEmail,
    displayName,
    passwordHash,
  })

  const token = signAccessToken(user)

  return res.status(201).json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
  })
})

app.get('/channels', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const channels = await getChannelsForUser(userId)
    return res.json({
      channels: channels.map((ch) => ({
        id: ch.id,
        title: ch.title,
        slug: ch.slug,
        isPublic: ch.is_public,
        createdBy: ch.created_by,
      })),
    })
  } catch (error) {
    console.error('Failed to load channels for user', error)
    return res.status(500).json({ error: 'Failed to load channels' })
  }
})

app.post('/channels', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { name } = req.body as { name?: string }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Channel name is required' })
  }

  try {
    const channel = await createChannelForUser({ userId, name })
    return res.status(201).json({
      channel: {
        id: channel.id,
        title: channel.title,
        slug: channel.slug,
        isPublic: channel.is_public,
        createdBy: channel.created_by,
      },
    })
  } catch (error) {
    console.error('Failed to create channel', error)
    return res.status(500).json({ error: 'Failed to create channel' })
  }
})

app.post(
  '/channels/:channelId/invite',
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const channelId = req.params.channelId as string
    const { friendId } = req.body as { friendId?: string }

    if (!friendId) {
      return res.status(400).json({ error: 'friendId is required' })
    }
    if (friendId === userId) {
      return res.status(400).json({ error: 'You cannot invite yourself' })
    }

    try {
      const friends = await getFriendsForUser(userId)
      const isFriend = friends.some((f) => f.id === friendId)
      if (!isFriend) {
        return res
          .status(400)
          .json({ error: 'You can only invite users who are already your friends' })
      }

      await addUserToChannel({ channelId, userId: friendId })
      return res.status(204).send()
    } catch (error) {
      console.error('Failed to invite friend to channel', error)
      return res.status(500).json({ error: 'Failed to invite friend to channel' })
    }
  },
)

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  const normalizedEmail = email.toLowerCase()
  const user = await findUserByEmail(normalizedEmail)

  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const isValid = await verifyPassword(password, user.password_hash)
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const token = signAccessToken(user)

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
  })
})

app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body as { email?: string }

  if (!email) {
    return res.status(400).json({ error: 'email is required' })
  }

  const normalizedEmail = email.toLowerCase()

  try {
    const user = await findUserByEmail(normalizedEmail)

    if (user) {
      try {
        const reset = await createPasswordResetTokenForUser({ userId: user.id })
        // For now, we just log the token so the app owner can use it manually.
        console.log(
          `Password reset token for ${user.email}: ${reset.token} (expires at ${reset.expires_at.toISOString()})`,
        )
      } catch (error) {
        console.error('Failed to create password reset token', error)
        // Intentionally fall through to generic success message so we do not leak state.
      }
    }

    return res.json({
      message: 'If an account with that email exists, a reset token has been generated.',
    })
  } catch (error) {
    console.error('Failed to initiate password reset', error)
    return res.status(500).json({ error: 'Failed to initiate password reset' })
  }
})

app.post('/auth/reset-password', async (req, res) => {
  const { token, password } = req.body as { token?: string; password?: string }

  if (!token || !password) {
    return res.status(400).json({ error: 'token and password are required' })
  }

  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters and include both letters and numbers',
    })
  }

  try {
    const resetRow = await findValidPasswordResetToken(token)
    if (!resetRow) {
      return res.status(400).json({ error: 'Invalid or expired reset token' })
    }

    const user = await getUserById(resetRow.user_id)
    if (!user) {
      return res.status(400).json({ error: 'Invalid reset token' })
    }

    const passwordHash = await hashPassword(password)
    await updateUserPassword({ userId: user.id, passwordHash })
    await markPasswordResetTokenUsed(resetRow.id)

    return res.json({ message: 'Password has been reset successfully' })
  } catch (error) {
    console.error('Failed to reset password', error)
    return res.status(500).json({ error: 'Failed to reset password' })
  }
})

app.post('/auth/oauth', async (req, res) => {
  const { provider, providerAccountId, email, displayName } = req.body as {
    provider?: string
    providerAccountId?: string
    email?: string
    displayName?: string
  }

  if (!provider || !providerAccountId || !email || !displayName) {
    return res.status(400).json({ error: 'provider, providerAccountId, email and displayName are required' })
  }

  const normalizedEmail = email.toLowerCase()
  const user = await findOrCreateUserWithOAuth({
    provider,
    providerAccountId,
    email: normalizedEmail,
    displayName,
  })

  const token = signAccessToken(user)

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
  })
})

app.get('/auth/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const user = await getUserById(userId)
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
  })
})

app.get('/friends', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const friends = await getFriendsForUser(userId)
    return res.json({
      friends: friends.map((f) => ({
        id: f.id,
        email: f.email,
        displayName: f.display_name,
        avatarUrl: f.avatar_url,
      })),
    })
  } catch (error) {
    console.error('Failed to load friends', error)
    return res.status(500).json({ error: 'Failed to load friends' })
  }
})

app.get('/me/unread-counts', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const [rows, mentionRows] = await Promise.all([
      getUnreadCountsForUser(userId),
      getMentionUnreadCountsForUser(userId),
    ])

    const byRoom: Record<string, number> = {}
    for (const row of rows) {
      byRoom[row.room] = row.unread_count
    }

    const mentionByRoom: Record<string, number> = {}
    for (const row of mentionRows) {
      mentionByRoom[row.room] = row.unread_count
    }

    return res.json({ unreadCounts: byRoom, mentionUnreadCounts: mentionByRoom })
  } catch (error) {
    console.error('Failed to load unread counts', error)
    return res.status(500).json({ error: 'Failed to load unread counts' })
  }
})

app.post('/friends', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { friendId, friendDisplayName } = req.body as {
    friendId?: string
    friendDisplayName?: string
  }

  if (!friendId || !friendDisplayName) {
    return res.status(400).json({ error: 'friendId and friendDisplayName are required' })
  }
  if (friendId === userId) {
    return res.status(400).json({ error: 'You cannot add yourself as a friend' })
  }

  try {
    const friendUser = await getUserById(friendId)
    if (!friendUser) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (friendUser.display_name !== friendDisplayName) {
      return res.status(400).json({ error: 'Display name does not match this user id' })
    }

    await addFriendForUser({ userId, friendUserId: friendId })
    await addFriendForUser({ userId: friendId, friendUserId: userId })

    return res.status(201).json({
      friend: {
        id: friendUser.id,
        email: friendUser.email,
        displayName: friendUser.display_name,
        avatarUrl: friendUser.avatar_url,
      },
    })
  } catch (error) {
    console.error('Failed to add friend', error)
    return res.status(500).json({ error: 'Failed to add friend' })
  }
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.post('/feedback', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { category, message } = req.body as { category?: string | null; message?: string }

  const trimmed = (message ?? '').trim()
  if (!trimmed) {
    return res.status(400).json({ error: 'Feedback message is required' })
  }

  try {
    const created = await createFeedback({
      userId,
      category: category ?? null,
      message: trimmed,
    })

    return res.status(201).json({
      feedback: {
        id: created.id,
        userId: created.user_id,
        category: created.category,
        message: created.message,
        createdAt: created.created_at.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to save feedback', error)
    return res.status(500).json({ error: 'Failed to save feedback' })
  }
})

app.get('/admin/feedback', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.sub
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const user = await getUserById(userId)
    const adminEmail = process.env.ADMIN_EMAIL

    if (adminEmail && user && user.email.toLowerCase() !== adminEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const limitParam = req.query.limit
    const limit =
      typeof limitParam === 'string' && !Number.isNaN(Number.parseInt(limitParam, 10))
        ? Number.parseInt(limitParam, 10)
        : 100

    const rows = await getRecentFeedbackWithUsers(limit)

    return res.json({
      feedback: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userDisplayName: row.user_display_name,
        category: row.category,
        message: row.message,
        createdAt: row.created_at.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to load feedback for admin', error)
    return res.status(500).json({ error: 'Failed to load feedback' })
  }
})

app.get('/rooms/:room/messages', async (req, res) => {
  const room = req.params.room
  const limitParam = req.query.limit
  const limit =
    typeof limitParam === 'string' && !Number.isNaN(Number.parseInt(limitParam, 10))
      ? Number.parseInt(limitParam, 10)
      : 50

  try {
    const rows = await getMessagesForRoom(room, limit)
    const messageIds = rows.map((row) => row.id)
    const [reactionRows, readRows, totalCount] = await Promise.all([
      getReactionsForMessages(messageIds),
      getReadReceiptsForRoom(room),
      getMessageCountForRoom(room),
    ])

    const reactionsByMessage = new Map<
      number,
      { emoji: string; userId: string }[]
    >()

    for (const r of reactionRows) {
      const existing = reactionsByMessage.get(r.message_id) ?? []
      existing.push({ emoji: r.emoji, userId: r.user_id })
      reactionsByMessage.set(r.message_id, existing)
    }

    const messages = rows.map((row: StoredMessage) => ({
      id: row.id,
      room: row.room,
      user: row.username,
      message: row.message,
      timestamp: row.created_at.toISOString(),
      userId: row.user_id,
      replyToMessageId: row.reply_to_message_id,
      editedAt: row.edited_at ? row.edited_at.toISOString() : null,
      deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
      deletedByUserId: row.deleted_by,
      reactions: reactionsByMessage.get(row.id) ?? [],
    }))
    const readReceipts = readRows.map((r) => ({
      room: r.room,
      userId: r.user_id,
      lastReadMessageId: r.last_read_message_id,
      updatedAt: r.updated_at.toISOString(),
    }))

    res.json({ messages, totalCount, readReceipts })
  } catch (error) {
    console.error('Failed to fetch messages for room', room, error)
    res.status(500).json({ error: 'Failed to load messages' })
  }
})

const server = http.createServer(app)

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

io.on('connection', (socket) => {
  try {
    const auth = socket.handshake.auth as { token?: string } | undefined
    const queryToken = socket.handshake.query?.token
    const token =
      (auth && typeof auth.token === 'string' && auth.token) ||
      (typeof queryToken === 'string' ? queryToken : undefined)

    if (!token) {
      socket.emit('error', { error: 'Authentication token is required' })
      socket.disconnect(true)
      return
    }

    const payload = verifyToken(token)
    // Attach user identity to the socket for later use
    // eslint-disable-next-line no-param-reassign
    socket.data.user = {
      id: payload.sub,
      email: payload.email,
      displayName: payload.displayName,
    }
  } catch (error) {
    console.error('Socket authentication failed', error)
    socket.emit('error', { error: 'Authentication failed' })
    socket.disconnect(true)
    return
  }

  console.log(`Client connected: ${socket.id}`)

  socket.on('join_room', (room: string) => {
    socket.join(room)

    const userFromSocket = socket.data.user as
      | { id: string; email: string; displayName?: string }
      | undefined
    const displayName = userFromSocket?.displayName ?? userFromSocket?.email ?? 'Someone'
    const userId = userFromSocket?.id ?? null

    socket.to(room).emit('user_joined', {
      socketId: socket.id,
      userId,
      displayName,
    })
  })

  socket.on(
    'chat_message',
    async (payload: { room: string; message: string; replyToMessageId?: number | null }) => {
      const { room, message, replyToMessageId } = payload
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const displayName = userFromSocket?.displayName ?? userFromSocket?.email ?? 'Unknown'
      const userId = userFromSocket?.id
      const timestamp = new Date().toISOString()
      try {
        const saved = await saveMessage({
          room,
          username: displayName,
          message,
          userId,
          replyToMessageId,
        })

        io.to(room).emit('chat_message', {
          room,
          message,
          user: displayName,
          userId,
          timestamp: saved.created_at.toISOString(),
          messageId: saved.id,
          replyToMessageId: saved.reply_to_message_id,
        })
      } catch (error) {
        console.error('Failed to persist chat message', error)
      }
    },
  )

  socket.on(
    'edit_message',
    async (payload: { messageId: number; newContent: string }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const userId = userFromSocket?.id
      if (!userId) return

      const trimmed = payload.newContent.trim()
      if (!trimmed) return

      try {
        const updated = await editMessageForUser({
          messageId: payload.messageId,
          userId,
          newContent: trimmed,
        })

        if (!updated) return

        io.to(updated.room).emit('message_edited', {
          messageId: updated.id,
          room: updated.room,
          message: updated.message,
          editedAt: updated.edited_at ? updated.edited_at.toISOString() : null,
        })
      } catch (error) {
        console.error('Failed to edit message', error)
      }
    },
  )

  socket.on(
    'delete_message',
    async (payload: { messageId: number }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const userId = userFromSocket?.id
      if (!userId) return

      try {
        const deleted = await softDeleteMessageForUser({
          messageId: payload.messageId,
          userId,
        })

        if (!deleted) return

        io.to(deleted.room).emit('message_deleted', {
          messageId: deleted.id,
          room: deleted.room,
          deletedAt: deleted.deleted_at ? deleted.deleted_at.toISOString() : null,
        })
      } catch (error) {
        console.error('Failed to delete message', error)
      }
    },
  )

  socket.on(
    'mark_read',
    async (payload: { room: string; messageId: number }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const userId = userFromSocket?.id
      if (!userId) return

      if (!payload.room || !payload.messageId) return

      try {
        const updated = await upsertReadReceipt({
          room: payload.room,
          userId,
          lastReadMessageId: payload.messageId,
        })

        io.to(payload.room).emit('read_receipt_updated', {
          room: updated.room,
          userId: updated.user_id,
          lastReadMessageId: updated.last_read_message_id,
          updatedAt: updated.updated_at.toISOString(),
        })

        // Also emit updated unread counts just for this user
        const [unreadRows, mentionUnreadRows] = await Promise.all([
          getUnreadCountsForUser(userId),
          getMentionUnreadCountsForUser(userId),
        ])

        const unreadByRoom: Record<string, number> = {}
        for (const row of unreadRows) {
          unreadByRoom[row.room] = row.unread_count
        }

        const mentionUnreadByRoom: Record<string, number> = {}
        for (const row of mentionUnreadRows) {
          mentionUnreadByRoom[row.room] = row.unread_count
        }

        socket.emit('unread_counts', {
          unreadCounts: unreadByRoom,
          mentionUnreadCounts: mentionUnreadByRoom,
        })
      } catch (error) {
        console.error('Failed to update read receipt', error)
      }
    },
  )

  socket.on(
    'add_reaction',
    async (payload: { messageId: number; emoji: string; room: string }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const userId = userFromSocket?.id
      if (!userId) return

      const emoji = payload.emoji?.trim()
      if (!emoji) return

      try {
        await addReactionForUser({
          messageId: payload.messageId,
          userId,
          emoji,
        })

        io.to(payload.room).emit('reaction_updated', {
          messageId: payload.messageId,
          emoji,
          userId,
          type: 'added' as const,
        })
      } catch (error) {
        console.error('Failed to add reaction', error)
      }
    },
  )

  socket.on(
    'remove_reaction',
    async (payload: { messageId: number; emoji: string; room: string }) => {
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const userId = userFromSocket?.id
      if (!userId) return

      const emoji = payload.emoji?.trim()
      if (!emoji) return

      try {
        await removeReactionForUser({
          messageId: payload.messageId,
          userId,
          emoji,
        })

        io.to(payload.room).emit('reaction_updated', {
          messageId: payload.messageId,
          emoji,
          userId,
          type: 'removed' as const,
        })
      } catch (error) {
        console.error('Failed to remove reaction', error)
      }
    },
  )

  socket.on(
    'typing',
    (payload: { room: string; isTyping: boolean }) => {
      const { room, isTyping } = payload
      const userFromSocket = socket.data.user as
        | { id: string; email: string; displayName?: string }
        | undefined
      const displayName = userFromSocket?.displayName ?? userFromSocket?.email ?? 'Unknown'
      const userId = userFromSocket?.id
      socket.to(room).emit('typing', { room, user: displayName, userId, isTyping })
    },
  )

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)
  })
})

server.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`)
  void initDb().then(() => {
    console.log('Database initialized')
  }).catch((error) => {
    console.error('Failed to initialize database', error)
  })
})
