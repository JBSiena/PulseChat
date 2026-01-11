"use client"

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useDispatch, useSelector } from 'react-redux'
import EmojiPicker from 'emoji-picker-react'
import type { RootState, AppDispatch } from '../lib/store'
import { setRoom, setUsername } from '../lib/features/chatSlice'
import { clearAuth, setCredentials, type AuthUser } from '../lib/features/authSlice'
import { getSocket } from '../lib/socket'

interface MessageReaction {
  emoji: string
  userId: string
}

interface RoomReadReceipt {
  room: string
  userId: string
  lastReadMessageId: number
  updatedAt: string
}

interface ChatMessage {
  id: string
  messageId?: number | null
  replyToMessageId?: number | null
  userId: string | null
  user: string
  message: string
  timestamp: string
  system?: boolean
  editedAt?: string | null
  deletedAt?: string | null
  deletedByUserId?: string | null
  reactions?: MessageReaction[]
}

interface FriendSummary {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

interface ChannelSummary {
  id: string
  label: string
  isSystem?: boolean
  conversationId?: string
}

interface AdminFeedbackItem {
  id: number
  userId: string
  userEmail: string
  userDisplayName: string
  category: string | null
  message: string
  createdAt: string
}

interface MentionCandidate {
  id: string
  displayName: string
  description?: string
  isSpecial?: boolean
}

const BUILT_IN_CHANNELS: ChannelSummary[] = [
  { id: 'general', label: '# general', isSystem: true },
  { id: 'support', label: '# support', isSystem: true },
]

function getDmRoomId(selfId: string, friendId: string) {
  return `dm:${[selfId, friendId].sort().join(':')}`
}

export default function HomePage() {
  const dispatch = useDispatch<AppDispatch>()
  const authToken = useSelector((state: RootState) => state.auth.token)
  const authUser = useSelector((state: RootState) => state.auth.user)
  const username = useSelector((state: RootState) => state.chat.username)
  const room = useSelector((state: RootState) => state.chat.room)

  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messageInput, setMessageInput] = useState('')
  const messageInputRef = useRef<HTMLInputElement | null>(null)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authDisplayName, setAuthDisplayName] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false)
  const [forgotPasswordStep, setForgotPasswordStep] = useState<'request' | 'reset'>(
    'request',
  )
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [forgotPasswordError, setForgotPasswordError] = useState<string | null>(null)
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState<string | null>(null)
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false)

  const [friends, setFriends] = useState<FriendSummary[]>([])
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [friendsError, setFriendsError] = useState<string | null>(null)
  const [addFriendId, setAddFriendId] = useState('')
  const [addFriendDisplayName, setAddFriendDisplayName] = useState('')
  const [addFriendSubmitting, setAddFriendSubmitting] = useState(false)
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false)
  const [channels, setChannels] = useState<ChannelSummary[]>(BUILT_IN_CHANNELS)
  const [isAddChannelOpen, setIsAddChannelOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [addChannelSubmitting, setAddChannelSubmitting] = useState(false)
  const [addChannelError, setAddChannelError] = useState<string | null>(null)
  const [channelInviteFriendId, setChannelInviteFriendId] = useState('')
  const [channelInviteSubmitting, setChannelInviteSubmitting] = useState(false)
  const [channelInviteError, setChannelInviteError] = useState<string | null>(null)
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null)
  const [readReceipts, setReadReceipts] = useState<RoomReadReceipt[]>([])
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [mentionUnreadCounts, setMentionUnreadCounts] = useState<Record<string, number>>({})
  const [notificationLevels, setNotificationLevels] = useState<
    Record<string, 'all' | 'mentions' | 'muted'>
  >({})
  const [isMentionMenuOpen, setIsMentionMenuOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState<number | null>(null)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false)
  const [feedbackCategory, setFeedbackCategory] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null)
  const [isAdminFeedbackOpen, setIsAdminFeedbackOpen] = useState(false)
  const [adminFeedback, setAdminFeedback] = useState<AdminFeedbackItem[]>([])
  const [adminFeedbackLoading, setAdminFeedbackLoading] = useState(false)
  const [adminFeedbackError, setAdminFeedbackError] = useState<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  const isAuthenticated = Boolean(authToken && authUser)
  const adminEmailEnv = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? '').toLowerCase()
  const isAdminUser = Boolean(
    authUser && adminEmailEnv && authUser.email.toLowerCase() === adminEmailEnv,
  )

  // Rehydrate auth state from localStorage on first load if Redux is empty
  useEffect(() => {
    if (authToken) return

    try {
      const stored = window.localStorage.getItem('auth')
      if (!stored) return
      const parsed = JSON.parse(stored) as { token: string; user: AuthUser }
      if (parsed.token && parsed.user) {
        dispatch(setCredentials(parsed))
      }
    } catch {
      // ignore malformed storage
    }
  }, [authToken, dispatch])

  const handleLoadAdminFeedback = async () => {
    if (!authToken) {
      setAdminFeedbackError('You must be logged in as admin to view feedback')
      return
    }

    setAdminFeedbackLoading(true)
    setAdminFeedbackError(null)

    try {
      const res = await axios.get<{ feedback: AdminFeedbackItem[] }>(
        `${apiBaseUrl}/admin/feedback`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      )
      setAdminFeedback(res.data.feedback ?? [])
    } catch (error) {
      setAdminFeedbackError(
        error instanceof Error ? error.message : 'Failed to load feedback for admin',
      )
    } finally {
      setAdminFeedbackLoading(false)
    }
  }

  // Keep localStorage in sync with current auth state
  useEffect(() => {
    if (!authToken || !authUser) {
      window.localStorage.removeItem('auth')
      return
    }

    window.localStorage.setItem(
      'auth',
      JSON.stringify({ token: authToken, user: authUser }),
    )
  }, [authToken, authUser])

  // Join all channel rooms so we can receive events and update unread counts
  useEffect(() => {
    if (!authToken || !authUser) return
    const socket = getSocket(authToken)
    channels.forEach((ch) => {
      socket.emit('join_room', ch.id)
    })
  }, [authToken, authUser, channels])

  // Load custom channels for the authenticated user
  useEffect(() => {
    if (!authToken || !authUser) {
      setChannels(BUILT_IN_CHANNELS)
      return
    }

    let cancelled = false

    const loadChannels = async () => {
      try {
        const res = await axios.get<{
          channels?: {
            id: string
            title: string | null
            slug: string | null
          }[]
        }>(`${apiBaseUrl}/channels`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })

        if (cancelled) return

        const dynamicChannels: ChannelSummary[] = (res.data.channels ?? []).map((ch) => {
          const baseLabel = ch.title ?? ch.slug ?? 'channel'
          const roomId = ch.slug ?? ch.id
          return {
            id: roomId,
            label: `# ${baseLabel}`,
            isSystem: false,
            conversationId: ch.id,
          }
        })

        setChannels((prev) => {
          const existingIds = new Set(prev.map((c) => c.id))
          const mergedBuiltIns = BUILT_IN_CHANNELS.filter((c) => !existingIds.has(c.id))
          const mergedDynamics = dynamicChannels.filter((c) => !existingIds.has(c.id))
          return [...prev, ...mergedBuiltIns, ...mergedDynamics]
        })
      } catch {
        // ignore
      }
    }

    void loadChannels()

    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, authToken, authUser])

  // Join all DM rooms for current friends so unread counts stay in sync
  useEffect(() => {
    if (!authToken || !authUser) return
    if (friends.length === 0) return

    const socket = getSocket(authToken)
    friends.forEach((friend) => {
      const roomId = getDmRoomId(authUser.id, friend.id)
      socket.emit('join_room', roomId)
    })
  }, [authToken, authUser, friends])

  // Load initial unread counts for the authenticated user
  useEffect(() => {
    if (!authToken || !authUser) {
      setUnreadCounts({})
      setMentionUnreadCounts({})
      return
    }

    let cancelled = false

    const loadUnread = async () => {
      try {
        const res = await axios.get<{
          unreadCounts?: Record<string, number>
          mentionUnreadCounts?: Record<string, number>
        }>(`${apiBaseUrl}/me/unread-counts`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })
        if (!cancelled) {
          if (res.data.unreadCounts) {
            setUnreadCounts(res.data.unreadCounts)
          }
          if (res.data.mentionUnreadCounts) {
            setMentionUnreadCounts(res.data.mentionUnreadCounts)
          }
        }
      } catch {
        // ignore
      }
    }

    void loadUnread()

    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, authToken, authUser])

  const isDmRoom = room.startsWith('dm:')
  let activeDmFriend: FriendSummary | undefined
  if (isDmRoom && authUser) {
    const parts = room.split(':')
    if (parts.length === 3) {
      const [, a, b] = parts
      const otherId = a === authUser.id ? b : b === authUser.id ? a : null
      if (otherId) {
        activeDmFriend = friends.find((f) => f.id === otherId)
      }
    }
  }

  const activeCustomChannel: ChannelSummary | null = !isDmRoom
    ? channels.find((ch) => ch.id === room && !ch.isSystem && ch.conversationId)
        ?? null
    : null

  const getMentionCandidatesForRoom = (): MentionCandidate[] => {
    if (!authUser) return []

    const byId = new Map<string, MentionCandidate>()

    // Always include yourself
    byId.set(authUser.id, {
      id: authUser.id,
      displayName: authUser.displayName,
      description: 'You',
    })

    if (isDmRoom && activeDmFriend) {
      byId.set(activeDmFriend.id, {
        id: activeDmFriend.id,
        displayName: activeDmFriend.displayName,
        description: activeDmFriend.email,
      })
    } else {
      friends.forEach((friend) => {
        byId.set(friend.id, {
          id: friend.id,
          displayName: friend.displayName,
          description: friend.email,
        })
      })
    }

    const list = Array.from(byId.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    )

    if (!isDmRoom) {
      list.push({
        id: 'everyone',
        displayName: 'everyone',
        description: 'Mention everyone in this chat',
        isSpecial: true,
      })
    }

    return list
  }

  const allMentionCandidates = getMentionCandidatesForRoom()
  const normalizedMentionQuery = mentionQuery.trim().toLowerCase()
  const visibleMentionCandidates =
    isMentionMenuOpen && allMentionCandidates.length > 0
      ? allMentionCandidates.filter((candidate) => {
          if (!normalizedMentionQuery) return true
          return candidate.displayName.toLowerCase().includes(normalizedMentionQuery)
        })
      : []

  useEffect(() => {
    if (!isMentionMenuOpen || visibleMentionCandidates.length === 0) {
      setMentionActiveIndex(0)
      return
    }
    setMentionActiveIndex((prev) =>
      prev >= visibleMentionCandidates.length ? 0 : prev,
    )
  }, [isMentionMenuOpen, visibleMentionCandidates.length])

  const closeMentionMenu = () => {
    setIsMentionMenuOpen(false)
    setMentionQuery('')
    setMentionTriggerIndex(null)
    setMentionActiveIndex(0)
  }

  const insertMentionCandidate = (candidate: MentionCandidate) => {
    if (mentionTriggerIndex == null) return

    setMessageInput((prev) => {
      const inputEl = messageInputRef.current
      const caretIndex = inputEl?.selectionStart ?? prev.length
      const before = prev.slice(0, mentionTriggerIndex)
      const after = prev.slice(caretIndex)

      const mentionText =
        candidate.id === 'everyone' || candidate.isSpecial
          ? '@everyone'
          : `@${candidate.displayName}`

      const newValue = `${before}${mentionText} ${after}`
      const newCaretIndex = before.length + mentionText.length + 1

      if (inputEl) {
        setTimeout(() => {
          if (!messageInputRef.current) return
          const el = messageInputRef.current
          el.focus()
          const finalIndex = Math.min(newCaretIndex, newValue.length)
          el.setSelectionRange(finalIndex, finalIndex)
        }, 0)
      }

      return newValue
    })

    closeMentionMenu()
  }

  useEffect(() => {
    if (!authUser) {
      setNotificationLevels({})
      return
    }

    try {
      const stored = window.localStorage.getItem(
        `roomNotificationLevels:${authUser.id}`,
      )
      if (!stored) return
      const parsed = JSON.parse(stored) as Record<string, string>
      const next: Record<string, 'all' | 'mentions' | 'muted'> = {}
      for (const [roomId, level] of Object.entries(parsed)) {
        if (level === 'all' || level === 'mentions' || level === 'muted') {
          next[roomId] = level
        }
      }
      setNotificationLevels(next)
    } catch {
      // ignore malformed storage
    }
  }, [authUser])

  useEffect(() => {
    if (!authUser) return
    try {
      window.localStorage.setItem(
        `roomNotificationLevels:${authUser.id}`,
        JSON.stringify(notificationLevels),
      )
    } catch {
      // ignore
    }
  }, [authUser, notificationLevels])

  const renderMessageWithMentions = (text: string) => {
    const mentionRegex = /(@[^\s.,!?]+)/g
    let match: RegExpExecArray | null
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0

    // eslint-disable-next-line no-cond-assign
    while ((match = mentionRegex.exec(text)) !== null) {
      const full = match[0]
      const start = match.index
      const end = start + full.length

      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start))
      }

      const mentionName = full.slice(1)
      const isMe = Boolean(authUser && mentionName === authUser.displayName)

      parts.push(
        <span
          key={`${start}-${mentionName}`}
          className={
            isMe
              ? 'rounded-md bg-emerald-500/30 px-1 py-0.5 text-emerald-100 font-semibold'
              : 'rounded-md bg-slate-700/70 px-1 py-0.5 text-slate-50 font-medium'
          }
        >
          {full}
        </span>,
      )

      lastIndex = end
    }

    if (lastIndex === 0) return text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }
    return parts
  }

  const headerTitle = isDmRoom
    ? activeDmFriend?.displayName ?? 'Direct Message'
    : `# ${room || 'general'}`

  const headerIconText = isDmRoom
    ? activeDmFriend?.displayName?.charAt(0).toUpperCase() ?? '@'
    : '#'

  let dmDeliveryLabel: string | null = null
  if (isDmRoom && authUser && activeDmFriend) {
    const friendReceipt = readReceipts.find(
      (r) => r.room === room && r.userId === activeDmFriend?.id,
    )

    const ownMessages = messages.filter(
      (m) => m.messageId != null && m.userId === authUser.id && !m.deletedAt,
    )
    const lastOwn = ownMessages.reduce<ChatMessage | null>((acc, m) => {
      if (!acc) return m
      if ((m.messageId ?? 0) > (acc.messageId ?? 0)) return m
      return acc
    }, null)

    if (lastOwn && lastOwn.messageId != null) {
      if (friendReceipt && friendReceipt.lastReadMessageId >= lastOwn.messageId) {
        const seenDate = new Date(friendReceipt.updatedAt)
        const timeStr = seenDate.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
        dmDeliveryLabel = `Seen at ${timeStr}`
      } else {
        dmDeliveryLabel = 'Delivered'
      }
    }
  }

  let typingIndicatorText: string | null = null
  if (typingUsers.length === 1) {
    typingIndicatorText = `${typingUsers[0]} is typing`
  } else if (typingUsers.length === 2) {
    typingIndicatorText = `${typingUsers[0]} and ${typingUsers[1]} are typing`
  } else if (typingUsers.length > 2) {
    const others = typingUsers.length - 2
    typingIndicatorText = `${typingUsers[0]}, ${typingUsers[1]} and ${others} others are typing`
  }

  // Keep localStorage in sync with current auth state
  useEffect(() => {
    if (!authToken || !authUser) {
      window.localStorage.removeItem('auth')
      return
    }

    window.localStorage.setItem(
      'auth',
      JSON.stringify({ token: authToken, user: authUser }),
    )
  }, [authToken, authUser])

  // Load friends list for the authenticated user
  useEffect(() => {
    if (!authToken) {
      setFriends([])
      return
    }

    let cancelled = false

    const loadFriends = async () => {
      setFriendsLoading(true)
      setFriendsError(null)
      try {
        const res = await axios.get<{ friends: FriendSummary[] }>(
          `${apiBaseUrl}/friends`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        )
        if (!cancelled) {
          setFriends(res.data.friends)
        }
      } catch (error) {
        if (!cancelled) {
          setFriendsError(
            error instanceof Error ? error.message : 'Failed to load friends',
          )
        }
      } finally {
        if (!cancelled) {
          setFriendsLoading(false)
        }
      }
    }

    void loadFriends()

    return () => {
      cancelled = true
    }
  }, [apiBaseUrl, authToken])

  // Ensure chat username follows the authenticated user (helps after refresh)
  useEffect(() => {
    if (authUser && !username) {
      dispatch(setUsername(authUser.displayName))
    }
  }, [authUser, username, dispatch])

  const handleSelectRoom = (nextRoom: string) => {
    if (!nextRoom || nextRoom === room) return
    dispatch(setRoom(nextRoom))
  }

  const getNotificationLevelForRoom = (roomId: string): 'all' | 'mentions' | 'muted' => {
    return notificationLevels[roomId] ?? 'all'
  }

  const cycleNotificationLevelForRoom = (roomId: string) => {
    setNotificationLevels((prev) => {
      const current = prev[roomId] ?? 'all'
      const next = current === 'all' ? 'mentions' : current === 'mentions' ? 'muted' : 'all'
      return { ...prev, [roomId]: next }
    })
  }

  const getAudioContext = () => {
    if (typeof window === 'undefined') return null
    if (audioContextRef.current) return audioContextRef.current
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    audioContextRef.current = ctx
    return ctx
  }

  const playTone = (frequency: number, durationMs: number, volume = 0.12) => {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = frequency

    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000)

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    oscillator.start(now)
    oscillator.stop(now + durationMs / 1000)
  }

  const playMessageSound = () => {
    // Higher and slightly longer tone for regular messages
    playTone(900, 180, 0.16)
  }

  const playMentionSound = () => {
    // Distinct two-tone chime for mentions
    playTone(1400, 220, 0.18)
    window.setTimeout(() => {
      playTone(1000, 220, 0.16)
    }, 120)
  }

  const playNotificationSoundForMessage = (roomId: string, isMention: boolean) => {
    const level = getNotificationLevelForRoom(roomId)
    if (level === 'muted') return

    if (level === 'mentions') {
      if (isMention) playMentionSound()
      return
    }

    if (isMention) {
      playMentionSound()
    } else {
      playMessageSound()
    }
  }

  useEffect(() => {
    if (!authToken) {
      setConnected(false)
      setTypingUsers([])
      return
    }

    const socket = getSocket(authToken)
    // Reset typing users whenever we (re)attach handlers, e.g. on room change
    setTypingUsers([])

    const handleConnect = () => {
      setConnected(true)
    }

    const handleDisconnect = () => {
      setConnected(false)
      setTypingUsers([])
    }

    const handleChatMessage = (payload: {
      room: string
      message: string
      user: string
      userId?: string | null
      timestamp: string
      messageId?: number | null
      replyToMessageId?: number | null
    }) => {
      // If this message is for the currently active room, append it to the visible list
      if (payload.room === room) {
        setMessages((prev) => {
          const id =
            payload.messageId != null
              ? `db-${payload.messageId}`
              : `${payload.timestamp}-${payload.userId ?? 'unknown'}-${payload.message}`
          if (prev.some((m) => m.id === id)) return prev
          return [
            ...prev,
            {
              id,
              messageId: payload.messageId ?? null,
              replyToMessageId: payload.replyToMessageId ?? null,
              userId: payload.userId ?? null,
              user: payload.user,
              message: payload.message,
              timestamp: payload.timestamp,
              reactions: [],
            },
          ]
        })

        if (authUser && payload.userId && payload.userId !== authUser.id) {
          const isMention = Boolean(
            authUser.displayName &&
              payload.message.includes(`@${authUser.displayName}`),
          )
          const level = getNotificationLevelForRoom(payload.room)
          if (level !== 'muted') {
            playNotificationSoundForMessage(payload.room, isMention)
          }
        }
        return
      }

      // Otherwise, it's for another joined room: bump its unread count if it's from someone else
      if (
        payload.room &&
        payload.userId &&
        authUser &&
        payload.userId !== authUser.id
      ) {
        setUnreadCounts((prev) => ({
          ...prev,
          [payload.room]: (prev[payload.room] ?? 0) + 1,
        }))
        const isMention = Boolean(
          authUser.displayName && payload.message.includes(`@${authUser.displayName}`),
        )
        if (isMention) {
          setMentionUnreadCounts((prev) => ({
            ...prev,
            [payload.room]: (prev[payload.room] ?? 0) + 1,
          }))
        }

        const level = getNotificationLevelForRoom(payload.room)
        if (level !== 'muted') {
          playNotificationSoundForMessage(payload.room, isMention)
        }
      }
    }

    const handleMessageEdited = (payload: {
      messageId: number
      room: string
      message: string
      editedAt: string | null
    }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.messageId === payload.messageId
            ? { ...m, message: payload.message, editedAt: payload.editedAt }
            : m,
        ),
      )
    }

    const handleReadReceiptUpdated = (payload: {
      room: string
      userId: string
      lastReadMessageId: number
      updatedAt: string
    }) => {
      setReadReceipts((prev) => {
        const idx = prev.findIndex(
          (r) => r.room === payload.room && r.userId === payload.userId,
        )
        if (idx === -1) {
          return [...prev, payload]
        }
        if (prev[idx].lastReadMessageId >= payload.lastReadMessageId) {
          return prev
        }
        const next = [...prev]
        next[idx] = payload
        return next
      })
    }

    const handleUnreadCounts = (payload: {
      unreadCounts?: Record<string, number>
      mentionUnreadCounts?: Record<string, number>
    }) => {
      if (payload.unreadCounts) {
        setUnreadCounts(payload.unreadCounts)
      }
      if (payload.mentionUnreadCounts) {
        setMentionUnreadCounts(payload.mentionUnreadCounts)
      }
    }

    const handleReactionUpdated = (payload: {
      messageId: number
      emoji: string
      userId: string
      type: 'added' | 'removed'
    }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.messageId !== payload.messageId) return m
          const existing = m.reactions ?? []
          if (payload.type === 'added') {
            if (existing.some((r) => r.emoji === payload.emoji && r.userId === payload.userId)) {
              return m
            }
            return {
              ...m,
              reactions: [...existing, { emoji: payload.emoji, userId: payload.userId }],
            }
          }
          // removed
          return {
            ...m,
            reactions: existing.filter(
              (r) => !(r.emoji === payload.emoji && r.userId === payload.userId),
            ),
          }
        }),
      )
    }

    const handleMessageDeleted = (payload: {
      messageId: number
      room: string
      deletedAt: string | null
    }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.messageId === payload.messageId
            ? { ...m, deletedAt: payload.deletedAt ?? new Date().toISOString() }
            : m,
        ),
      )
    }

    const handleTyping = (payload: {
      room: string
      user: string
      userId?: string | null
      isTyping: boolean
    }) => {
      if (
        !payload.room ||
        payload.room !== room ||
        (payload.userId && authUser && payload.userId === authUser.id)
      )
        return

      setTypingUsers((prev) => {
        if (payload.isTyping) {
          if (prev.includes(payload.user)) return prev
          return [...prev, payload.user]
        }
        return prev.filter((u) => u !== payload.user)
      })
    }

    const handleUserJoined = (payload: {
      socketId: string
      userId?: string | null
      displayName?: string
    }) => {
      setMessages((prev) => {
        const key = payload.userId ?? payload.socketId
        const id = `join-${key}`
        if (prev.some((m) => m.id === id)) return prev

        const name = payload.displayName || 'Someone'

        return [
          ...prev,
          {
            id,
            userId: null,
            user: 'system',
            message: `${name} joined`,
            timestamp: new Date().toISOString(),
            system: true,
          },
        ]
      })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('chat_message', handleChatMessage)
    socket.on('typing', handleTyping)
    socket.on('user_joined', handleUserJoined)
    socket.on('message_edited', handleMessageEdited)
    socket.on('message_deleted', handleMessageDeleted)
    socket.on('reaction_updated', handleReactionUpdated)
    socket.on('read_receipt_updated', handleReadReceiptUpdated)
    socket.on('unread_counts', handleUnreadCounts)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('chat_message', handleChatMessage)
      socket.off('typing', handleTyping)
      socket.off('user_joined', handleUserJoined)
      socket.off('message_edited', handleMessageEdited)
      socket.off('message_deleted', handleMessageDeleted)
      socket.off('reaction_updated', handleReactionUpdated)
      socket.off('read_receipt_updated', handleReadReceiptUpdated)
      socket.off('unread_counts', handleUnreadCounts)
    }
  }, [username, authToken, room, authUser, notificationLevels])

  useEffect(() => {
    if (!username || !room || !authToken) return
    const socket = getSocket(authToken)
    socket.emit('join_room', room)

    // When joining a room, clear its unread count for the current user
    setUnreadCounts((prev) => {
      if (!prev[room]) return prev
      const next = { ...prev }
      delete next[room]
      return next
    })
    setMentionUnreadCounts((prev) => {
      if (!prev[room]) return prev
      const next = { ...prev }
      delete next[room]
      return next
    })
  }, [username, room, authToken])

  useEffect(() => {
    // Reset local state when switching rooms
    setMessages([])
    setHasLoadedHistory(false)
    lastSentReadMessageIdRef.current = null
    closeMentionMenu()
    setIsAtBottom(true)
  }, [room])

  const { data: historyData, isFetching: isHistoryFetching } = useQuery<{
    messages: ChatMessage[]
    totalCount: number
    readReceipts: RoomReadReceipt[]
  }>({
    queryKey: ['roomMessages', room],
    queryFn: async () => {
      const res = await axios.get<{
        messages: {
          id: number
          room: string
          user: string
          message: string
          timestamp: string
          userId: string | null
          replyToMessageId?: number | null
          editedAt?: string | null
          deletedAt?: string | null
          deletedByUserId?: string | null
          reactions?: { emoji: string; userId: string }[]
        }[]
        totalCount?: number
        readReceipts?: {
          room: string
          userId: string
          lastReadMessageId: number
          updatedAt: string
        }[]
      }>(
        `${apiBaseUrl}/rooms/${encodeURIComponent(room)}/messages?limit=50`,
      )

      const mappedMessages: ChatMessage[] = res.data.messages.map((msg) => ({
        id: `db-${msg.id}`,
        messageId: msg.id,
        replyToMessageId: msg.replyToMessageId ?? null,
        userId: msg.userId,
        user: msg.user,
        message: msg.message,
        timestamp: msg.timestamp,
        editedAt: msg.editedAt ?? null,
        deletedAt: msg.deletedAt ?? null,
        deletedByUserId: msg.deletedByUserId ?? null,
        reactions: msg.reactions ?? [],
      }))

      const mappedReceipts: RoomReadReceipt[] = (res.data.readReceipts ?? []).map((r) => ({
        room: r.room,
        userId: r.userId,
        lastReadMessageId: r.lastReadMessageId,
        updatedAt: r.updatedAt,
      }))

      return {
        messages: mappedMessages,
        totalCount: res.data.totalCount ?? mappedMessages.length,
        readReceipts: mappedReceipts,
      }
    },
    enabled: Boolean(room && username && connected && !hasLoadedHistory),
    // Always refetch when (re)mounting a room's history query so that messages
    // sent while viewing other rooms are included when switching back.
    refetchOnMount: 'always',
    staleTime: 30_000,
  })

  useEffect(() => {
    // Only hydrate local message state from history once per room switch,
    // and only after the latest history fetch has settled. This avoids
    // populating from stale cached data that may be missing recent messages.
    if (historyData && !hasLoadedHistory && !isHistoryFetching) {
      setMessages(historyData.messages)
      setReadReceipts(historyData.readReceipts)
      setHasLoadedHistory(true)
    }
  }, [historyData, hasLoadedHistory, isHistoryFetching])

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const threshold = 80
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsAtBottom(distanceFromBottom <= threshold)
  }

  const lastSentReadMessageIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!authToken || !authUser || !room) return
    if (messages.length === 0) return

    const latestFromOther = messages
      .filter(
        (m) =>
          m.messageId != null &&
          m.userId != null &&
          m.userId !== authUser.id &&
          !m.deletedAt,
      )
      .reduce<ChatMessage | null>((acc, m) => {
        if (!acc) return m
        if ((m.messageId ?? 0) > (acc.messageId ?? 0)) return m
        return acc
      }, null)

    if (!latestFromOther || latestFromOther.messageId == null) return

    if (
      lastSentReadMessageIdRef.current != null &&
      lastSentReadMessageIdRef.current >= latestFromOther.messageId
    ) {
      return
    }

    const socket = getSocket(authToken)
    socket.emit('mark_read', {
      room,
      messageId: latestFromOther.messageId,
    })
    lastSentReadMessageIdRef.current = latestFromOther.messageId
  }, [authToken, authUser, room, messages])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return

    // On initial history load or when user is near the bottom, keep scrolled to latest
    if (!hasLoadedHistory || isAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, room, hasLoadedHistory, isAtBottom])
  const handleMessageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const inputEl = event.target
    const value = inputEl.value
    const caretIndex = inputEl.selectionStart ?? value.length

    setMessageInput(value)

    // Detect active @mention segment based on caret position
    if (value.length === 0) {
      if (isMentionMenuOpen) {
        closeMentionMenu()
      }
    } else {
      const textUpToCaret = value.slice(0, caretIndex)
      const lastAt = textUpToCaret.lastIndexOf('@')

      if (lastAt === -1) {
        if (isMentionMenuOpen) {
          closeMentionMenu()
        }
      } else {
        const charBefore = lastAt > 0 ? textUpToCaret[lastAt - 1] : ' '
        const isValidStart = /\s/.test(charBefore)
        const afterAt = textUpToCaret.slice(lastAt + 1)
        const hasSpace = afterAt.includes(' ')

        if (!isValidStart || hasSpace) {
          if (isMentionMenuOpen) {
            closeMentionMenu()
          }
        } else {
          setIsMentionMenuOpen(true)
          setMentionTriggerIndex(lastAt)
          setMentionQuery(afterAt)
          setMentionActiveIndex(0)
        }
      }
    }

    if (!username || !room || !authToken) return
    const socket = getSocket(authToken)
    socket.emit('typing', {
      room,
      isTyping: value.length > 0,
    })
  }

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isMentionMenuOpen || visibleMentionCandidates.length === 0) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setMentionActiveIndex((prev) => {
        const count = visibleMentionCandidates.length
        if (count === 0) return 0
        if (event.key === 'ArrowDown') {
          return (prev + 1) % count
        }
        return (prev - 1 + count) % count
      })
      return
    }

    if (event.key === 'Enter') {
      const candidate =
        visibleMentionCandidates[mentionActiveIndex] ?? visibleMentionCandidates[0]
      if (candidate) {
        event.preventDefault()
        insertMentionCandidate(candidate)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeMentionMenu()
    }
  }

  const handleInsertEmoji = (emoji: string = '🙂') => {
    setMessageInput((prev) => (prev ? `${prev} ${emoji}` : emoji))
    if (messageInputRef.current) {
      messageInputRef.current.focus()
    }
  }

  const handleSendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = messageInput.trim()
    if (!trimmed || !username || !room || !authToken) return

    if (editingMessage?.messageId) {
      const socket = getSocket(authToken)
      socket.emit('edit_message', {
        messageId: editingMessage.messageId,
        newContent: trimmed,
      })

      socket.emit('typing', {
        room,
        isTyping: false,
      })

      setMessageInput('')
      setEditingMessage(null)
      return
    }

    const replyToMessageId = replyTo?.messageId ?? null
    const socket = getSocket(authToken)
    socket.emit('chat_message', {
      room,
      message: trimmed,
      replyToMessageId,
    })

    socket.emit('typing', {
      room,
      isTyping: false,
    })

    setMessageInput('')
    setReplyTo(null)
    closeMentionMenu()
  }

  const handleStartReply = (message: ChatMessage) => {
    if (!message.messageId) return
    setEditingMessage(null)
    setReplyTo(message)
    if (messageInputRef.current) {
      messageInputRef.current.focus()
    }
  }

  const handleStartEdit = (message: ChatMessage) => {
    if (!message.messageId || message.deletedAt) return
    setReplyTo(null)
    setEditingMessage(message)
    setMessageInput(message.message)
    if (messageInputRef.current) {
      messageInputRef.current.focus()
    }
  }

  const handleDeleteMessage = (message: ChatMessage) => {
    if (!message.messageId || !authToken || message.deletedAt) return
    const socket = getSocket(authToken)
    socket.emit('delete_message', { messageId: message.messageId })
  }

  const handleToggleReaction = (message: ChatMessage, emoji: string) => {
    if (!authToken || !room || !message.messageId || !authUser) return
    const hasReacted =
      message.reactions?.some((r) => r.emoji === emoji && r.userId === authUser.id) ?? false
    const socket = getSocket(authToken)
    const eventName = hasReacted ? 'remove_reaction' : 'add_reaction'
    socket.emit(eventName, {
      messageId: message.messageId,
      emoji,
      room,
    })
  }

  const handleInviteFriendToActiveChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken || !activeCustomChannel?.conversationId) {
      setChannelInviteError('You must be in a custom channel to invite friends')
      return
    }

    if (!channelInviteFriendId) {
      setChannelInviteError('Please select a friend to invite')
      return
    }

    setChannelInviteSubmitting(true)
    setChannelInviteError(null)
    try {
      await axios.post(
        `${apiBaseUrl}/channels/${activeCustomChannel.conversationId}/invite`,
        { friendId: channelInviteFriendId },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        },
      )
      setChannelInviteFriendId('')
    } catch (error) {
      setChannelInviteError(
        error instanceof Error ? error.message : 'Failed to invite friend to channel',
      )
    } finally {
      setChannelInviteSubmitting(false)
    }
  }
  const handleAddFriend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) {
      setFriendsError('You must be logged in to add friends')
      return
    }

    const friendId = addFriendId.trim()
    const friendDisplayName = addFriendDisplayName.trim()
    if (!friendId || !friendDisplayName) {
      setFriendsError('Friend ID and display name are required')
      return
    }

    setAddFriendSubmitting(true)
    setFriendsError(null)

    try {
      const res = await axios.post<{ friend: FriendSummary }>(
        `${apiBaseUrl}/friends`,
        { friendId, friendDisplayName },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        },
      )
      setFriends((prev) =>
        prev.some((f) => f.id === res.data.friend.id)
          ? prev
          : [...prev, res.data.friend],
      )
      setAddFriendId('')
      setAddFriendDisplayName('')
    } catch (error) {
      setFriendsError(error instanceof Error ? error.message : 'Failed to add friend')
    } finally {
      setAddFriendSubmitting(false)
    }
  }

  const handleSubmitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) {
      setFeedbackError('You must be logged in to send feedback')
      return
    }

    const trimmed = feedbackMessage.trim()
    if (!trimmed) {
      setFeedbackError('Feedback message is required')
      return
    }

    setFeedbackSubmitting(true)
    setFeedbackError(null)
    setFeedbackSuccess(null)

    try {
      await axios.post(
        `${apiBaseUrl}/feedback`,
        {
          category: feedbackCategory || null,
          message: trimmed,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        },
      )

      setFeedbackMessage('')
      setFeedbackCategory('')
      setFeedbackSuccess('Thank you for your feedback!')
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : 'Failed to send feedback')
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError(null)

    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError('Email and password are required')
      return
    }

    if (authMode === 'register' && !authDisplayName.trim()) {
      setAuthError('Display name is required for registration')
      return
    }

    setAuthLoading(true)
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register'
      const body =
        authMode === 'login'
          ? { email: authEmail.trim(), password: authPassword.trim() }
          : {
              email: authEmail.trim(),
              password: authPassword.trim(),
              displayName: authDisplayName.trim(),
            }

      const res = await axios.post<{
        token: string
        user: { id: string; email: string; displayName: string; avatarUrl: string | null }
      }>(`${apiBaseUrl}${endpoint}`, body, {
        headers: { 'Content-Type': 'application/json' },
      })

      dispatch(
        setCredentials({
          token: res.data.token,
          user: res.data.user,
        }),
      )
      dispatch(setUsername(res.data.user.displayName))
      setAuthPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleForgotPasswordRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setForgotPasswordError(null)
    setForgotPasswordSuccess(null)

    const email = forgotPasswordEmail.trim().toLowerCase()
    if (!email) {
      setForgotPasswordError('Email is required')
      return
    }

    setForgotPasswordLoading(true)

    try {
      await axios.post(
        `${apiBaseUrl}/auth/forgot-password`,
        { email },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      setForgotPasswordSuccess(
        'If an account with that email exists, a reset token has been generated. Check the server logs for the token.',
      )
      setForgotPasswordStep('reset')
    } catch (error) {
      setForgotPasswordError(
        error instanceof Error ? error.message : 'Failed to request password reset',
      )
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  const handleResetPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setForgotPasswordError(null)
    setForgotPasswordSuccess(null)

    const token = resetToken.trim()
    const password = resetNewPassword.trim()

    if (!token || !password) {
      setForgotPasswordError('Reset token and new password are required')
      return
    }

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setForgotPasswordError(
        'Password must be at least 8 characters and include both letters and numbers',
      )
      return
    }

    setForgotPasswordLoading(true)

    try {
      await axios.post(
        `${apiBaseUrl}/auth/reset-password`,
        { token, password },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )

      setForgotPasswordSuccess('Password has been reset. You can now log in with your new password.')
      setIsForgotPasswordMode(false)
      setAuthMode('login')
      setAuthPassword('')
      setResetToken('')
      setResetNewPassword('')
    } catch (error) {
      setForgotPasswordError(error instanceof Error ? error.message : 'Failed to reset password')
    } finally {
      setForgotPasswordLoading(false)
    }
  }

  const handleLogout = () => {
    // Disconnect any active socket for the current auth token
    if (authToken) {
      const socket = getSocket(authToken)
      socket.disconnect()
    }

    // Immediately clear any persisted auth so a refresh does not re-authenticate
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('auth')
    }

    // Clear Redux auth state
    dispatch(clearAuth())

    // Reset local UI/chat state
    setConnected(false)
    setMessages([])
    setTypingUsers([])
    setMessageInput('')
    setReplyTo(null)
    setEditingMessage(null)
    setFriends([])
    setUnreadCounts({})
    setMentionUnreadCounts({})
    setNotificationLevels({})
    setChannels(BUILT_IN_CHANNELS)
    setIsFeedbackOpen(false)
    setFeedbackMessage('')
    setFeedbackCategory('')
    setFeedbackError(null)
    setFeedbackSuccess(null)
    setIsAdminFeedbackOpen(false)
    setAdminFeedback([])
    setAdminFeedbackError(null)
    // Reset auth form state so login/register is clean next time
    setAuthEmail('')
    setAuthPassword('')
    setAuthDisplayName('')
    setAuthMode('login')
    setAuthError(null)
    setAuthLoading(false)
    setIsForgotPasswordMode(false)
    setForgotPasswordStep('request')
    setForgotPasswordEmail('')
    setResetToken('')
    setResetNewPassword('')
    setForgotPasswordError(null)
    setForgotPasswordSuccess(null)
    setForgotPasswordLoading(false)
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-50">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl">
          <h1 className="text-xl font-semibold">PulseChat</h1>
          <p className="mt-1 text-xs text-slate-400">
            Sign in or create an account to start messaging.
          </p>

          {!isForgotPasswordMode ? (
            <>
              <div className="mt-4 flex gap-1 text-[11px] text-slate-400">
                <button
                  type="button"
                  className={`flex-1 rounded-md border px-2 py-1 ${
                    authMode === 'login'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                  onClick={() => setAuthMode('login')}
                >
                  Login
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-md border px-2 py-1 ${
                    authMode === 'register'
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                  onClick={() => setAuthMode('register')}
                >
                  Register
                </button>
              </div>

              <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3 text-sm">
                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">Email</label>
                  <input
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">Password</label>
                  <input
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                    minLength={8}
                  />
                  <p className="text-[10px] text-slate-500">
                    At least 8 characters, with letters and numbers.
                  </p>
                </div>
                {authMode === 'register' && (
                  <div className="space-y-1">
                    <label className="block text-xs text-slate-400">Display name</label>
                    <input
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                      value={authDisplayName}
                      onChange={(e) => setAuthDisplayName(e.target.value)}
                      placeholder="e.g. Benjie"
                    />
                  </div>
                )}
                {authError && (
                  <p className="text-[11px] text-rose-400">{authError}</p>
                )}
                <button
                  type="submit"
                  className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-3 py-2 text-xs font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={authLoading}
                >
                  {authMode === 'login' ? 'Login' : 'Create account'}
                </button>
              </form>
              <div className="mt-3 text-right text-[11px] text-slate-500">
                <button
                  type="button"
                  className="text-emerald-300 hover:text-emerald-200 hover:underline"
                  onClick={() => {
                    setIsForgotPasswordMode(true)
                    setForgotPasswordStep('request')
                    setForgotPasswordEmail(authEmail)
                    setResetToken('')
                    setResetNewPassword('')
                    setForgotPasswordError(null)
                    setForgotPasswordSuccess(null)
                    setForgotPasswordLoading(false)
                  }}
                >
                  Forgot password?
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-4 text-sm font-semibold">Reset your password</h2>
              <p className="mt-1 text-[11px] text-slate-400">
                {forgotPasswordStep === 'request'
                  ? 'Enter your account email. If it exists, a reset token will be generated and logged on the server.'
                  : 'Paste the reset token from the server logs and choose a new password.'}
              </p>

              {forgotPasswordStep === 'request' ? (
                <form
                  onSubmit={handleForgotPasswordRequest}
                  className="mt-4 space-y-3 text-sm"
                >
                  <div className="space-y-1">
                    <label className="block text-xs text-slate-400">Email</label>
                    <input
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                      type="email"
                      value={forgotPasswordEmail}
                      onChange={(e) => setForgotPasswordEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>
                  {forgotPasswordError && (
                    <p className="text-[11px] text-rose-400">{forgotPasswordError}</p>
                  )}
                  {forgotPasswordSuccess && (
                    <p className="text-[11px] text-emerald-400">{forgotPasswordSuccess}</p>
                  )}
                  <button
                    type="submit"
                    className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-3 py-2 text-xs font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={forgotPasswordLoading}
                  >
                    Send reset token
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={handleResetPasswordSubmit}
                  className="mt-4 space-y-3 text-sm"
                >
                  <div className="space-y-1">
                    <label className="block text-xs text-slate-400">Reset token</label>
                    <input
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Paste the token from the server logs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs text-slate-400">New password</label>
                    <input
                      className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                      type="password"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      minLength={8}
                    />
                    <p className="text-[10px] text-slate-500">
                      At least 8 characters, with letters and numbers.
                    </p>
                  </div>
                  {forgotPasswordError && (
                    <p className="text-[11px] text-rose-400">{forgotPasswordError}</p>
                  )}
                  {forgotPasswordSuccess && (
                    <p className="text-[11px] text-emerald-400">{forgotPasswordSuccess}</p>
                  )}
                  <button
                    type="submit"
                    className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-3 py-2 text-xs font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={forgotPasswordLoading}
                  >
                    Reset password
                  </button>
                </form>
              )}
              <div className="mt-3 text-[11px] text-slate-500">
                <button
                  type="button"
                  className="hover:text-emerald-300 hover:underline"
                  onClick={() => {
                    setIsForgotPasswordMode(false)
                    setForgotPasswordStep('request')
                    setForgotPasswordEmail('')
                    setResetToken('')
                    setResetNewPassword('')
                    setForgotPasswordError(null)
                    setForgotPasswordSuccess(null)
                    setForgotPasswordLoading(false)
                  }}
                >
                  Back to login
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-screen bg-slate-950 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="flex flex-1 overflow-hidden bg-slate-900/70">
        {/* Sidebar */}
        <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2 px-4 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500 text-sm font-bold text-slate-950 shadow-lg">
              PC
            </div>
            <div>
              <p className="text-sm font-semibold">PulseChat</p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-left text-[11px] text-slate-400 hover:text-emerald-300 hover:underline"
                onClick={() => {
                  if (authUser?.displayName) {
                    void navigator.clipboard.writeText(authUser.displayName)
                  }
                }}
                aria-label="Copy your display name"
              >
                <span>{authUser?.displayName ?? ''}</span>
                <span
                  aria-hidden="true"
                  className="relative inline-flex h-3 w-3"
                >
                  <span className="absolute inset-0 rounded-[2px] border border-slate-500" />
                  <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-[2px] border border-slate-500" />
                </span>
              </button>
              <button
                type="button"
                className="mt-0.5 inline-flex items-center gap-1 text-left text-[10px] text-slate-500 break-all hover:text-emerald-300 hover:underline"
                onClick={() => {
                  if (authUser?.id) {
                    void navigator.clipboard.writeText(authUser.id)
                  }
                }}
                aria-label="Copy your user ID"
              >
                <span>ID: {authUser?.id}</span>
                <span
                  aria-hidden="true"
                  className="relative inline-flex h-3 w-3"
                >
                  <span className="absolute inset-0 rounded-[2px] border border-slate-500" />
                  <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-[2px] border border-slate-500" />
                </span>
              </button>
            </div>
          </div>

          <div className="px-4 pb-3">
            <input
              className="w-full rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
              placeholder="Search..."
            />
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-4 text-sm scrollbar-thin">
            <div className="flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <span>Channels</span>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[11px] text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
                onClick={() => {
                  setIsAddChannelOpen((prev) => !prev)
                  setAddChannelError(null)
                }}
                aria-label="Add channel"
              >
                +
              </button>
            </div>
            <div className="mt-1 space-y-1">
              {channels.map((ch) => {
                const active = ch.id === room
                const totalUnread = unreadCounts[ch.id] ?? 0
                const mentionUnread = mentionUnreadCounts[ch.id] ?? 0
                const level = getNotificationLevelForRoom(ch.id)

                const effectiveUnread = level === 'mentions' ? mentionUnread : totalUnread
                const hasUnread = level === 'muted' ? false : effectiveUnread > 0
                const hasMentionHighlight = mentionUnread > 0

                const badgeCount = level === 'mentions' ? mentionUnread : totalUnread

                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => handleSelectRoom(ch.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">#</span>
                      <span className={hasUnread ? 'font-semibold' : ''}>
                        {ch.label.replace('# ', '')}
                      </span>
                    </span>
                    {hasUnread && badgeCount > 0 && level !== 'muted' && (
                      <span
                        className={`ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                          hasMentionHighlight
                            ? 'bg-amber-400 text-amber-950'
                            : 'bg-emerald-500 text-emerald-950'
                        }`}
                      >
                        {badgeCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {isAddChannelOpen && (
              <form
                onSubmit={async (event) => {
                  event.preventDefault()
                  if (!authToken) {
                    setAddChannelError('You must be logged in to create channels')
                    return
                  }
                  const trimmed = newChannelName.trim()
                  if (!trimmed) {
                    setAddChannelError('Channel name is required')
                    return
                  }

                  setAddChannelSubmitting(true)
                  setAddChannelError(null)
                  try {
                    const res = await axios.post<{
                      channel: { id: string; title: string | null; slug: string | null }
                    }>(
                      `${apiBaseUrl}/channels`,
                      { name: trimmed },
                      {
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${authToken}`,
                        },
                      },
                    )

                    const ch = res.data.channel
                    const baseLabel = ch.title ?? ch.slug ?? 'channel'
                    const roomId = ch.slug ?? ch.id
                    setChannels((prev) => {
                      if (prev.some((c) => c.id === roomId)) return prev
                      return [
                        ...prev,
                        {
                          id: roomId,
                          label: `# ${baseLabel}`,
                          isSystem: false,
                          conversationId: ch.id,
                        },
                      ]
                    })
                    setNewChannelName('')
                  } catch (error) {
                    setAddChannelError(
                      error instanceof Error ? error.message : 'Failed to create channel',
                    )
                  } finally {
                    setAddChannelSubmitting(false)
                  }
                }}
                className="mt-3 space-y-1 px-2 text-[11px] text-slate-300"
              >
                {addChannelError && (
                  <p className="text-[10px] text-rose-400">{addChannelError}</p>
                )}
                <input
                  className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                  placeholder="Channel name"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={addChannelSubmitting}
                >
                  {addChannelSubmitting ? 'Creating...' : 'Create channel'}
                </button>
              </form>
            )}

            {activeCustomChannel && friends.length > 0 && (
              <form
                onSubmit={handleInviteFriendToActiveChannel}
                className="mt-3 space-y-1 px-2 text-[11px] text-slate-300"
              >
                {channelInviteError && (
                  <p className="text-[10px] text-rose-400">{channelInviteError}</p>
                )}
                <p className="text-[10px] text-slate-500">
                  Invite friend to {activeCustomChannel.label.replace('# ', '')}
                </p>
                <select
                  className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                  value={channelInviteFriendId}
                  onChange={(e) => setChannelInviteFriendId(e.target.value)}
                >
                  <option value="">Select friend…</option>
                  {friends.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={channelInviteSubmitting || !channelInviteFriendId}
                >
                  {channelInviteSubmitting ? 'Inviting…' : 'Invite to channel'}
                </button>
              </form>
            )}

            <div className="mt-4 flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <span>Direct Messages</span>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[11px] text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
                onClick={() => {
                  setIsAddFriendOpen((prev) => !prev)
                  setFriendsError(null)
                }}
                aria-label="Add friend"
              >
                +
              </button>
            </div>
            <div className="mt-1 space-y-1">
              {friendsLoading && (
                <p className="px-3 text-[11px] text-slate-500">Loading friends...</p>
              )}
              {friendsError && (
                <p className="px-3 text-[11px] text-rose-400">{friendsError}</p>
              )}
              {authUser &&
                friends.map((friend) => {
                  const roomId = getDmRoomId(authUser.id, friend.id)
                  const active = roomId === room
                  const totalUnread = unreadCounts[roomId] ?? 0
                  const mentionUnread = mentionUnreadCounts[roomId] ?? 0
                  const level = getNotificationLevelForRoom(roomId)

                  const effectiveUnread = level === 'mentions' ? mentionUnread : totalUnread
                  const hasUnread = level === 'muted' ? false : effectiveUnread > 0
                  const hasMentionHighlight = mentionUnread > 0
                  const badgeCount = level === 'mentions' ? mentionUnread : totalUnread

                  return (
                    <button
                      key={friend.id}
                      type="button"
                      onClick={() => handleSelectRoom(roomId)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                        active
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span className={hasUnread ? 'font-semibold' : ''}>{friend.displayName}</span>
                      </span>
                      {hasUnread && badgeCount > 0 && level !== 'muted' && (
                        <span
                          className={`ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                            hasMentionHighlight
                              ? 'bg-amber-400 text-amber-950'
                              : 'bg-emerald-500 text-emerald-950'
                          }`}
                        >
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              {!friendsLoading && friends.length === 0 && (
                <p className="px-3 text-[11px] text-slate-500">
                  No friends yet. Add one below.
                </p>
              )}
              {isAddFriendOpen && (
                <form
                  onSubmit={handleAddFriend}
                  className="mt-3 space-y-1 px-2 pb-2 text-[11px] text-slate-300"
                >
                  <p className="text-[10px] text-slate-500">Add friend by ID & name</p>
                  <input
                    className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                    placeholder="Friend ID (UUID)"
                    value={addFriendId}
                    onChange={(e) => setAddFriendId(e.target.value)}
                  />
                  <input
                    className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                    placeholder="Friend display name"
                    value={addFriendDisplayName}
                    onChange={(e) => setAddFriendDisplayName(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={addFriendSubmitting}
                  >
                    {addFriendSubmitting ? 'Adding...' : 'Add friend'}
                  </button>
                </form>
              )}
            </div>
          </nav>
          <div className="border-t border-slate-800 px-4 py-3 text-xs">
            <button
              type="button"
              className="inline-flex w-full items-center justify-center rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
              onClick={() => {
                setIsFeedbackOpen((prev) => !prev)
                setFeedbackError(null)
                setFeedbackSuccess(null)
              }}
            >
              Feedback / Q&A
            </button>
            {isFeedbackOpen && (
              <form
                onSubmit={handleSubmitFeedback}
                className="mt-2 space-y-1 text-[11px] text-slate-300"
              >
                {feedbackError && (
                  <p className="text-[10px] text-rose-400">{feedbackError}</p>
                )}
                {feedbackSuccess && (
                  <p className="text-[10px] text-emerald-400">{feedbackSuccess}</p>
                )}
                <select
                  className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                  value={feedbackCategory}
                  onChange={(e) => setFeedbackCategory(e.target.value)}
                >
                  <option value="">Category (optional)</option>
                  <option value="bug">Bug report</option>
                  <option value="feature">Feature request</option>
                  <option value="question">Question</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                  className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1"
                  rows={3}
                  placeholder="Describe your question, bug, or idea..."
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-medium text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={feedbackSubmitting || !feedbackMessage.trim()}
                >
                  {feedbackSubmitting ? 'Sending…' : 'Send feedback'}
                </button>
              </form>
            )}
          </div>

          <div className="border-t border-slate-800 px-4 py-3 text-xs">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex w-full items-center justify-center rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-rose-500 hover:text-rose-300"
            >
              Logout
            </button>
          </div>
        </aside>

        {/* Main conversation area */}
        <section className="flex flex-1 flex-col bg-slate-900/50">
          <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-100">
                {headerIconText}
              </div>
              <div>
                <p className="text-sm font-semibold">PulseChat</p>
                <p className="text-[11px] text-slate-400">
                  {connected ? 'Online' : 'Offline'} • You: {authUser?.displayName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              {isAdminUser && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !isAdminFeedbackOpen
                    setIsAdminFeedbackOpen(next)
                    if (next) {
                      void handleLoadAdminFeedback()
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-amber-500 hover:text-amber-300"
                >
                  <span>{isAdminFeedbackOpen ? 'Back to chat' : 'Admin: Feedback inbox'}</span>
                </button>
              )}
              <div className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                <span>{connected ? 'Connected' : 'Disconnected'}</span>
              </div>
              {room && (
                <button
                  type="button"
                  onClick={() => cycleNotificationLevelForRoom(room)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-emerald-500 hover:text-emerald-300"
                >
                  <span>
                    {(() => {
                      const level = getNotificationLevelForRoom(room)
                      if (level === 'muted') return 'Muted'
                      if (level === 'mentions') return 'Mentions only'
                      return 'All messages'
                    })()}
                  </span>
                </button>
              )}
            </div>
          </header>
          {!isAdminFeedbackOpen ? (
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm scrollbar-thin"
            >
              {messages.length === 0 && (
                <p className="text-xs text-slate-500">
                  No messages yet. Say hello to start the conversation.
                </p>
              )}

              {messages.map((msg) => {
              const isOwn = msg.userId
                ? Boolean(authUser && msg.userId === authUser.id)
                : msg.user === username
              const isSystem = msg.system
              const isDeleted = Boolean(msg.deletedAt)

              if (isSystem) {
                if (isDmRoom) return null
                return (
                  <div key={msg.id} className="flex justify-center text-[11px] text-slate-400">
                    {msg.message}
                  </div>
                )
              }

              const repliedTo =
                msg.replyToMessageId != null
                  ? messages.find((m) => m.messageId === msg.replyToMessageId)
                  : undefined

              const reactionSummaryMap = new Map<
                string,
                { emoji: string; count: number; reactedByMe: boolean }
              >()
              const reactions = msg.reactions ?? []
              reactions.forEach((r) => {
                const key = r.emoji
                const existing =
                  reactionSummaryMap.get(key) ??
                  {
                    emoji: r.emoji,
                    count: 0,
                    reactedByMe: false,
                  }
                existing.count += 1
                if (authUser && r.userId === authUser.id) {
                  existing.reactedByMe = true
                }
                reactionSummaryMap.set(key, existing)
              })
              const reactionSummaries = Array.from(reactionSummaryMap.values())
              const quickReactions = ['👍', '❤️', '😂', '😮', '😢']

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${
                    isOwn ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {!isOwn && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-200">
                      {msg.user.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div
                    className={`group max-w-[70%] rounded-2xl px-3 py-2 text-xs shadow-sm ${
                      isOwn
                        ? 'rounded-br-sm bg-emerald-500 text-emerald-950'
                        : 'rounded-bl-sm bg-slate-800 text-slate-100'
                    }`}
                  >
                    {repliedTo && !isDeleted && (
                      <div className="mb-1 rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-300">
                        <p className="mb-0.5 line-clamp-1">
                          Replying to{' '}
                          <span className="font-semibold">
                            {repliedTo.userId && authUser && repliedTo.userId === authUser.id
                              ? 'You'
                              : repliedTo.user}
                          </span>
                        </p>
                        <p className="line-clamp-2 text-[10px] opacity-80">{repliedTo.message}</p>
                      </div>
                    )}
                    <p className="mb-0.5 text-[10px] font-medium opacity-80">
                      {isOwn ? 'You' : msg.user}
                      {msg.editedAt && !isDeleted && (
                        <span className="ml-1 text-[9px] opacity-70">(edited)</span>
                      )}
                    </p>
                    <p className={isDeleted ? 'italic text-slate-300/70' : ''}>
                      {isDeleted
                        ? 'This message was deleted'
                        : renderMessageWithMentions(msg.message)}
                    </p>
                    {!isDeleted && reactionSummaries.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {reactionSummaries.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => handleToggleReaction(msg, r.emoji)}
                            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] ${
                              r.reactedByMe
                                ? 'bg-emerald-500/90 text-emerald-950'
                                : 'bg-slate-900/80 text-slate-100'
                            }`}
                          >
                            <span className="mr-1">{r.emoji}</span>
                            <span>{r.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {msg.messageId && !isDeleted && (
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-200/70">
                        <button
                          type="button"
                          onClick={() => handleStartReply(msg)}
                          className="hover:text-emerald-200"
                        >
                          Reply
                        </button>
                        {isOwn && (
                          <>
                            <span className="text-slate-500">·</span>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(msg)}
                              className="hover:text-emerald-200"
                            >
                              Edit
                            </button>
                            <span className="text-slate-500">·</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteMessage(msg)}
                              className="hover:text-rose-300"
                            >
                              Delete
                            </button>
                          </>
                        )}
                        <div className="ml-auto flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                          {quickReactions.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleToggleReaction(msg, emoji)}
                              className="rounded-full bg-slate-900/60 px-1.5 py-0.5 text-[11px] hover:bg-slate-800/80"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {isOwn && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold text-slate-200">
                      {authUser?.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              )
            })}

            {isDmRoom && dmDeliveryLabel && (
              <p className="mt-1 text-[11px] text-slate-500 text-right">
                {dmDeliveryLabel}
              </p>
            )}

            {typingIndicatorText && (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                <span>{typingIndicatorText}</span>
                <span className="inline-flex items-center gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500 animate-pulse" />
                </span>
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4 text-sm scrollbar-thin">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Feedback inbox
            </h2>
            {adminFeedbackLoading && (
              <p className="text-xs text-slate-500">Loading feedback…</p>
            )}
            {adminFeedbackError && (
              <p className="text-xs text-rose-400">{adminFeedbackError}</p>
            )}
            {!adminFeedbackLoading && adminFeedback.length === 0 && !adminFeedbackError && (
              <p className="text-xs text-slate-500">No feedback yet.</p>
            )}
            <ul className="space-y-3">
              {adminFeedback.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs text-slate-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {item.userDisplayName}{' '}
                        <span className="text-[10px] text-slate-400">({item.userEmail})</span>
                      </p>
                      {item.category && (
                        <p className="mt-0.5 inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                          {item.category}
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-100">
                    {item.message}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

          <form
            onSubmit={handleSendMessage}
            className="relative flex items-center gap-3 border-t border-slate-800 bg-slate-900/80 px-5 py-3"
          >
            {editingMessage ? (
              <div className="absolute bottom-full left-5 right-5 mb-2 rounded-lg border border-emerald-500/50 bg-slate-900 px-3 py-2 text-[11px] text-slate-200 shadow-lg">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-emerald-300">Editing your message</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMessage(null)
                      setMessageInput('')
                    }}
                    className="text-[10px] text-slate-400 hover:text-rose-400"
                  >
                    Cancel
                  </button>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                  {editingMessage.message}
                </p>
              </div>
            ) :
              replyTo && (
                <div className="absolute bottom-full left-5 right-5 mb-2 rounded-lg border border-emerald-500/50 bg-slate-900 px-3 py-2 text-[11px] text-slate-200 shadow-lg">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-emerald-300">
                      Replying to{' '}
                      {replyTo.userId && authUser && replyTo.userId === authUser.id
                        ? 'You'
                        : replyTo.user}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="text-[10px] text-slate-400 hover:text-rose-400"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                    {replyTo.message}
                  </p>
                </div>
              )}
            {isEmojiPickerOpen && (
              <div className="absolute bottom-full left-4 mb-2 z-20">
                <EmojiPicker
                  onEmojiClick={(emojiData: any) => {
                    const emoji = (emojiData as any).emoji ?? ''
                    if (emoji) {
                      handleInsertEmoji(emoji)
                    }
                    setIsEmojiPickerOpen(false)
                  }}
                  width={320}
                  height={400}
                />
              </div>
            )}
            {isMentionMenuOpen && visibleMentionCandidates.length > 0 && (
              <div className="absolute bottom-full left-16 mb-2 z-20 w-64 rounded-xl border border-slate-800 bg-slate-900/95 py-1 shadow-xl">
                <ul className="max-h-64 overflow-y-auto text-xs text-slate-100">
                  {visibleMentionCandidates.map((candidate, index) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => insertMentionCandidate(candidate)}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors ${
                          index === mentionActiveIndex
                            ? 'bg-slate-800 text-emerald-200'
                            : 'hover:bg-slate-800/80'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="text-[11px] font-medium">
                            {candidate.displayName}
                          </span>
                          {candidate.description && (
                            <span className="text-[10px] text-slate-400">
                              {candidate.description}
                            </span>
                          )}
                        </div>
                        {candidate.isSpecial && (
                          <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-[9px] text-slate-300">
                            special
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEmojiPickerOpen((open) => !open)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-lg text-slate-200"
              >
                🙂
              </button>
            </div>
            <input
              className="flex-1 rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none ring-emerald-500 focus:border-emerald-500 focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={
                !username || !room
                  ? 'Choose a room to start chatting...'
                  : 'Type a message'
              }
              value={messageInput}
              onChange={handleMessageChange}
              onKeyDown={handleMessageKeyDown}
              ref={messageInputRef}
              disabled={!username || !room || !connected}
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!messageInput.trim() || !username || !room || !connected}
            >
              Send
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
