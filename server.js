const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/public'));
app.use('/socket.io', express.static(__dirname + '/node_modules/socket.io/client-dist'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Store active rooms
const activeRooms = new Map();

io.on('connection', (socket) => {
  console.log('A user connected');

  // Handle room creation
  socket.on('createRoom', (callback) => {
    try {
      const roomId = uuidv4().substring(0, 6);
      activeRooms.set(roomId, { users: new Set([socket.id]) });
      socket.join(roomId);
      callback({ success: true, roomId });
    } catch (error) {
      callback({ success: false, error: 'Failed to create room' });
    }
  });

  // Handle room joining
  socket.on('joinRoom', (roomId, callback) => {
    try {
      const room = activeRooms.get(roomId);
      if (!room) {
        callback({ success: false, error: 'Room not found' });
        return;
      }
      
      socket.join(roomId);
      room.users.add(socket.id);
      callback({ success: true });
      
      // Notify others in the room
      socket.to(roomId).emit('userJoined', { userId: socket.id });
    } catch (error) {
      callback({ success: false, error: 'Failed to join room' });
    }
  });

  // Handle transcript broadcasting
  socket.on('sendTranscript', ({ roomId, text }) => {
    const room = activeRooms.get(roomId);
    if (room && room.users.has(socket.id)) {
      socket.to(roomId).emit('receiveTranscript', {
        userId: socket.id,
        text,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected');
    // Clean up user from rooms
    for (const [roomId, room] of activeRooms.entries()) {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        if (room.users.size === 0) {
          activeRooms.delete(roomId);
        } else {
          socket.to(roomId).emit('userLeft', { userId: socket.id });
        }
      }
    }
  });
});

const PORT = 8000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
