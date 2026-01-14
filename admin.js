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
// Track geometry (recreated from game logic)
let trackSegments = [];
let trackLength = 0;
const SEGMENT_LENGTH = 200; // Same as in racer.js

// Road constants (same as in racer.js)
const ROAD = {
  LENGTH: { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 },
  HILL: { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 },
  CURVE: { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 }
};

// Helper functions to recreate track geometry
function lastY() {
  return trackSegments.length === 0 ? 0 : trackSegments[trackSegments.length - 1].p2.y;
}

function easeIn(a, b, percent) {
  return a + (b - a) * Math.pow(percent, 2);
}

function easeInOut(a, b, percent) {
  return a + (b - a) * ((-Math.cos(percent * Math.PI) / 2) + 0.5);
}

function addSegment(curve, y) {
  const n = trackSegments.length;
  trackSegments.push({
    index: n,
    p1: { y: lastY(), z: n * SEGMENT_LENGTH },
    p2: { y: y, z: (n + 1) * SEGMENT_LENGTH },
    curve: curve
  });
}

function addRoad(enter, hold, leave, curve, y) {
  const startY = lastY();
  const endY = startY + (y * SEGMENT_LENGTH);
  const total = enter + hold + leave;
  
  for (let n = 0; n < enter; n++) {
    addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  }
  for (let n = 0; n < hold; n++) {
    addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  }
  for (let n = 0; n < leave; n++) {
    addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
  }
}

function addStraight(num) {
  num = num || ROAD.LENGTH.MEDIUM;
  addRoad(num, num, num, 0, 0);
}

function addHill(num, height) {
  num = num || ROAD.LENGTH.MEDIUM;
  height = height || ROAD.HILL.MEDIUM;
  addRoad(num, num, num, 0, height);
}

function addCurve(num, curve, height) {
  num = num || ROAD.LENGTH.MEDIUM;
  curve = curve || ROAD.CURVE.MEDIUM;
  height = height || ROAD.HILL.NONE;
  addRoad(num, num, num, curve, height);
}

function addLowRollingHills(num, height) {
  num = num || ROAD.LENGTH.SHORT;
  height = height || ROAD.HILL.LOW;
  addRoad(num, num, num, 0, height / 2);
  addRoad(num, num, num, 0, -height);
  addRoad(num, num, num, ROAD.CURVE.EASY, height);
  addRoad(num, num, num, 0, 0);
  addRoad(num, num, num, -ROAD.CURVE.EASY, height / 2);
  addRoad(num, num, num, 0, 0);
}

function addSCurves() {
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY, ROAD.HILL.NONE);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.CURVE.EASY, -ROAD.HILL.LOW);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.EASY, ROAD.HILL.MEDIUM);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
}

function addBumps() {
  addRoad(10, 10, 10, 0, 5);
  addRoad(10, 10, 10, 0, -2);
  addRoad(10, 10, 10, 0, -5);
  addRoad(10, 10, 10, 0, 8);
  addRoad(10, 10, 10, 0, 5);
  addRoad(10, 10, 10, 0, -7);
  addRoad(10, 10, 10, 0, 5);
  addRoad(10, 10, 10, 0, -2);
}

function addDownhillToEnd(num) {
  num = num || 200;
  addRoad(num, num, num, -ROAD.CURVE.EASY, -lastY() / SEGMENT_LENGTH);
}

