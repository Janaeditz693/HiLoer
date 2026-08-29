// Application State
let playerId = sessionStorage.getItem('hilo_player_id');
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).substr(2, 9);
  sessionStorage.setItem('hilo_player_id', playerId);
}

let db = null;
let roomRef = null;
let currentRoom = null;
let selectedRange = { min: 1, max: 100 };

// DOM Element Caching
const screens = {
  landing: document.getElementById('screen-landing'),
  join: document.getElementById('screen-join'),
  lobby: document.getElementById('screen-lobby'),
  setup: document.getElementById('screen-setup'),
  game: document.getElementById('screen-game'),
  win: document.getElementById('screen-win'),
  disconnect: document.getElementById('screen-disconnect')
};

// Inputs and Buttons
const nameInput = document.getElementById('player-name-input');
const roomCodeInput = document.getElementById('room-code-input');
const manualNumberInput = document.getElementById('manual-number-input');
const guessInput = document.getElementById('guess-input');

const btnCreateGame = document.getElementById('btn-create-game');
const btnShowJoin = document.getElementById('btn-show-join');
const btnJoinRoom = document.getElementById('btn-join-room');
const btnBackToLanding = document.getElementById('btn-back-to-landing');
const btnCopyCode = document.getElementById('btn-copy-code');
const btnShareCode = document.getElementById('btn-share-code');
const btnAutoSelect = document.getElementById('btn-auto-select');
const btnLockNumber = document.getElementById('btn-lock-number');
const btnSubmitGuess = document.getElementById('btn-submit-guess');
const btnRestartGame = document.getElementById('btn-restart-game');
const btnLeaveGame = document.getElementById('btn-leave-game');
const btnDisconnectRestart = document.getElementById('btn-disconnect-restart');

// Settings Accordion
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsContainer = document.querySelector('.settings-container');
const rangeBtns = document.querySelectorAll('.range-btn');

// Dynamic Text Elements
const lobbyRoomCode = document.getElementById('lobby-room-code');
const lobbyP1Name = document.getElementById('lobby-p1-name');
const lobbyP2Name = document.getElementById('lobby-p2-name');
const lobbyP2Bullet = document.getElementById('lobby-p2-bullet');
const lobbyReadyBanner = document.getElementById('lobby-ready-banner');

const setupRangeMin = document.getElementById('setup-range-min');
const setupRangeMax = document.getElementById('setup-range-max');
const setupControls = document.getElementById('setup-controls');
const setupLockedCard = document.getElementById('setup-locked-card');

const gameTurnBanner = document.getElementById('game-turn-banner');
const gameP1Name = document.getElementById('game-p1-name');
const gameP1Status = document.getElementById('game-p1-status');
const gameP1GuessCount = document.getElementById('game-p1-guess-count');
const gameP2Name = document.getElementById('game-p2-name');
const gameP2Status = document.getElementById('game-p2-status');
const gameP2GuessCount = document.getElementById('game-p2-guess-count');
const gameRangeMin = document.getElementById('game-range-min');
const gameRangeMax = document.getElementById('game-range-max');
const guessFeedback = document.getElementById('guess-feedback');
const myHistoryList = document.getElementById('my-history-list');
const opponentHistoryList = document.getElementById('opponent-history-list');

const winHeadline = document.getElementById('win-headline');
const winDescription = document.getElementById('win-description');
const winStatGuesses = document.getElementById('win-stat-guesses');
const winStatDuration = document.getElementById('win-stat-duration');

const toast = document.getElementById('toast');

// Initialize name from localStorage if available
if (localStorage.getItem('hilo_nickname')) {
  nameInput.value = localStorage.getItem('hilo_nickname');
}

// -------------------------------------------------------------
// Firebase Initialization & Syncing
// -------------------------------------------------------------

async function initFirebase() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();

    if (!config.apiKey || !config.databaseURL) {
      showToast("Firebase is not configured! Add credentials to Vercel env.");
      return;
    }

    firebase.initializeApp(config);
    db = firebase.database();

    // Check if we arrived via a share link
    const urlParams = new URLSearchParams(window.location.search);
    const sharedRoomCode = urlParams.get('room');
    if (sharedRoomCode) {
      showScreen('join');
      roomCodeInput.value = sharedRoomCode.trim().toUpperCase();
      showToast("Joined via shared room link!");
    }
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    showToast("Failed to load game server configurations.");
  }
}

