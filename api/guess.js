const DB_URL = process.env.FIREBASE_DATABASE_URL;
const DB_SECRET = process.env.FIREBASE_DATABASE_SECRET;

async function dbRequest(path, method = 'GET', body = null) {
  if (!DB_URL) {
    throw new Error('FIREBASE_DATABASE_URL environment variable is missing.');
  }
  const baseUrl = DB_URL.endsWith('/') ? DB_URL.slice(0, -1) : DB_URL;
  const url = `${baseUrl}/${path}.json${DB_SECRET ? `?auth=${DB_SECRET}` : ''}`;
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Firebase REST API error: ${response.statusText}`);
  }
  return response.json();
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { roomId, playerId, guess } = req.body;

    if (!roomId || !playerId || guess === undefined) {
      return res.status(400).json({ message: 'Missing required parameters.' });
    }

    const upperRoomId = roomId.trim().toUpperCase();
    const room = await dbRequest(`rooms/${upperRoomId}`);

    if (!room) {
      return res.status(404).json({ message: 'Room not found.' });
    }

    if (room.status !== 'playing') {
      return res.status(400).json({ message: 'Room is not in playing phase.' });
    }

    if (room.currentTurn !== playerId) {
      return res.status(400).json({ message: 'It is not your turn!' });
    }

    const isP1 = room.player1 && room.player1.id === playerId;
    const isP2 = room.player2 && room.player2.id === playerId;

    if (!isP1 && !isP2) {
      return res.status(403).json({ message: 'Player is not in this room.' });
    }

    const playerKey = isP1 ? 'player1' : 'player2';
    const opponentKey = isP1 ? 'player2' : 'player1';

    const playerObj = room[playerKey];
    const opponentObj = room[opponentKey];

    if (!playerObj || !opponentObj) {
      return res.status(400).json({ message: 'Both players must be in the game.' });
    }

    const guessNum = parseInt(guess, 10);
    if (isNaN(guessNum) || guessNum < room.range.min || guessNum > room.range.max) {
      return res.status(400).json({ message: `Enter a guess between ${room.range.min} and ${room.range.max}.` });
    }

    // 1. Fetch opponent's secret number securely from Firebase
    const opponentSecretNumberObj = await dbRequest(`secrets/${upperRoomId}/${opponentObj.id}`);
    const opponentSecretNumber = parseInt(opponentSecretNumberObj, 10);

    if (isNaN(opponentSecretNumber)) {
      return res.status(500).json({ message: 'Opponent secret number is missing or corrupted.' });
    }

    // 2. Perform validation and comparison
    let result = '';
    if (guessNum < opponentSecretNumber) {
      result = 'HIGHER';
    } else if (guessNum > opponentSecretNumber) {
      result = 'LOWER';
    } else {
      result = 'CORRECT';
    }

    const guesses = playerObj.guesses ? [...playerObj.guesses] : [];
    guesses.push({ guess: guessNum, result });

    const updatedPlayer = { ...playerObj, guesses };
    const updates = {};

    if (result === 'CORRECT') {
      updatedPlayer.won = true;
      updates[playerKey] = updatedPlayer;
      updates.winnerId = playerId;
      updates.status = 'finished';
      updates.duration = room.startTime ? Math.round((Date.now() - room.startTime) / 1000) : 0;
    } else {
      updates[playerKey] = updatedPlayer;
      // Pass turn to opponent
      updates.currentTurn = opponentObj.id;
    }

    await dbRequest(`rooms/${upperRoomId}`, 'PATCH', updates);

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
};