function buildTrack() {
  trackSegments = [];
  
  addStraight(ROAD.LENGTH.SHORT);
  addLowRollingHills();
  addSCurves();
  addCurve(ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
  addBumps();
  addLowRollingHills();
  addCurve(ROAD.LENGTH.LONG * 2, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
  addStraight();
  addHill(ROAD.LENGTH.MEDIUM, ROAD.HILL.HIGH);
  addSCurves();
  addCurve(ROAD.LENGTH.LONG, -ROAD.CURVE.MEDIUM, ROAD.HILL.NONE);
  addHill(ROAD.LENGTH.LONG, ROAD.HILL.HIGH);
  addCurve(ROAD.LENGTH.LONG, ROAD.CURVE.MEDIUM, -ROAD.HILL.LOW);
  addBumps();
  addHill(ROAD.LENGTH.LONG, -ROAD.HILL.MEDIUM);
  addStraight();
  addSCurves();
  addDownhillToEnd();
  
  trackLength = trackSegments.length * SEGMENT_LENGTH;
}

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
    
    // Build track geometry once
    if (trackSegments.length === 0) {
      buildTrack();
    }
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
 * Update F1-style minimap with player positions (using actual track geometry)
 */
function updateMinimap() {
  if (!minimapCtx || !roomData || !roomData.players || trackSegments.length === 0) return;

  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  const padding = 30;

  // Clear canvas
  minimapCtx.clearRect(0, 0, width, height);

  // Background
  minimapCtx.fillStyle = '#1a5c1a'; // Dark green (grass)
  minimapCtx.fillRect(0, 0, width, height);

  // Calculate track bounds using same logic as game rendering
  // In game: x starts at 0, dx accumulates from curve
  let x = 0;
  let dx = 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  
  // First pass: calculate bounds
  trackSegments.forEach(segment => {
    x = x + dx;
    dx = dx + segment.curve;
    
    const segX1 = x;
    const segX2 = x + dx;
    const segY1 = segment.p1.y;
    const segY2 = segment.p2.y;
    
    minX = Math.min(minX, segX1, segX2);
    maxX = Math.max(maxX, segX1, segX2);
    minY = Math.min(minY, segY1, segY2);
    maxY = Math.max(maxY, segY1, segY2);
  });
  
  const trackWidth = maxX - minX || 1;
  const trackHeight = maxY - minY || 1;
  
  // Calculate scale to fit track in canvas
  const scaleX = (width - 2 * padding) / trackWidth;
  const scaleY = (height - 2 * padding) / trackHeight;
  const scale = Math.min(scaleX, scaleY) * 0.8; // 80% scale for padding
  
  const offsetX = (width - trackWidth * scale) / 2 - minX * scale;
  const offsetY = (height - trackHeight * scale) / 2 - minY * scale;
  
  // Draw track (road) using actual segments - same logic as game
  minimapCtx.strokeStyle = '#333333'; // Dark gray track
  minimapCtx.lineWidth = Math.max(20, 30 * scale);
  minimapCtx.beginPath();
  
  x = 0;
  dx = 0;
  let pathStarted = false;
  
  trackSegments.forEach((segment, index) => {
    // Calculate X using same logic as game: x = x + dx, dx = dx + curve
    const x1 = x * scale + offsetX;
    const y1 = segment.p1.y * scale + offsetY;
    
    x = x + dx;
    dx = dx + segment.curve;
    
    const x2 = x * scale + offsetX;
    const y2 = segment.p2.y * scale + offsetY;
    
    if (!pathStarted) {
      minimapCtx.moveTo(x1, y1);
      pathStarted = true;
    }
    
    minimapCtx.lineTo(x2, y2);
  });
  minimapCtx.stroke();
  
  // Draw track center line (white dashed)
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = Math.max(1, 2 * scale);
  minimapCtx.setLineDash([Math.max(5, 10 * scale), Math.max(5, 10 * scale)]);
  minimapCtx.beginPath();
  
  x = 0;
  dx = 0;
  pathStarted = false;
  
  trackSegments.forEach((segment, index) => {
    const x1 = x * scale + offsetX;
    const y1 = segment.p1.y * scale + offsetY;
    
    x = x + dx;
    dx = dx + segment.curve;
    
    const x2 = x * scale + offsetX;
    const y2 = segment.p2.y * scale + offsetY;
    
    if (!pathStarted) {
      minimapCtx.moveTo(x1, y1);
      pathStarted = true;
    }
    
    minimapCtx.lineTo(x2, y2);
  });
  minimapCtx.stroke();
  minimapCtx.setLineDash([]); // Reset line dash
  
  // Draw players (cars) on track
  const players = Object.entries(roomData.players);
  players.forEach(([uid, playerData]) => {
    const position = playerData.position || 0;
    const playerX = playerData.playerX || 0;
    const playerSpeed = playerData.speed || 0;
    const playerName = playerData.name || 'Player';
    const isNitro = playerData.nitro || false;

    // Find segment and position on track
    const segmentIndex = Math.floor(position / SEGMENT_LENGTH) % trackSegments.length;
    const segment = trackSegments[segmentIndex];
    const percent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    
    // Calculate X position (Z-based + curve offset)
    let curveOffset = 0;
    for (let i = 0; i < segmentIndex; i++) {
      curveOffset += trackSegments[i].curve * 200;
    }
    curveOffset += segment.curve * 200 * percent;
    
    const carZ = segment.p1.z + (segment.p2.z - segment.p1.z) * percent;
    const carX = carZ * scale + offsetX + curveOffset;
    
    // Calculate Y position (interpolate between segment points)
    const carY = offsetY + (segment.p1.y + (segment.p2.y - segment.p1.y) * percent - avgY) * scale;
    
    // Add lane offset (playerX is -1 to 1)
    const laneOffset = playerX * 15;
    
    // Final position
    const x = carX + laneOffset;
    const y = carY;

    // Draw car (small rectangle)
    minimapCtx.fillStyle = isNitro ? '#ff9800' : '#2196F3';
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 2;
    
    const carSize = 8 * scale;
    minimapCtx.fillRect(x - carSize, y - carSize/2, carSize * 2, carSize);
    minimapCtx.strokeRect(x - carSize, y - carSize/2, carSize * 2, carSize);
    
    // Draw player name above car
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.font = `bold ${Math.max(10, 11 * scale)}px Arial`;
    minimapCtx.textAlign = 'center';
    minimapCtx.textBaseline = 'bottom';
    
    const textMetrics = minimapCtx.measureText(playerName);
    const textWidth = textMetrics.width;
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    minimapCtx.fillRect(x - textWidth/2 - 3, y - carSize - 15, textWidth + 6, 14);
    
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.fillText(playerName, x, y - carSize - 2);
    
    // Draw speed indicator below car
    const speedText = Math.round(playerSpeed / 100) + ' km/h';
    minimapCtx.font = `${Math.max(8, 9 * scale)}px Arial`;
    const speedMetrics = minimapCtx.measureText(speedText);
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    minimapCtx.fillRect(x - speedMetrics.width/2 - 2, y + carSize + 2, speedMetrics.width + 4, 12);
    minimapCtx.fillStyle = '#ffffff';
    minimapCtx.fillText(speedText, x, y + carSize + 12);
  });
  
  // Draw start line (at beginning of track)
  if (trackSegments.length > 0) {
    const startSegment = trackSegments[0];
    const startX = 0 * scale + offsetX; // x starts at 0
    const startY = startSegment.p1.y * scale + offsetY;
    
    minimapCtx.strokeStyle = '#ffff00'; // Yellow
    minimapCtx.lineWidth = Math.max(2, 3 * scale);
    minimapCtx.beginPath();
    minimapCtx.moveTo(startX - Math.max(10, 20 * scale), startY);
    minimapCtx.lineTo(startX + Math.max(10, 20 * scale), startY);
    minimapCtx.stroke();
    
    // Draw finish line (at end of track)
    const finishSegment = trackSegments[trackSegments.length - 1];
    // Calculate final X using accumulated dx
    let finishX = 0;
    let finishDx = 0;
    trackSegments.forEach(seg => {
      finishX = finishX + finishDx;
      finishDx = finishDx + seg.curve;
    });
    finishX = finishX * scale + offsetX;
    const finishY = finishSegment.p2.y * scale + offsetY;
    
    minimapCtx.strokeStyle = '#ff0000'; // Red
    minimapCtx.beginPath();
    minimapCtx.moveTo(finishX - Math.max(10, 20 * scale), finishY);
    minimapCtx.lineTo(finishX + Math.max(10, 20 * scale), finishY);
    minimapCtx.stroke();
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
    const roomRef = ref(`rooms/${roomId}`);
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