function subscribeToRoom(roomId) {
  if (!db) return;

  if (roomRef) {
    roomRef.off();
  }

  roomRef = db.ref('rooms/' + roomId);
  roomRef.on('value', (snapshot) => {
    const state = snapshot.val();
    if (state) {
      currentRoom = state;
      renderGame(state);
      setupDisconnectHandler(roomId, state);
    }
  });
}

function setupDisconnectHandler(roomId, roomState) {
  if (!db) return;

  const isP1 = roomState.player1 && roomState.player1.id === playerId;
  const isP2 = roomState.player2 && roomState.player2.id === playerId;

  if (!isP1 && !isP2) return;

  const playerKey = isP1 ? 'player1' : 'player2';

  // Mark player as disconnected on database if connection drops
  db.ref(`rooms/${roomId}/${playerKey}/connected`).onDisconnect().set(false);
  // Transition room status to disconnected
  db.ref(`rooms/${roomId}/status`).onDisconnect().set('disconnected');
}

// Kick off Firebase Setup
initFirebase();

// -------------------------------------------------------------
// UI Utilities & Transitions
// -------------------------------------------------------------

function showScreen(screenId) {
  Object.keys(screens).forEach(id => {
    if (id === screenId) {
      screens[id].classList.add('active');
    } else {
      screens[id].classList.remove('active');
    }
  });
}

function showToast(message, duration = 3000) {
  toast.innerText = message;
  toast.classList.add('active');
  setTimeout(() => {
    toast.classList.remove('active');
  }, duration);
}

// Toggle Settings Accordion
settingsToggleBtn.addEventListener('click', () => {
  settingsContainer.classList.toggle('open');
});

// Range Selection
rangeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    rangeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRange.min = parseInt(btn.dataset.min, 10);
    selectedRange.max = parseInt(btn.dataset.max, 10);
  });
});

// -------------------------------------------------------------
// Navigation & Input Validation Actions (REST requests)
// -------------------------------------------------------------

function getCleanName() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.add('shake-input');
    setTimeout(() => nameInput.classList.remove('shake-input'), 400);
    showToast("Please enter your name first!");
    return null;
  }
  localStorage.setItem('hilo_nickname', name);
  return name;
}

btnCreateGame.addEventListener('click', async () => {
  const name = getCleanName();
  if (!name) return;

  try {
    const res = await fetch('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, range: selectedRange, playerId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.message || "Failed to create room.");
      return;
    }
    subscribeToRoom(data.roomId);
    showScreen('lobby');
  } catch (err) {
    showToast("Network error creating room.");
  }
});

btnShowJoin.addEventListener('click', () => {
  const name = getCleanName();
  if (!name) return;

  showScreen('join');
});

btnBackToLanding.addEventListener('click', () => {
  showScreen('landing');
});

btnJoinRoom.addEventListener('click', async () => {
  const name = getCleanName();
  if (!name) return;

  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) {
    roomCodeInput.classList.add('shake-input');
    setTimeout(() => roomCodeInput.classList.remove('shake-input'), 400);
    showToast("Please enter a room code!");
    return;
  }

  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, roomId: code, playerId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.message || "Failed to join room.");
      return;
    }
    subscribeToRoom(data.roomId);
    showScreen('lobby');
  } catch (err) {
    showToast("Network error joining room.");
  }
});

// Copy Room Code to Clipboard
btnCopyCode.addEventListener('click', () => {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom.roomId)
    .then(() => showToast("Room code copied to clipboard!"))
    .catch(() => showToast("Failed to copy code."));
});

// Share Game Link
btnShareCode.addEventListener('click', () => {
  if (!currentRoom) return;
  const shareUrl = `${window.location.origin}/?room=${currentRoom.roomId}`;
  
  if (navigator.share) {
    navigator.share({
      title: 'Higher or Lower Game',
      text: `Join my game room: ${currentRoom.roomId}!`,
      url: shareUrl
    }).catch(err => console.log(err));
  } else {
    navigator.clipboard.writeText(shareUrl)
      .then(() => showToast("Share link copied to clipboard!"))
      .catch(() => showToast("Failed to copy link."));
  }
});

