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
// Track length will be calculated from actual game data
let TRACK_LENGTH = 20000; // Default, will be updated from room data

// Initialize auth
onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
  } else {
    await signInAnonymously();
  }
});

// Auto-load room from URL if present
const urlParams = new URLSearchParams(window.location.search);
const urlRoomId = urlParams.get('roomId');
if (urlRoomId) {
  document.getElementById('roomIdInput').value = urlRoomId;
  // Wait for Firebase to be ready
  setTimeout(() => {
    loadRoom(urlRoomId);
  }, 1000);
}

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
    const roomRef = ref(`rooms/${roomId}`);
    off(roomRef);
  }

  roomId = roomIdParam;
  document.getElementById('currentRoomId').textContent = roomId;
  document.getElementById('roomInfo').style.display = 'block';

  // Initialize minimap
  minimapCanvas = document.getElementById('minimap');
  if (minimapCanvas) {
    minimapCtx = minimapCanvas.getContext('2d');
    minimapCanvas.width = minimapCanvas.offsetWidth;
    minimapCanvas.height = minimapCanvas.offsetHeight;
  }

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
 * Update F1-style minimap with player positions
 */
function updateMinimap() {
  if (!minimapCtx || !roomData || !roomData.players) return;

  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  const padding = 30;

  // Clear canvas
  minimapCtx.clearRect(0, 0, width, height);

  // Background
  minimapCtx.fillStyle = '#1a5c1a'; // Dark green (grass)
  minimapCtx.fillRect(0, 0, width, height);

  // Calculate track length from max position or use default
  const players = Object.entries(roomData.players);
  let maxPosition = 0;
  players.forEach(([uid, playerData]) => {
    const pos = playerData.position || 0;
    if (pos > maxPosition) maxPosition = pos;
  });
  // Use max position + buffer, or default if no players have moved
  const currentTrackLength = maxPosition > 1000 ? maxPosition + 1000 : TRACK_LENGTH;
  
  // Draw track outline - F1 style (curved track)
  const trackWidth = width - 2 * padding;
  const trackHeight = height - 2 * padding;
  const centerX = padding + trackWidth * 0.5;
  
  // Draw track (road)
  minimapCtx.strokeStyle = '#333333'; // Dark gray track
  minimapCtx.lineWidth = 40;
  minimapCtx.beginPath();
  
  // Create a curved track path (S-curve like F1 tracks)
  for (let i = 0; i <= 50; i++) {
    const progress = i / 50;
    const y = padding + trackHeight * progress;
    // Add curve based on progress (S-curve)
    const curveOffset = Math.sin(progress * Math.PI * 3) * (trackWidth * 0.25);
    const x = centerX + curveOffset;
    if (i === 0) {
      minimapCtx.moveTo(x, y);
    } else {
      minimapCtx.lineTo(x, y);
    }
  }
  minimapCtx.stroke();
  
  // Draw track center line (white dashed)
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = 2;
  minimapCtx.setLineDash([10, 10]);
  minimapCtx.beginPath();
  for (let i = 0; i <= 50; i++) {
    const progress = i / 50;
    const y = padding + trackHeight * progress;
    const curveOffset = Math.sin(progress * Math.PI * 3) * (trackWidth * 0.25);
    const x = centerX + curveOffset;
    if (i === 0) {
      minimapCtx.moveTo(x, y);
    } else {
      minimapCtx.lineTo(x, y);
    }
  }
  minimapCtx.stroke();
  minimapCtx.setLineDash([]); // Reset line dash
  
  // Draw players (cars) on track
  players.forEach(([uid, playerData]) => {
    const position = playerData.position || 0;
    const progress = Math.min(1, position / currentTrackLength);
    const playerX = playerData.playerX || 0;
    const playerSpeed = playerData.speed || 0;
    const playerName = playerData.name || 'Player';
    const isNitro = playerData.nitro || false;

    // Calculate position on minimap following the curved track
    const y = padding + trackHeight * progress;
    const curveOffset = Math.sin(progress * Math.PI * 3) * (trackWidth * 0.25);
    // Add lane offset (spread players horizontally based on playerX)
    const laneOffset = (playerX * trackWidth * 0.15);
    const x = centerX + curveOffset + laneOffset;

    // Draw car (small rectangle/circle)
    minimapCtx.fillStyle = isNitro ? '#ff9800' : '#2196F3'; // Orange if nitro, blue otherwise
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 2;
    
    // Draw car as a small rectangle (top-down view)
    minimapCtx.fillRect(x - 6, y - 3, 12, 6);
    minimapCtx.strokeRect(x - 6, y - 3, 12, 6);
    
    // Draw player name above car
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.font = 'bold 11px Arial';
    minimapCtx.textAlign = 'center';
    minimapCtx.textBaseline = 'bottom';
    
    // Add background for text readability
    const textMetrics = minimapCtx.measureText(playerName);
    const textWidth = textMetrics.width;
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    minimapCtx.fillRect(x - textWidth/2 - 3, y - 18, textWidth + 6, 14);
    
    // Draw text
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.fillText(playerName, x, y - 5);
    
    // Draw speed indicator below car
    const speedText = Math.round(playerSpeed / 100) + ' km/h';
    minimapCtx.font = '9px Arial';
    minimapCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    const speedMetrics = minimapCtx.measureText(speedText);
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    minimapCtx.fillRect(x - speedMetrics.width/2 - 2, y + 4, speedMetrics.width + 4, 12);
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.fillText(speedText, x, y + 14);
  });
  
  // Draw start/finish line
  minimapCtx.strokeStyle = '#ffff00'; // Yellow
  minimapCtx.lineWidth = 3;
  minimapCtx.beginPath();
  const startY = padding;
  const startCurve = Math.sin(0 * Math.PI * 3) * (trackWidth * 0.25);
  const startX = centerX + startCurve;
  minimapCtx.moveTo(startX - 20, startY);
  minimapCtx.lineTo(startX + 20, startY);
  minimapCtx.stroke();
  
  // Draw finish line (at end of track)
  const finishY = padding + trackHeight;
  const finishCurve = Math.sin(1 * Math.PI * 3) * (trackWidth * 0.25);
  const finishX = centerX + finishCurve;
  minimapCtx.strokeStyle = '#ff0000'; // Red
  minimapCtx.beginPath();
  minimapCtx.moveTo(finishX - 20, finishY);
  minimapCtx.lineTo(finishX + 20, finishY);
  minimapCtx.stroke();
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
