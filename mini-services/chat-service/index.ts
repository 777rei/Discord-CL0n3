import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// Store connected users
interface ConnectedUser {
  socketId: string
  userId: string
  username: string
  displayName: string
  avatarUrl: string | null
  currentServerId: string | null
  currentChannelId: string | null
}

const connectedUsers = new Map<string, ConnectedUser>()

// Channel presence tracking
const channelPresence = new Map<string, Set<string>>() // channelId -> Set of socketIds

// Video call rooms
const videoRooms = new Map<string, Set<string>>() // channelId -> Set of socketIds

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`)

  // ============ USER AUTHENTICATION ============
  socket.on('auth', (data: { userId: string; username: string; displayName: string; avatarUrl?: string }) => {
    const user: ConnectedUser = {
      socketId: socket.id,
      userId: data.userId,
      username: data.username,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl || null,
      currentServerId: null,
      currentChannelId: null,
    }
    connectedUsers.set(socket.id, user)
    console.log(`User authenticated: ${data.username} (${data.userId})`)
  })

  // ============ CHANNEL JOIN/LEAVE ============
  socket.on('join-channel', (data: { channelId: string; serverId: string }) => {
    const user = connectedUsers.get(socket.id)
    if (!user) return

    // Leave previous channel
    if (user.currentChannelId) {
      const prevPresence = channelPresence.get(user.currentChannelId)
      if (prevPresence) {
        prevPresence.delete(socket.id)
        socket.leave(`channel:${user.currentChannelId}`)
        io.to(`channel:${user.currentChannelId}`).emit('user-left-channel', {
          channelId: user.currentChannelId,
          user: { userId: user.userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
        })
      }
    }

    // Join new channel
    user.currentServerId = data.serverId
    user.currentChannelId = data.channelId
    socket.join(`channel:${data.channelId}`)
    socket.join(`server:${data.serverId}`)

    if (!channelPresence.has(data.channelId)) {
      channelPresence.set(data.channelId, new Set())
    }
    channelPresence.get(data.channelId)!.add(socket.id)

    // Get users in channel
    const usersInChannel = Array.from(channelPresence.get(data.channelId) || [])
      .map(sid => {
        const u = connectedUsers.get(sid)
        return u ? { userId: u.userId, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl } : null
      })
      .filter(Boolean)

    socket.emit('channel-users', { channelId: data.channelId, users: usersInChannel })
    io.to(`channel:${data.channelId}`).emit('user-joined-channel', {
      channelId: data.channelId,
      user: { userId: user.userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
    })
  })

  socket.on('leave-channel', (data: { channelId: string }) => {
    const user = connectedUsers.get(socket.id)
    if (!user) return

    const presence = channelPresence.get(data.channelId)
    if (presence) {
      presence.delete(socket.id)
      socket.leave(`channel:${data.channelId}`)
      io.to(`channel:${data.channelId}`).emit('user-left-channel', {
        channelId: data.channelId,
        user: { userId: user.userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
      })
    }

    user.currentChannelId = null
    user.currentServerId = null
  })

  // ============ MESSAGES ============
  socket.on('send-message', (data: {
    channelId: string
    messageId: string
    content: string
    sender: { id: string; username: string; displayName: string; avatarUrl?: string }
    createdAt: string
  }) => {
    io.to(`channel:${data.channelId}`).emit('new-message', data)
  })

  // ============ TYPING INDICATOR ============
  socket.on('typing', (data: { channelId: string; user: { userId: string; username: string; displayName: string } }) => {
    socket.to(`channel:${data.channelId}`).emit('user-typing', data)
  })

  socket.on('stop-typing', (data: { channelId: string; userId: string }) => {
    socket.to(`channel:${data.channelId}`).emit('user-stop-typing', data)
  })

  // ============ VIDEO CALL SIGNALING ============
  socket.on('join-video', (data: { channelId: string }) => {
    const user = connectedUsers.get(socket.id)
    if (!user) return

    socket.join(`video:${data.channelId}`)

    if (!videoRooms.has(data.channelId)) {
      videoRooms.set(data.channelId, new Set())
    }
    videoRooms.get(data.channelId)!.add(socket.id)

    const participants = Array.from(videoRooms.get(data.channelId) || [])
      .map(sid => {
        const u = connectedUsers.get(sid)
        return u ? { socketId: sid, userId: u.userId, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl } : null
      })
      .filter(Boolean)

    // Send current participants to the joining user
    socket.emit('video-participants', { channelId: data.channelId, participants })

    // Notify others in the video room
    socket.to(`video:${data.channelId}`).emit('user-joined-video', {
      channelId: data.channelId,
      user: { socketId: socket.id, userId: user.userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
    })

    console.log(`${user.username} joined video in channel ${data.channelId}`)
  })

  socket.on('leave-video', (data: { channelId: string }) => {
    socket.leave(`video:${data.channelId}`)
    const room = videoRooms.get(data.channelId)
    if (room) {
      room.delete(socket.id)
      if (room.size === 0) {
        videoRooms.delete(data.channelId)
      }
    }

    const user = connectedUsers.get(socket.id)
    socket.to(`video:${data.channelId}`).emit('user-left-video', {
      channelId: data.channelId,
      socketId: socket.id,
      userId: user?.userId
    })
  })

  // WebRTC signaling
  socket.on('webrtc-offer', (data: { channelId: string; targetSocketId: string; offer: RTCSessionDescriptionInit }) => {
    io.to(data.targetSocketId).emit('webrtc-offer', {
      channelId: data.channelId,
      fromSocketId: socket.id,
      offer: data.offer
    })
  })

  socket.on('webrtc-answer', (data: { channelId: string; targetSocketId: string; answer: RTCSessionDescriptionInit }) => {
    io.to(data.targetSocketId).emit('webrtc-answer', {
      channelId: data.channelId,
      fromSocketId: socket.id,
      answer: data.answer
    })
  })

  socket.on('webrtc-ice-candidate', (data: { channelId: string; targetSocketId: string; candidate: RTCIceCandidateInit }) => {
    io.to(data.targetSocketId).emit('webrtc-ice-candidate', {
      channelId: data.channelId,
      fromSocketId: socket.id,
      candidate: data.candidate
    })
  })

  // Screen sharing signaling
  socket.on('screen-share-start', (data: { channelId: string }) => {
    const user = connectedUsers.get(socket.id)
    if (!user) return
    socket.to(`video:${data.channelId}`).emit('screen-share-started', {
      channelId: data.channelId,
      socketId: socket.id,
      userId: user.userId,
      username: user.username,
      displayName: user.displayName
    })
  })

  socket.on('screen-share-stop', (data: { channelId: string }) => {
    socket.to(`video:${data.channelId}`).emit('screen-share-stopped', {
      channelId: data.channelId,
      socketId: socket.id
    })
  })

  // ============ DISCONNECT ============
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id)
    if (user) {
      console.log(`User disconnected: ${user.username}`)

      // Remove from channel presence
      if (user.currentChannelId) {
        const presence = channelPresence.get(user.currentChannelId)
        if (presence) {
          presence.delete(socket.id)
          io.to(`channel:${user.currentChannelId}`).emit('user-left-channel', {
            channelId: user.currentChannelId,
            user: { userId: user.userId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
          })
        }
      }

      // Remove from video rooms
      for (const [channelId, room] of videoRooms.entries()) {
        if (room.has(socket.id)) {
          room.delete(socket.id)
          socket.to(`video:${channelId}`).emit('user-left-video', {
            channelId,
            socketId: socket.id,
            userId: user.userId
          })
          if (room.size === 0) {
            videoRooms.delete(channelId)
          }
        }
      }
    }

    connectedUsers.delete(socket.id)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = parseInt(process.env.PORT || '3003', 10)
httpServer.listen(PORT, () => {
  console.log(`Chat & Video signaling server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...')
  httpServer.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...')
  httpServer.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})