// -------------------------------------------------------------
// Secret Number Selection
// -------------------------------------------------------------

// Auto select helper
btnAutoSelect.addEventListener('click', async () => {
  if (!currentRoom) return;
  const min = currentRoom.range.min;
  const max = currentRoom.range.max;
  const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
  
  try {
    const res = await fetch('/api/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: currentRoom.roomId, playerId, number: randomNum })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.message || "Failed to lock secret number.");
    }
  } catch (err) {
    showToast("Network error locking secret number.");
  }
});

// Manual select helper
btnLockNumber.addEventListener('click', async () => {
  if (!currentRoom) return;
  const num = parseInt(manualNumberInput.value, 10);
  const min = currentRoom.range.min;
  const max = currentRoom.range.max;

  if (isNaN(num) || num < min || num > max) {
    manualNumberInput.classList.add('shake-input');
    setTimeout(() => manualNumberInput.classList.remove('shake-input'), 400);
    showToast(`Enter a number between ${min} and ${max}.`);
    return;
  }

  try {
    const res = await fetch('/api/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: currentRoom.roomId, playerId, number: num })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.message || "Failed to lock secret number.");
    }
  } catch (err) {
    showToast("Network error locking secret number.");
  }
});

// -------------------------------------------------------------
// Main Game Loop Guessing Actions
// -------------------------------------------------------------

btnSubmitGuess.addEventListener('click', async () => {
  if (!currentRoom) return;
  const guess = parseInt(guessInput.value, 10);
  const min = currentRoom.range.min;
  const max = currentRoom.range.max;

  if (isNaN(guess) || guess < min || guess > max) {
    guessInput.classList.add('shake-input');
    setTimeout(() => guessInput.classList.remove('shake-input'), 400);
    showToast(`Enter a guess between ${min} and ${max}.`);
    return;
  }

  try {
    const res = await fetch('/api/guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: currentRoom.roomId, playerId, guess })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.message || "Failed to submit guess.");
    } else {
      guessInput.value = ''; // clear field on success
    }
  } catch (err) {
    showToast("Network error submitting guess.");
  }
});

// Allow hitting 'Enter' to submit guess
guessInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSubmitGuess.click();
  }
});

// Play Again & Leave handlers
btnRestartGame.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: currentRoom.roomId })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.message || "Failed to restart game.");
    }
  } catch (err) {
    showToast("Network error restarting game.");
  }
});

btnLeaveGame.addEventListener('click', () => {
  window.location.reload();
});

btnDisconnectRestart.addEventListener('click', () => {
  window.location.reload();
});

// -------------------------------------------------------------
// Rendering Loop
// -------------------------------------------------------------

