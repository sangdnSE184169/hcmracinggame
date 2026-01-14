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
let leaderUid = null; // UID of current leader

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

  // Listen to room updates
  const roomRef = ref(`rooms/${roomId}`);
  roomListener = onValue(roomRef, (snapshot) => {
    roomData = snapshot.val();
    if (roomData) {
      updateLeaderView();
      updateRankings();
      checkWinner();
    }
  });
}

/**
 * Update leader view (iframe showing leader's screen)
 */
function updateLeaderView() {
  if (!roomData || !roomData.players) return;

  // Find leader (player with highest position)
  const players = Object.entries(roomData.players);
  if (players.length === 0) return;

  let maxPosition = -1;
  let newLeaderUid = null;

  players.forEach(([uid, playerData]) => {
    const pos = playerData.position || 0;
    if (pos > maxPosition) {
      maxPosition = pos;
      newLeaderUid = uid;
    }
  });

  // Only update if leader changed
  if (newLeaderUid && newLeaderUid !== leaderUid) {
    leaderUid = newLeaderUid;
    const leaderViewFrame = document.getElementById('leaderViewFrame');
    
    // Create iframe to show leader's view
    // Note: This requires the game to support a spectator/view mode
    // For now, we'll create an iframe pointing to the leader's game session
    const leaderUrl = `index.html?roomId=${roomId}&uid=${leaderUid}&viewMode=spectator`;
    
    // Remove existing iframe if any
    leaderViewFrame.innerHTML = '';
    
    // Create new iframe
    const iframe = document.createElement('iframe');
    iframe.src = leaderUrl;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '5px';
    iframe.allowFullscreen = true;
    
    leaderViewFrame.appendChild(iframe);
  }
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
