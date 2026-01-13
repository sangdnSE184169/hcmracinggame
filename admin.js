//=========================================================================
// Admin Dashboard
//=========================================================================

import { getAuth, getDatabase, ref, set, update, onValue, get, signInAnonymously, onAuthStateChanged, initFirebase } from './firebase.js';
import { createQuiz, endQuiz } from './quiz.js';

// Initialize Firebase
if (!initFirebase()) {
  console.error('Failed to initialize Firebase in admin.js');
}

const auth = getAuth();
const db = getDatabase();

let currentUser = null;
let roomId = null;
let roomData = null;
let roomListener = null;
let minimapCanvas = null;
let minimapCtx = null;
const TRACK_LENGTH = 20000; // Approximate track length

// Initialize auth
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
  } else {
    await signInAnonymously(auth);
  }
});

// Load room button
document.getElementById('loadRoom').addEventListener('click', () => {
  const inputRoomId = document.getElementById('roomIdInput').value.trim();
  if (inputRoomId) {
    loadRoom(inputRoomId);
  }
});

// Start race button
document.getElementById('startRace').addEventListener('click', async () => {
  if (!roomId) return;
  
  const roomRef = ref(`rooms/${roomId}`);
  await update(roomRef, {
    status: 'running',
    startTime: Date.now()
  });
});

// End race button
document.getElementById('endRace').addEventListener('click', async () => {
  if (!roomId) return;
  
  const roomRef = ref(`rooms/${roomId}`);
  await update(roomRef, {
    status: 'finished'
  });
});

// Start quiz button
document.getElementById('startQuiz').addEventListener('click', async () => {
  if (!roomId) return;

  const question = document.getElementById('quizQuestion').value.trim();
  const option1 = document.getElementById('quizOption1').value.trim();
  const option2 = document.getElementById('quizOption2').value.trim();
  const option3 = document.getElementById('quizOption3').value.trim();
  const option4 = document.getElementById('quizOption4').value.trim();
  const correctIndex = parseInt(document.getElementById('quizCorrect').value);

  if (!question || !option1 || !option2 || !option3 || !option4) {
    alert('Please fill in all quiz fields');
    return;
  }

  await createQuiz(question, [option1, option2, option3, option4], correctIndex);

  // Auto-end quiz after 5 seconds
  setTimeout(async () => {
    await endQuiz();
  }, 5000);
});

/**
 * Load room and start listening
 */
function loadRoom(roomIdParam) {
  // Cleanup previous listener
  if (roomListener && roomId) {
    const roomRef = ref(db, `rooms/${roomId}`);
    off(roomRef);
  }

  roomId = roomIdParam;
  document.getElementById('currentRoomId').textContent = roomId;
  document.getElementById('roomInfo').style.display = 'block';

  // Initialize minimap
  minimapCanvas = document.getElementById('minimap');
  minimapCtx = minimapCanvas.getContext('2d');
  minimapCanvas.width = minimapCanvas.offsetWidth;
  minimapCanvas.height = minimapCanvas.offsetHeight;

  // Listen to room updates
  const roomRef = ref(`rooms/${roomId}`);
  roomListener = onValue(roomRef, (snapshot) => {
    roomData = snapshot.val();
    if (roomData) {
      updateMinimap();
      updateRankings();
      checkWinner();
    }
  });
}

/**
 * Update minimap with player positions
 */
function updateMinimap() {
  if (!minimapCtx || !roomData || !roomData.players) return;

  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  const padding = 20;

  // Clear canvas
  minimapCtx.clearRect(0, 0, width, height);

  // Draw track outline
  minimapCtx.strokeStyle = '#333';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(padding, padding);
  minimapCtx.lineTo(width - padding, padding);
  minimapCtx.lineTo(width - padding, height - padding);
  minimapCtx.lineTo(padding, height - padding);
  minimapCtx.closePath();
  minimapCtx.stroke();

  // Draw players
  const players = Object.entries(roomData.players);
  players.forEach(([uid, playerData]) => {
    const position = playerData.position || 0;
    const progress = Math.min(1, position / TRACK_LENGTH);

    // Calculate position on minimap (top to bottom)
    const x = padding + (width - 2 * padding) * 0.5; // Center horizontally
    const y = padding + (height - 2 * padding) * progress;

    // Draw player dot
    minimapCtx.fillStyle = playerData.nitro ? '#ff9800' : '#2196F3';
    minimapCtx.beginPath();
    minimapCtx.arc(x, y, 6, 0, Math.PI * 2);
    minimapCtx.fill();

    // Draw player name
    minimapCtx.fillStyle = 'white';
    minimapCtx.font = '10px Arial';
    minimapCtx.textAlign = 'center';
    minimapCtx.fillText(playerData.name || 'Player', x, y - 10);
  });
}

/**
 * Update rankings list
 */
function updateRankings() {
  if (!roomData || !roomData.players) return;

  const rankingList = document.getElementById('rankingList');
  rankingList.innerHTML = '';

  // Sort players by position (descending)
  const players = Object.entries(roomData.players)
    .map(([uid, data]) => ({
      uid,
      name: data.name || 'Player',
      position: data.position || 0,
      speed: data.speed || 0,
      nitro: data.nitro || false,
      finished: data.finished || false
    }))
    .sort((a, b) => b.position - a.position);

  players.forEach((player, index) => {
    const item = document.createElement('div');
    item.className = 'ranking-item';
    if (index === 0) {
      item.classList.add('first');
    }

    item.innerHTML = `
      <span class="ranking-position">#${index + 1}</span>
      <span class="ranking-name">${player.name} ${player.nitro ? '⚡' : ''}</span>
      <span class="ranking-stats">${Math.round(player.position)}m | ${Math.round(player.speed)} km/h</span>
    `;

    rankingList.appendChild(item);
  });
}

/**
 * Check for winner
 */
function checkWinner() {
  if (!roomData || !roomData.players) return;

  const players = Object.values(roomData.players);
  const finishedPlayers = players.filter(p => p.finished);

  if (finishedPlayers.length > 0 && roomData.status === 'running') {
    // Find first player to finish
    const winner = finishedPlayers[0];
    showWinner(winner.name || 'Player');
    
    // Update room status
    const roomRef = ref(db, `rooms/${roomId}`);
    update(roomRef, { status: 'finished' });
  }
}

/**
 * Show winner modal
 */
function showWinner(winnerName) {
  document.getElementById('winnerName').textContent = `Winner: ${winnerName}`;
  document.getElementById('winnerModal').classList.add('active');
}
