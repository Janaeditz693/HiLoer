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

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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
    const { name, range, playerId } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Nickname is required.' });
    }

    if (!playerId) {
      return res.status(400).json({ message: 'Player ID is required.' });
    }

    let min = 1;
    let max = 100;
    if (range && typeof range.min === 'number' && typeof range.max === 'number') {
      min = range.min;
      max = range.max;
    }

    if (min >= max || min < 1) {
      return res.status(400).json({ message: 'Invalid range bounds.' });
    }

    // Generate unique Room Code
    let roomId = '';
    let attempts = 0;
    while (attempts < 5) {
      const code = generateRoomId();
      const existing = await dbRequest(`rooms/${code}`);
      if (!existing) {
        roomId = code;
        break;
      }
      attempts++;
    }

    if (!roomId) {
      return res.status(500).json({ message: 'Failed to generate a unique room code.' });
    }

    // Build initial room payload
    const roomState = {
      roomId,
      status: 'waiting',
      range: { min, max },
      player1: {
        id: playerId,
        name: name.trim(),
        locked: false,
        connected: true,
        guesses: [],
        won: false
      },
      player2: null,
      currentTurn: null,
      winnerId: null,
      duration: 0,
      createdAt: Date.now()
    };

    // Store in Firebase
    await dbRequest(`rooms/${roomId}`, 'PUT', roomState);

    return res.status(200).json({ success: true, roomId, playerId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
};
