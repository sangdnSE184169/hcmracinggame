//=========================================================================
// Admin Dashboard - Fixed Minimap
//=========================================================================

import { getAuth, getDatabase, ref, set, update, onValue, get, off, signInAnonymously, onAuthStateChanged, initFirebase } from './firebase.js';
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
  
  console.log(`Track built: ${trackSegments.length} segments, ${trackLength}m total length`);
}

// Initialize auth
onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    console.log('User authenticated:', user.uid);
  } else {
    await signInAnonymously();
  }
});

// Build track on page load
buildTrack();

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
  
  const roomRef = ref(db, `rooms/${roomId}`);
  await update(roomRef, {
    status: 'running',
    startTime: Date.now()
  });
});

// End race button
document.getElementById('endRace').addEventListener('click', async () => {
  if (!roomId) return;
  
  const roomRef = ref(db, `rooms/${roomId}`);
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
  if (minimapCanvas) {
    minimapCtx = minimapCanvas.getContext('2d');
    // Set proper canvas size
    const rect = minimapCanvas.getBoundingClientRect();
    minimapCanvas.width = rect.width;
    minimapCanvas.height = rect.height;
    
    console.log('Minimap initialized:', minimapCanvas.width, 'x', minimapCanvas.height);
    
    // Build track if not already built
    if (trackSegments.length === 0) {
      buildTrack();
    }
  }

  // Listen to room updates
  const roomRef = ref(db, `rooms/${roomId}`);
  roomListener = onValue(roomRef, (snapshot) => {
    roomData = snapshot.val();
    if (roomData) {
      updateMinimap();
      updateRankings();
      checkWinner();
    }
  });
  
  console.log('Listening to room:', roomId);
}

/**
 * Update F1-style minimap with player positions (using actual track geometry)
 */
function updateMinimap() {
  if (!minimapCtx || !roomData || trackSegments.length === 0) {
    console.log('Minimap update skipped - missing data');
    return;
  }

  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  const padding = 40;

  // Clear canvas
  minimapCtx.clearRect(0, 0, width, height);

  // Background
  minimapCtx.fillStyle = '#1a5c1a'; // Dark green (grass)
  minimapCtx.fillRect(0, 0, width, height);

  // Calculate track positions - accumulate curve to get X offset
  const trackPoints = [];
  let x = 0;
  
  trackSegments.forEach(segment => {
    x = x + segment.curve;
    trackPoints.push({
      x: x,
      z: segment.p2.z
    });
  });
  
  // Calculate bounds
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  trackPoints.forEach(point => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  });
  
  const trackWidth = maxX - minX || 1;
  const trackDepth = maxZ - minZ || 1;
  
  // Calculate scale to fit track in canvas
  const scaleX = (width - 2 * padding) / trackWidth;
  const scaleZ = (height - 2 * padding) / trackDepth;
  const scale = Math.min(scaleX, scaleZ);
  
  const offsetX = padding - minX * scale;
  const offsetZ = padding - minZ * scale;
  
  // Draw track outline (F1 style - white line)
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = 3;
  minimapCtx.lineCap = 'round';
  minimapCtx.lineJoin = 'round';
  minimapCtx.beginPath();
  
  // Draw track path
  trackPoints.forEach((point, index) => {
    const canvasX = point.x * scale + offsetX;
    const canvasY = point.z * scale + offsetZ;
    
    if (index === 0) {
      minimapCtx.moveTo(canvasX, canvasY);
    } else {
      minimapCtx.lineTo(canvasX, canvasY);
    }
  });
  minimapCtx.stroke();
  
  // Draw start/finish line (yellow line)
  const startPoint = trackPoints[0];
  const startCanvasX = startPoint.x * scale + offsetX;
  const startCanvasY = startPoint.z * scale + offsetZ;
  
  minimapCtx.strokeStyle = '#ffff00';
  minimapCtx.lineWidth = 4;
  minimapCtx.beginPath();
  minimapCtx.moveTo(startCanvasX - 20, startCanvasY);
  minimapCtx.lineTo(startCanvasX + 20, startCanvasY);
  minimapCtx.stroke();
  
  // Draw checkered pattern
  for (let i = 0; i < 3; i++) {
    const rectX = startCanvasX - 15 + i * 10;
    const rectY = startCanvasY - 2;
    minimapCtx.fillStyle = i % 2 === 0 ? '#000000' : '#ffffff';
    minimapCtx.fillRect(rectX, rectY, 10, 4);
  }
  
  // Draw players (cars) on track
  if (roomData.players) {
    const players = Object.entries(roomData.players);
    
    players.forEach(([uid, playerData]) => {
      const position = playerData.position || 0;
      const playerX = playerData.playerX || 0;
      const playerName = playerData.name || 'Player';
      const isNitro = playerData.nitro || false;

      // Find segment and position on track
      const segmentIndex = Math.floor(position / SEGMENT_LENGTH) % trackSegments.length;
      
      if (segmentIndex >= 0 && segmentIndex < trackPoints.length) {
        const point = trackPoints[segmentIndex];
        
        // Convert to minimap coordinates
        const canvasX = point.x * scale + offsetX + (playerX * 15);
        const canvasY = point.z * scale + offsetZ;

        // Draw car (F1 style dot)
        minimapCtx.fillStyle = isNitro ? '#ff9800' : '#2196F3';
        minimapCtx.strokeStyle = '#ffffff';
        minimapCtx.lineWidth = 2;
        
        minimapCtx.beginPath();
        minimapCtx.arc(canvasX, canvasY, 7, 0, Math.PI * 2);
        minimapCtx.fill();
        minimapCtx.stroke();
        
        // Draw player name
        minimapCtx.fillStyle = '#ffffff';
        minimapCtx.font = 'bold 11px Arial';
        minimapCtx.textAlign = 'left';
        minimapCtx.textBaseline = 'middle';
        minimapCtx.fillText(playerName, canvasX + 12, canvasY);
      }
    });
  }
  
  console.log('Minimap updated with', roomData.players ? Object.keys(roomData.players).length : 0, 'players');
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

// Handle window resize
window.addEventListener('resize', () => {
  if (minimapCanvas) {
    const rect = minimapCanvas.getBoundingClientRect();
    minimapCanvas.width = rect.width;
    minimapCanvas.height = rect.height;
    updateMinimap();
  }
});