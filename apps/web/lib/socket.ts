import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null
let currentToken: string | null = null

export function getSocket(token?: string) {
  const url = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
  const authToken = token ?? currentToken ?? undefined

  const shouldCreateNew =
    !socket || (authToken ?? null) !== (currentToken ?? null)

  if (shouldCreateNew) {
    if (socket) {
      socket.disconnect()
    }

    socket = io(url, {
      transports: ['websocket'],
      auth: authToken ? { token: authToken } : undefined,
    })

    currentToken = authToken ?? null
  }

  return socket as Socket
}
