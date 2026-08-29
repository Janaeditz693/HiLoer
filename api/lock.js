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
    const { roomId, playerId, number } = req.body;

    if (!roomId || !playerId || number === undefined) {
      return res.status(400).json({ message: 'Missing required parameters.' });
    }

    const upperRoomId = roomId.trim().toUpperCase();
    const room = await dbRequest(`rooms/${upperRoomId}`);

    if (!room) {
      return res.status(404).json({ message: 'Room not found.' });
    }

    if (room.status !== 'selecting') {
      return res.status(400).json({ message: 'Room is not in selection phase.' });
    }

    const isP1 = room.player1 && room.player1.id === playerId;
    const isP2 = room.player2 && room.player2.id === playerId;

    if (!isP1 && !isP2) {
      return res.status(403).json({ message: 'Player is not in this room.' });
    }

    const playerKey = isP1 ? 'player1' : 'player2';
    const playerObj = room[playerKey];

    if (playerObj.locked) {
      return res.status(400).json({ message: 'Your secret number is already locked.' });
    }

    const num = parseInt(number, 10);
    if (isNaN(num) || num < room.range.min || num > room.range.max) {
      return res.status(400).json({ message: `Enter a number between ${room.range.min} and ${room.range.max}.` });
    }

    // 1. Securely store the secret number under secrets/ROOM/PLAYER_ID
    await dbRequest(`secrets/${upperRoomId}/${playerId}`, 'PUT', num);

    // 2. Update player's locked status in the public room representation
    const updatedPlayer = { ...playerObj, locked: true };

    const updates = {};
    updates[playerKey] = updatedPlayer;

    // Check if both players are now locked
    const opponentKey = isP1 ? 'player2' : 'player1';
    const opponentObj = room[opponentKey];

    if (opponentObj && opponentObj.locked) {
      updates.status = 'playing';
      // Randomly select starting turn
      updates.currentTurn = Math.random() < 0.5 ? room.player1.id : room.player2.id;
      updates.startTime = Date.now();
    }

    await dbRequest(`rooms/${upperRoomId}`, 'PATCH', updates);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
};
