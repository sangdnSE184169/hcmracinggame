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
  const roomRef = ref(`rooms/${roomId}`);
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
 * Generate F1-style circuit points
 * This creates a proper 2D circuit layout based on the track curves
 */
function generateCircuitPoints() {
  const points = [];
  let x = 0;
  let y = 0;
  let angle = -Math.PI / 2; // Start pointing up
  const stepLength = 2; // Length per segment on minimap
  
  // Sample every few segments to create smoother circuit
  const sampleRate = 3;
  
  for (let i = 0; i < trackSegments.length; i += sampleRate) {
    const segment = trackSegments[i];
    
    // Accumulate curve to change direction
    // Curve values affect the angle of travel
    angle += segment.curve * 0.015; // Scale factor for curve intensity
    
    // Move in current direction
    x += Math.cos(angle) * stepLength;
    y += Math.sin(angle) * stepLength;
    
    points.push({
      x: x,
      y: y,
      segmentIndex: i,
      z: segment.p2.z
    });
  }
  
  return points;
}

/**
 * Get unique color for player based on name/uid
 */
function getPlayerColor(name, uid) {
  const colors = [
    '#e10600', // Ferrari Red
    '#00d2be', // Mercedes Teal
    '#0600ef', // Red Bull Blue
    '#ff8700', // McLaren Orange
    '#006f62', // Aston Martin Green
    '#2b4562', // AlphaTauri Navy
    '#900000', // Alfa Romeo Maroon
    '#005aff', // Williams Blue
    '#b6babd', // Haas Silver
    '#ff69b4', // Pink
  ];
  
  // Hash the uid or name to get consistent color
  let hash = 0;
  const str = uid || name || 'player';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Update F1-style minimap with player positions
 * Creates a proper 2D circuit visualization
 */
function updateMinimap() {
  if (!minimapCtx || !roomData || trackSegments.length === 0) {
    console.log('Minimap update skipped - missing data');
    return;
  }

  const width = minimapCanvas.width;
  const height = minimapCanvas.height;
  const padding = 50;

  // Clear canvas
  minimapCtx.clearRect(0, 0, width, height);

  // Background gradient (grass effect)
  const gradient = minimapCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1a5c1a');
  gradient.addColorStop(0.5, '#2d7a2d');
  gradient.addColorStop(1, '#1a5c1a');
  minimapCtx.fillStyle = gradient;
  minimapCtx.fillRect(0, 0, width, height);

  // Generate circuit points
  const circuitPoints = generateCircuitPoints();
  
  if (circuitPoints.length === 0) {
    console.log('No circuit points generated');
    return;
  }
  
  // Calculate bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  circuitPoints.forEach(point => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });
  
  const circuitWidth = maxX - minX || 1;
  const circuitHeight = maxY - minY || 1;
  
  // Calculate scale to fit circuit in canvas with padding
  const scaleX = (width - 2 * padding) / circuitWidth;
  const scaleY = (height - 2 * padding) / circuitHeight;
  const scale = Math.min(scaleX, scaleY);
  
  // Center the circuit
  const offsetX = (width - circuitWidth * scale) / 2 - minX * scale;
  const offsetY = (height - circuitHeight * scale) / 2 - minY * scale;
  
  // Helper function to convert circuit coords to canvas coords
  const toCanvas = (point) => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY
  });

  // Draw track shadow
  minimapCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  minimapCtx.lineWidth = 18;
  minimapCtx.lineCap = 'round';
  minimapCtx.lineJoin = 'round';
  minimapCtx.beginPath();
  circuitPoints.forEach((point, index) => {
    const canvas = toCanvas(point);
    if (index === 0) {
      minimapCtx.moveTo(canvas.x + 3, canvas.y + 3);
    } else {
      minimapCtx.lineTo(canvas.x + 3, canvas.y + 3);
    }
  });
  minimapCtx.stroke();

  // Draw track surface (dark gray asphalt)
  minimapCtx.strokeStyle = '#333333';
  minimapCtx.lineWidth = 16;
  minimapCtx.beginPath();
  circuitPoints.forEach((point, index) => {
    const canvas = toCanvas(point);
    if (index === 0) {
      minimapCtx.moveTo(canvas.x, canvas.y);
    } else {
      minimapCtx.lineTo(canvas.x, canvas.y);
    }
  });
  minimapCtx.stroke();

  // Draw track center line (racing line hint - subtle)
  minimapCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  minimapCtx.lineWidth = 2;
  minimapCtx.setLineDash([10, 10]);
  minimapCtx.beginPath();
  circuitPoints.forEach((point, index) => {
    const canvas = toCanvas(point);
    if (index === 0) {
      minimapCtx.moveTo(canvas.x, canvas.y);
    } else {
      minimapCtx.lineTo(canvas.x, canvas.y);
    }
  });
  minimapCtx.stroke();
  minimapCtx.setLineDash([]);

  // Draw track edge (white border)
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  circuitPoints.forEach((point, index) => {
    const canvas = toCanvas(point);
    if (index === 0) {
      minimapCtx.moveTo(canvas.x, canvas.y);
    } else {
      minimapCtx.lineTo(canvas.x, canvas.y);
    }
  });
  minimapCtx.stroke();
  
  // Draw sector markers (every third of the track)
  const sectorInterval = Math.floor(circuitPoints.length / 3);
  for (let s = 1; s < 3; s++) {
    const sectorIndex = s * sectorInterval;
    if (sectorIndex < circuitPoints.length) {
      const sectorPoint = toCanvas(circuitPoints[sectorIndex]);
      
      minimapCtx.fillStyle = s === 1 ? '#ff0000' : '#0066ff';
      minimapCtx.beginPath();
      minimapCtx.arc(sectorPoint.x, sectorPoint.y, 4, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  }
  
  // Draw start/finish line
  const startPoint = toCanvas(circuitPoints[0]);
  const nextPoint = circuitPoints.length > 1 ? toCanvas(circuitPoints[1]) : startPoint;
  
  // Calculate perpendicular direction for start line
  const dx = nextPoint.x - startPoint.x;
  const dy = nextPoint.y - startPoint.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / len * 15;
  const perpY = dx / len * 15;
  
  // Draw checkered start/finish line
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = 6;
  minimapCtx.beginPath();
  minimapCtx.moveTo(startPoint.x - perpX, startPoint.y - perpY);
  minimapCtx.lineTo(startPoint.x + perpX, startPoint.y + perpY);
  minimapCtx.stroke();
  
  // Draw checkered pattern on start line
  const numChecks = 6;
  for (let i = 0; i < numChecks; i++) {
    const t = i / numChecks;
    const checkX = startPoint.x - perpX + (2 * perpX) * t;
    const checkY = startPoint.y - perpY + (2 * perpY) * t;
    minimapCtx.fillStyle = i % 2 === 0 ? '#000000' : '#ffffff';
    minimapCtx.fillRect(checkX - 2, checkY - 3, 5, 6);
  }
  
  // Draw "START" label
  minimapCtx.fillStyle = '#ffff00';
  minimapCtx.font = 'bold 10px Arial';
  minimapCtx.textAlign = 'center';
  minimapCtx.textBaseline = 'bottom';
  minimapCtx.fillText('START', startPoint.x, startPoint.y - 15);
  
  // Draw players (cars) on track
  if (roomData.players) {
    const players = Object.entries(roomData.players);
    
    // Sort by position (leader first for z-ordering)
    players.sort((a, b) => (b[1].position || 0) - (a[1].position || 0));
    
    players.forEach(([uid, playerData], ranking) => {
      const position = playerData.position || 0;
      const playerName = playerData.name || 'Player';
      const isNitro = playerData.nitro || false;
      const isFinished = playerData.finished || false;

      // Find position on circuit
      // Map player position to circuit point index
      const positionRatio = (position % trackLength) / trackLength;
      const circuitIndex = Math.floor(positionRatio * circuitPoints.length);
      const clampedIndex = Math.max(0, Math.min(circuitIndex, circuitPoints.length - 1));
      
      const point = circuitPoints[clampedIndex];
      const canvas = toCanvas(point);

      // Get player color
      const playerColor = isNitro ? '#ff9800' : getPlayerColor(playerName, uid);
      
      // Draw car glow effect for leader
      if (ranking === 0) {
        minimapCtx.shadowColor = playerColor;
        minimapCtx.shadowBlur = 10;
      }
      
      // Draw car body (F1 car shape - elongated oval)
      minimapCtx.fillStyle = playerColor;
      minimapCtx.strokeStyle = '#ffffff';
      minimapCtx.lineWidth = 2;
      
      minimapCtx.beginPath();
      minimapCtx.ellipse(canvas.x, canvas.y, 8, 5, 0, 0, Math.PI * 2);
      minimapCtx.fill();
      minimapCtx.stroke();
      
      // Reset shadow
      minimapCtx.shadowBlur = 0;
      
      // Draw position number on car
      minimapCtx.fillStyle = '#ffffff';
      minimapCtx.font = 'bold 8px Arial';
      minimapCtx.textAlign = 'center';
      minimapCtx.textBaseline = 'middle';
      minimapCtx.fillText(String(ranking + 1), canvas.x, canvas.y);
      
      // Draw player name with background
      const nameText = isFinished ? `${playerName} ✓` : playerName;
      minimapCtx.font = 'bold 11px Arial';
      const textWidth = minimapCtx.measureText(nameText).width;
      
      // Name background
      minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      minimapCtx.fillRect(canvas.x + 10, canvas.y - 8, textWidth + 6, 16);
      
      // Name text
      minimapCtx.fillStyle = isNitro ? '#ff9800' : '#ffffff';
      minimapCtx.textAlign = 'left';
      minimapCtx.textBaseline = 'middle';
      minimapCtx.fillText(nameText, canvas.x + 13, canvas.y);
    });
  }
  
  // Draw track info overlay
  minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  minimapCtx.fillRect(width - 120, height - 35, 110, 25);
  minimapCtx.fillStyle = '#ffffff';
  minimapCtx.font = '10px Arial';
  minimapCtx.textAlign = 'right';
  minimapCtx.textBaseline = 'middle';
  minimapCtx.fillText(`Track: ${Math.round(trackLength / 1000)}km`, width - 15, height - 22);
  
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

// Handle window resize
window.addEventListener('resize', () => {
  if (minimapCanvas) {
    const rect = minimapCanvas.getBoundingClientRect();
    minimapCanvas.width = rect.width;
    minimapCanvas.height = rect.height;
    updateMinimap();
  }
});