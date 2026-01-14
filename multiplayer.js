//=========================================================================
// Multiplayer Synchronization
//=========================================================================

import { getDatabase, ref, update, onValue, off, initFirebase } from './firebase.js';

// Initialize Firebase
if (!initFirebase()) {
  console.error('Failed to initialize Firebase in multiplayer.js');
}

const db = getDatabase();

let roomId = null;
let uid = null;
let roomData = null;
let remoteCars = [];
let syncPositionCallback = null;
let onRoomUpdateCallback = null;

/**
 * Initialize multiplayer with room ID and user ID from URL
 */
export function initMultiplayer() {
  const params = new URLSearchParams(window.location.search);
  roomId = params.get('roomId');
  uid = params.get('uid');

  if (!roomId || !uid) {
    console.error('Missing roomId or uid in URL');
    return false;
  }

  // Listen to room updates
  const roomRef = ref(`rooms/${roomId}`);
  onValue(roomRef, (snapshot) => {
    roomData = snapshot.val();
    if (roomData) {
      if (roomData.players) {
        updateRemoteCars();
        // Debug: log when players update
        console.log('Room updated - players:', Object.keys(roomData.players).length);
      }
      // Always call callback when room data changes (including status changes)
      if (onRoomUpdateCallback) {
        onRoomUpdateCallback(roomData);
      }
    }
  });

  return true;
}

/**
 * Update remote cars array from Firebase data
 */
function updateRemoteCars() {
  if (!roomData || !roomData.players) return;

  remoteCars = [];
  for (const [playerUid, playerData] of Object.entries(roomData.players)) {
    if (playerUid !== uid) {
      remoteCars.push({
        uid: playerUid,
        name: playerData.name || 'Player',
        position: playerData.position || 0,
        speed: playerData.speed || 0,
        nitro: playerData.nitro || false,
        finished: playerData.finished || false,
        lane: playerData.lane || 0,
        playerX: playerData.playerX || 0
      });
    }
  }
}

/**
 * Sync local player position and speed to Firebase
 */
export function syncPosition(position, speed, nitro = false, finished = false, playerX = 0) {
  if (!roomId || !uid) return;

  const playerRef = ref(`rooms/${roomId}/players/${uid}`);
  update(playerRef, {
    position: Math.round(position),
    speed: Math.round(speed),
    nitro: nitro,
    finished: finished,
    playerX: playerX
  });
}

/**
 * Get remote cars data
 */
export function getRemoteCars() {
  return remoteCars;
}

/**
 * Get current player data
 */
export function getCurrentPlayer() {
  if (!roomData || !roomData.players || !uid) return null;
  return roomData.players[uid];
}

/**
 * Get room data
 */
export function getRoomData() {
  return roomData;
}

/**
 * Check if race has started
 */
export function isRaceStarted() {
  return roomData && roomData.status === 'running';
}

/**
 * Check if race is finished
 */
export function isRaceFinished() {
  return roomData && roomData.status === 'finished';
}

/**
 * Set callback for room updates
 */
export function onRoomUpdate(callback) {
  onRoomUpdateCallback = callback;
}

/**
 * Cleanup listeners
 */
export function cleanup() {
  if (roomId) {
    const roomRef = ref(`rooms/${roomId}`);
    off(roomRef);
  }
}