function renderGame(room) {
  // 1. Identify self and opponent players from state
  const isPlayer1 = room.player1 && room.player1.id === playerId;
  const me = isPlayer1 ? room.player1 : room.player2;
  const opponent = isPlayer1 ? room.player2 : room.player1;

  // 2. Handle Screen Transitions & Screen States
  if (room.status === 'waiting') {
    showScreen('lobby');
    lobbyRoomCode.innerText = room.roomId;
    
    if (room.player1) {
      lobbyP1Name.innerText = `${room.player1.name} (You)`;
    }

    lobbyP2Name.innerText = 'Waiting for opponent...';
    lobbyP2Bullet.className = 'player-bullet waiting';
    lobbyReadyBanner.style.display = 'none';

  } else if (room.status === 'selecting') {
    showScreen('setup');
    setupRangeMin.innerText = room.range.min;
    setupRangeMax.innerText = room.range.max;

    if (me && me.locked) {
      setupControls.style.display = 'none';
      setupLockedCard.style.display = 'flex';
      manualNumberInput.value = '';
    } else {
      setupControls.style.display = 'flex';
      setupLockedCard.style.display = 'none';
    }

  } else if (room.status === 'playing') {
    showScreen('game');
    
    // Set ranges
    gameRangeMin.innerText = room.range.min;
    gameRangeMax.innerText = room.range.max;

    // Player Information panels
    gameP1Name.innerText = me ? `${me.name} (You)` : 'You';
    gameP1Status.innerText = me && me.connected ? 'Connected' : 'Disconnected';
    gameP1Status.className = `connection-status ${me && me.connected ? 'connected' : 'disconnected'}`;
    gameP1GuessCount.innerText = me && me.guesses ? Object.keys(me.guesses).length : '0';

    gameP2Name.innerText = opponent ? opponent.name : 'Opponent';
    gameP2Status.innerText = opponent && opponent.connected ? 'Connected' : 'Disconnected';
    gameP2Status.className = `connection-status ${opponent && opponent.connected ? 'connected' : 'disconnected'}`;
    gameP2GuessCount.innerText = opponent && opponent.guesses ? Object.keys(opponent.guesses).length : '0';

    // Active Turn UI configuration
    const isMyTurn = room.currentTurn === playerId;
    if (isMyTurn) {
      gameTurnBanner.innerText = 'YOUR TURN';
      gameTurnBanner.className = 'turn-banner your-turn';
      guessInput.disabled = false;
      btnSubmitGuess.disabled = false;
    } else {
      gameTurnBanner.innerText = `${opponent ? opponent.name.toUpperCase() : "OPPONENT"}'S TURN`;
      gameTurnBanner.className = 'turn-banner opponent-turn';
      guessInput.disabled = true;
      btnSubmitGuess.disabled = true;
    }

    // Active Feedback banner configuration
    const myGuessesArray = me && me.guesses ? Object.values(me.guesses) : [];
    if (myGuessesArray.length > 0) {
      const lastGuess = myGuessesArray[myGuessesArray.length - 1];
      guessFeedback.style.display = 'inline-block';
      guessFeedback.className = 'guess-feedback-alert'; // clear extra styling classes
      
      if (lastGuess.result === 'HIGHER') {
        guessFeedback.innerText = '⬆ HIGHER';
        guessFeedback.classList.add('higher');
      } else if (lastGuess.result === 'LOWER') {
        guessFeedback.innerText = '⬇ LOWER';
        guessFeedback.classList.add('lower');
      } else if (lastGuess.result === 'CORRECT') {
        guessFeedback.innerText = '🎯 CORRECT!';
        guessFeedback.classList.add('correct');
      }
    } else {
      guessFeedback.style.display = 'none';
    }

    // Guess History columns rendering
    renderHistoryList(myHistoryList, myGuessesArray);
    renderHistoryList(opponentHistoryList, opponent && opponent.guesses ? Object.values(opponent.guesses) : []);

  } else if (room.status === 'finished') {
    showScreen('win');
    
    const isWinner = room.winnerId === playerId;
    if (isWinner) {
      winHeadline.innerText = '🎯 YOU FOUND IT!';
      winDescription.innerText = 'You win!';
      document.querySelector('.trophy-emoji').innerText = '🏆';
    } else {
      winHeadline.innerText = 'Better luck next time!';
      winDescription.innerText = `${opponent ? opponent.name : 'Opponent'} found your number.`;
      document.querySelector('.trophy-emoji').innerText = '💀';
    }

    const myGuessesArray = me && me.guesses ? Object.values(me.guesses) : [];
    winStatGuesses.innerText = myGuessesArray.length;
    winStatDuration.innerText = `${room.duration}s`;

  } else if (room.status === 'disconnected') {
    showScreen('disconnect');
  }
}

function renderHistoryList(element, guesses) {
  element.innerHTML = '';
  // Show guesses in reverse order so the latest is always at the top
  const reversedGuesses = [...guesses].reverse();
  
  reversedGuesses.forEach(g => {
    const li = document.createElement('li');
    const badgeClass = g.result.toLowerCase();
    
    li.innerHTML = `
      <span>${g.guess}</span>
      <span class="arrow">→</span>
      <span class="result-badge ${badgeClass}">${g.result}</span>
    `;
    element.appendChild(li);
  });
}
