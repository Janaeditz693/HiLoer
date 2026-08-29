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
    const { roomId } = req.body;

    if (!roomId) {
      return res.status(400).json({ message: 'Room code is required.' });
    }

    const upperRoomId = roomId.trim().toUpperCase();
    const room = await dbRequest(`rooms/${upperRoomId}`);

    if (!room) {
      return res.status(404).json({ message: 'Room not found.' });
    }

    if (room.status !== 'finished' && room.status !== 'disconnected') {
      return res.status(400).json({ message: 'Game cannot be restarted at this state.' });
    }

    // 1. Wipe secret numbers securely from Firebase
    await dbRequest(`secrets/${upperRoomId}`, 'DELETE');

    // 2. Reset player state parameters
    const resetPlayer1 = room.player1 ? {
      ...room.player1,
      locked: false,
      guesses: [],
      won: false,
      connected: true
    } : null;

    const resetPlayer2 = room.player2 ? {
      ...room.player2,
      locked: false,
      guesses: [],
      won: false,
      connected: true
    } : null;

    await dbRequest(`rooms/${upperRoomId}`, 'PATCH', {
      player1: resetPlayer1,
      player2: resetPlayer2,
      status: 'selecting',
      currentTurn: null,
      winnerId: null,
      duration: 0,
      startTime: null
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
};
