const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room storage
const rooms = new Map();

// Helper to generate a unique 5-character uppercase alphanumeric room code
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result;
  do {
    result = '';
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(result));
  return result;
}

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name || 'Player';
    this.secretNumber = null;
    this.locked = false;
    this.guesses = [];
    this.won = false;
    this.connected = true;
  }
}

class Room {
  constructor(roomId, range = { min: 1, max: 100 }) {
    this.roomId = roomId;
    this.status = 'waiting'; // 'waiting', 'selecting', 'playing', 'finished', 'disconnected'
    this.range = range;
    this.player1 = null; // Creator
    this.player2 = null; // Joiner
    this.currentTurn = null; // socket id of player whose turn it is
    this.winnerId = null;
    this.duration = 0;
    this.startTime = null;
    this.createdAt = Date.now();
  }
}

// Sanitized representation of the room state to send to clients
function getSanitizedRoomState(room) {
  return {
    roomId: room.roomId,
    status: room.status,
    range: room.range,
    currentTurn: room.currentTurn,
    winnerId: room.winnerId,
    duration: room.duration,
    player1: room.player1 ? {
      id: room.player1.id,
      name: room.player1.name,
      locked: room.player1.locked,
      connected: room.player1.connected,
      guesses: room.player1.guesses,
      won: room.player1.won
    } : null,
    player2: room.player2 ? {
      id: room.player2.id,
      name: room.player2.name,
      locked: room.player2.locked,
      connected: room.player2.connected,
      guesses: room.player2.guesses,
      won: room.player2.won
    } : null
  };
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  // Handle Room Creation
  socket.on('create_room', ({ name, range }) => {
    // Validate range
    let min = 1;
    let max = 100;
    if (range && typeof range.min === 'number' && typeof range.max === 'number') {
      min = range.min;
      max = range.max;
    }

    if (min >= max || min < 1) {
      socket.emit('game_error', { message: 'Invalid range settings.' });
      return;
    }

    const roomId = generateRoomId();
    const room = new Room(roomId, { min, max });
    
    room.player1 = new Player(socket.id, name);
    rooms.set(roomId, room);

    currentRoomId = roomId;
    socket.join(roomId);

    socket.emit('room_created', { roomId, playerId: socket.id });
    io.to(roomId).emit('room_state_update', getSanitizedRoomState(room));
  });

  // Handle Room Joining
  socket.on('join_room', ({ name, roomId }) => {
    if (!roomId) {
      socket.emit('game_error', { message: 'Room code is required.' });
      return;
    }

    const upperRoomId = roomId.trim().toUpperCase();
    const room = rooms.get(upperRoomId);

    if (!room) {
      socket.emit('game_error', { message: 'Room code not found.' });
      return;
    }

    if (room.player1 && room.player2) {
      socket.emit('game_error', { message: 'Room is full.' });
      return;
    }

    if (room.status !== 'waiting') {
      socket.emit('game_error', { message: 'Game has already started in this room.' });
      return;
    }

    // Set player 2
    room.player2 = new Player(socket.id, name);
    room.status = 'selecting';
    
    currentRoomId = upperRoomId;
    socket.join(upperRoomId);

    socket.emit('room_joined', { roomId: upperRoomId, playerId: socket.id });
    io.to(upperRoomId).emit('room_state_update', getSanitizedRoomState(room));
  });

  // Handle Secret Number Locking
  socket.on('lock_number', ({ number }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'selecting') return;

    const player = room.player1.id === socket.id ? room.player1 : (room.player2 && room.player2.id === socket.id ? room.player2 : null);
    if (!player) return;

    if (player.locked) {
      socket.emit('game_error', { message: 'Number is already locked!' });
      return;
    }

    const num = parseInt(number, 10);
    if (isNaN(num) || num < room.range.min || num > room.range.max) {
      socket.emit('game_error', { message: `Enter a number between ${room.range.min} and ${room.range.max}.` });
      return;
    }

    player.secretNumber = num;
    player.locked = true;

    // Check if both are locked to start the game
    if (room.player1.locked && room.player2 && room.player2.locked) {
      room.status = 'playing';
      // Randomly choose who goes first
      room.currentTurn = Math.random() < 0.5 ? room.player1.id : room.player2.id;
      room.startTime = Date.now();
    }

    io.to(currentRoomId).emit('room_state_update', getSanitizedRoomState(room));
  });

  // Handle Guess Submission
  socket.on('submit_guess', ({ guess }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'playing') return;

    if (room.currentTurn !== socket.id) {
      socket.emit('game_error', { message: 'It is not your turn!' });
      return;
    }

    const player = room.player1.id === socket.id ? room.player1 : room.player2;
    const opponent = room.player1.id === socket.id ? room.player2 : room.player1;

    if (!player || !opponent) return;

    const guessNum = parseInt(guess, 10);
    if (isNaN(guessNum) || guessNum < room.range.min || guessNum > room.range.max) {
      socket.emit('game_error', { message: `Enter a guess between ${room.range.min} and ${room.range.max}.` });
      return;
    }

    let result = '';
    if (guessNum < opponent.secretNumber) {
      result = 'HIGHER';
    } else if (guessNum > opponent.secretNumber) {
      result = 'LOWER';
    } else {
      result = 'CORRECT';
    }

    player.guesses.push({ guess: guessNum, result });

    if (result === 'CORRECT') {
      player.won = true;
      room.winnerId = player.id;
      room.status = 'finished';
      room.duration = room.startTime ? Math.round((Date.now() - room.startTime) / 1000) : 0;
    } else {
      // Toggle turn
      room.currentTurn = opponent.id;
    }

    io.to(currentRoomId).emit('room_state_update', getSanitizedRoomState(room));
  });

  // Handle Restart Request
  socket.on('restart_game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || (room.status !== 'finished' && room.status !== 'disconnected')) return;

    // Reset game parameters
    if (room.player1) {
      room.player1.locked = false;
      room.player1.secretNumber = null;
      room.player1.guesses = [];
      room.player1.won = false;
      room.player1.connected = true;
    }
    if (room.player2) {
      room.player2.locked = false;
      room.player2.secretNumber = null;
      room.player2.guesses = [];
      room.player2.won = false;
      room.player2.connected = true;
    }

    room.status = 'selecting';
    room.currentTurn = null;
    room.winnerId = null;
    room.duration = 0;
    room.startTime = null;

    io.to(currentRoomId).emit('room_state_update', getSanitizedRoomState(room));
  });

  // Handle Disconnection
  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    let opponentActive = false;

    if (room.player1 && room.player1.id === socket.id) {
      room.player1.connected = false;
      if (room.player2 && room.player2.connected) opponentActive = true;
    } else if (room.player2 && room.player2.id === socket.id) {
      room.player2.connected = false;
      if (room.player1 && room.player1.connected) opponentActive = true;
    }

    if (opponentActive) {
      room.status = 'disconnected';
      io.to(currentRoomId).emit('room_state_update', getSanitizedRoomState(room));
    } else {
      // Both disconnected or no one active left, delete room
      rooms.delete(currentRoomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
