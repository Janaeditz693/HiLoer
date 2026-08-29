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
    const { name, roomId, playerId } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Nickname is required.' });
    }

    if (!roomId) {
      return res.status(400).json({ message: 'Room code is required.' });
    }

    if (!playerId) {
      return res.status(400).json({ message: 'Player ID is required.' });
    }

    const upperRoomId = roomId.trim().toUpperCase();
    const room = await dbRequest(`rooms/${upperRoomId}`);

    if (!room) {
      return res.status(404).json({ message: 'Room code not found.' });
    }

    if (room.player2) {
      return res.status(400).json({ message: 'Room is full.' });
    }

    if (room.status !== 'waiting') {
      return res.status(400).json({ message: 'Game has already started in this room.' });
    }

    // Add player 2 and transition status
    const player2Data = {
      id: playerId,
      name: name.trim(),
      locked: false,
      connected: true,
      guesses: [],
      won: false
    };

    await dbRequest(`rooms/${upperRoomId}`, 'PATCH', {
      player2: player2Data,
      status: 'selecting'
    });

    return res.status(200).json({ success: true, roomId: upperRoomId, playerId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Internal server error' });
  }
};
