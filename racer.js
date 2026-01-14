//=========================================================================
// Multiplayer Racing Game
//=========================================================================

import { initMultiplayer, syncPosition, getRemoteCars, getRoomData, isRaceStarted, isRaceFinished, onRoomUpdate } from './multiplayer.js';
import { initQuiz, autoCreateQuiz } from './quiz.js';
import { initFirebase } from './firebase.js';

// Initialize Firebase
if (!initFirebase()) {
  console.error('Failed to initialize Firebase in racer.js');
}

// Game constants
var fps            = 60;
var step           = 1/fps;
var width          = window.innerWidth || 1920;
var height         = window.innerHeight || 1080;
var centrifugal    = 0.3;
var skySpeed       = 0.001;
var hillSpeed      = 0.002;
var treeSpeed      = 0.003;
var skyOffset      = 0;
var hillOffset     = 0;
var treeOffset     = 0;
var segments       = [];
var cars           = [];
var stats          = null; // Disabled for fullscreen
var canvas         = Dom.get('canvas');
var ctx            = canvas.getContext('2d');
var background     = null;
var sprites        = null;
var resolution     = null;
var roadWidth      = 2000;
var segmentLength  = 200;
var rumbleLength   = 3;
var trackLength    = null;
var lanes          = 3;
var fieldOfView    = 100;
var cameraHeight   = 1000;
var cameraDepth    = null;
var drawDistance   = 300;
var playerX        = 0;
var playerZ        = null;
var fogDensity     = 5;
var position       = 0;
var speed          = 0;
// Base maxSpeed = 100 km/h (speed/500 * 5 = speed/100, so speed = 10000 for display 100)
var baseMaxSpeed   = 10000; // 100 km/h
var maxSpeed       = baseMaxSpeed;
var nitroMaxSpeed  = 15000; // 150 km/h when nitro active
var accel          = maxSpeed/5;
var breaking       = -maxSpeed;
var decel          = -maxSpeed/5;
var offRoadDecel   = -maxSpeed/2;
var offRoadLimit   = maxSpeed/4;
var totalCars      = 200;
var currentLapTime = 0;
var lastLapTime    = null;
var currentLap     = 1; // Track current lap (1 or 2)
var totalLaps      = 2; // Total laps in race
var totalDistance  = 0; // Track total distance traveled (for lap counting)
var lastPosition   = 0; // Track last position for distance calculation

// Multiplayer state
var nitroActive    = false;
var nitroEndTime   = 0;
var spacebarNitroActive = false; // Spacebar nitro (150km/h for 3s)
var spacebarNitroEndTime = 0;
var lastSyncTime   = 0;
var syncInterval   = 100; // Sync every 100ms
var remotePlayers  = [];
var finished       = false;
// Lane/spawn state (offset-based, like car.offset / playerX)
// These are used inside the Firebase onRoomUpdate callback.
var playerLane      = 0;
var playerLaneX     = 0;
// Quiz auto-trigger timer
var lastQuizTime   = 0;
var quizInterval   = 45000; // 45 seconds

var keyLeft        = false;
var keyRight       = false;
var keyFaster      = false;
var keySlower      = false;
var keySpace       = false;

var hud = {
  speed:            { value: null, dom: Dom.get('speed_value')            },
  lap:              { value: null, dom: Dom.get('lap_value')              },
  current_lap_time: { value: null, dom: Dom.get('current_lap_time_value') },
  last_lap_time:    { value: null, dom: Dom.get('last_lap_time_value')    },
  fast_lap_time:    { value: null, dom: Dom.get('fast_lap_time_value')    }
};

// Initialize multiplayer
if (!initMultiplayer()) {
  window.location.href = 'lobby.html';
}

// Initialize quiz
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
const uid = params.get('uid');
if (roomId && uid) {
  initQuiz(roomId, uid);
}

// Calculate dynamic lanes based on player count
function updateLanes() {
  const roomData = getRoomData();
  if (roomData && roomData.players) {
    const playerCount = Object.keys(roomData.players).length;
    lanes = Math.max(3, playerCount + 1); // Minimum 3 lanes, or players + 1
  }
}

// Assign lane to player when joining
function assignLane() {
  const roomData = getRoomData();
  if (!roomData || !roomData.players) return 0;
  
  const players = Object.values(roomData.players);
  const usedLanes = players.map(p => p.lane || 0).filter(l => l > 0);
  const totalLanes = Math.max(3, players.length + 1);
  
  // Find first available lane
  for (let i = 1; i <= totalLanes; i++) {
    if (!usedLanes.includes(i)) {
      return i;
    }
  }
  return 1; // Fallback
}

// Listen for room updates
onRoomUpdate((roomData) => {
  if (roomData) {
    // Update lanes based on player count
    updateLanes();
    
    // Get current player data and set initial lane/position
    const currentPlayer = roomData.players && roomData.players[uid];
    if (currentPlayer) {
      if (currentPlayer.lane && playerLane === 0) {
        playerLane = currentPlayer.lane;
        playerLaneX = currentPlayer.playerX || 0;
        playerX = playerLaneX; // Set initial X position
      }
      
      if (currentPlayer.nitro && !nitroActive) {
        nitroActive = true;
        nitroEndTime = Date.now() + 3000; // 3 seconds
        Dom.show('nitro-indicator');
      }
    }

    // Check if race started
    if (isRaceStarted()) {
      const waitingOverlay = Dom.get('waitingOverlay');
      if (waitingOverlay) {
        waitingOverlay.style.display = 'none';
      }
      
      // Reset lap tracking when race starts
      if (currentLap === 1 && totalDistance === 0) {
        currentLap = 1;
        totalDistance = 0;
        lastPosition = position;
        lastQuizTime = Date.now(); // Start quiz timer
      }
    }

    // Check if race finished
    if (isRaceFinished()) {
      finished = true;
    }
  }
});

//=========================================================================
// UPDATE THE GAME WORLD
//=========================================================================

function update(dt) {
  // Don't update if race hasn't started or is finished
  if (!isRaceStarted()) {
    // Still allow some basic updates even when waiting
    return;
  }
  
  if (finished) {
    return;
  }

  var n, car, carW, sprite, spriteW;
  var playerSegment = findSegment(position+playerZ);
  var playerW       = SPRITES.PLAYER_STRAIGHT.w * SPRITES.SCALE;
  var speedPercent  = speed/maxSpeed;
  var dx            = dt * 2 * speedPercent;
  var startPosition = position;

  // Check spacebar nitro boost (150km/h for 3s)
  if (spacebarNitroActive) {
    if (Date.now() >= spacebarNitroEndTime) {
      spacebarNitroActive = false;
    }
  }
  
  // Handle spacebar press
  if (keySpace && !spacebarNitroActive) {
    spacebarNitroActive = true;
    spacebarNitroEndTime = Date.now() + 3000; // 3 seconds
  }

  // Check Firebase nitro boost (from quiz winner)
  if (nitroActive) {
    if (Date.now() >= nitroEndTime) {
      nitroActive = false;
      var nitroIndicator = Dom.get('nitro-indicator');
      if (nitroIndicator) nitroIndicator.style.display = 'none';
    }
  }

  // Apply nitro boost to speed
  var currentAccel = accel;
  var currentMaxSpeed = baseMaxSpeed; // Start with base 100km/h
  
  // Spacebar nitro: 150km/h for 3s
  if (spacebarNitroActive) {
    currentMaxSpeed = nitroMaxSpeed; // 150 km/h
    var nitroIndicator = Dom.get('nitro-indicator');
    if (nitroIndicator) {
      nitroIndicator.style.display = 'block';
      nitroIndicator.textContent = '⚡ NITRO (Space)';
    }
  }
  // Firebase nitro (from quiz): 1.5x base speed
  else if (nitroActive) {
    currentAccel = accel * 1.5;
    currentMaxSpeed = baseMaxSpeed * 1.5; // 150 km/h
    var nitroIndicator = Dom.get('nitro-indicator');
    if (nitroIndicator) {
      nitroIndicator.style.display = 'block';
      nitroIndicator.textContent = '⚡ NITRO';
    }
  } else {
    var nitroIndicator = Dom.get('nitro-indicator');
    if (nitroIndicator) nitroIndicator.style.display = 'none';
  }

  updateCars(dt, playerSegment, playerW);

  var oldPosition = position;
  position = Util.increase(position, dt * speed, trackLength);
  
  // Track total distance for lap counting
  var positionDelta = position - oldPosition;
  if (positionDelta < -trackLength / 2) {
    // Wrapped around (position went from near trackLength to near 0)
    totalDistance += trackLength + positionDelta;
  } else if (positionDelta > trackLength / 2) {
    // Wrapped backwards (shouldn't happen in normal gameplay)
    totalDistance += positionDelta - trackLength;
  } else {
    // Normal forward movement
    totalDistance += positionDelta;
  }
  
  // Ensure totalDistance is always positive
  if (totalDistance < 0) totalDistance = 0;

  if (keyLeft)
    playerX = playerX - dx;
  else if (keyRight)
    playerX = playerX + dx;

  playerX = playerX - (dx * speedPercent * playerSegment.curve * centrifugal);

  if (keyFaster)
    speed = Util.accelerate(speed, currentAccel, dt);
  else if (keySlower)
    speed = Util.accelerate(speed, breaking, dt);
  else
    speed = Util.accelerate(speed, decel, dt);

  if ((playerX < -1) || (playerX > 1)) {
    if (speed > offRoadLimit)
      speed = Util.accelerate(speed, offRoadDecel, dt);

    for(n = 0 ; n < playerSegment.sprites.length ; n++) {
      sprite  = playerSegment.sprites[n];
      spriteW = sprite.source.w * SPRITES.SCALE;
      if (Util.overlap(playerX, playerW, sprite.offset + spriteW/2 * (sprite.offset > 0 ? 1 : -1), spriteW)) {
        speed = maxSpeed/5;
        position = Util.increase(playerSegment.p1.world.z, -playerZ, trackLength);
        break;
      }
    }
  }

  // Collision with AI cars
  for(n = 0 ; n < playerSegment.cars.length ; n++) {
    car  = playerSegment.cars[n];
    carW = car.sprite.w * SPRITES.SCALE;
    if (speed > car.speed) {
      if (Util.overlap(playerX, playerW, car.offset, carW, 0.8)) {
        speed    = car.speed * (car.speed/speed);
        position = Util.increase(car.z, -playerZ, trackLength);
        break;
      }
    }
  }

  playerX = Util.limit(playerX, -3, 3);
  speed   = Util.limit(speed, 0, currentMaxSpeed);

  // Check finish line (lap system: 2 laps)
  var absolutePosition = position + playerZ;
  var lapDistance = totalDistance;
  var lapNumber = Math.floor(lapDistance / trackLength) + 1;
  
  // Update current lap
  if (lapNumber > currentLap && !finished) {
    currentLap = lapNumber;
    
    if (currentLap > totalLaps) {
      // Completed final lap (lap 2), finish race
      finished = true;
      syncPosition(absolutePosition, speed, nitroActive || spacebarNitroActive, true, playerX);
    }
  }
  
  // Auto-trigger quiz every 45 seconds
  if (isRaceStarted() && !finished) {
    var now = Date.now();
    if (now - lastQuizTime >= quizInterval) {
      lastQuizTime = now;
      if (roomId) {
        autoCreateQuiz(roomId);
      }
    }
  }

  skyOffset  = Util.increase(skyOffset,  skySpeed  * playerSegment.curve * (position-startPosition)/segmentLength, 1);
  hillOffset = Util.increase(hillOffset, hillSpeed * playerSegment.curve * (position-startPosition)/segmentLength, 1);
  treeOffset = Util.increase(treeOffset, treeSpeed * playerSegment.curve * (position-startPosition)/segmentLength, 1);

  if (position > playerZ) {
    if (currentLapTime && (startPosition < playerZ)) {
      lastLapTime    = currentLapTime;
      currentLapTime = 0;
      if (lastLapTime <= Util.toFloat(Dom.storage.fast_lap_time)) {
        Dom.storage.fast_lap_time = lastLapTime;
        updateHud('fast_lap_time', formatTime(lastLapTime));
        Dom.addClassName('fast_lap_time', 'fastest');
        Dom.addClassName('last_lap_time', 'fastest');
      }
      else {
        Dom.removeClassName('fast_lap_time', 'fastest');
        Dom.removeClassName('last_lap_time', 'fastest');
      }
      updateHud('last_lap_time', formatTime(lastLapTime));
      Dom.show('last_lap_time');
    }
    else {
      currentLapTime += dt;
    }
  }

  updateHud('speed',            5 * Math.round(speed/500));
  updateHud('lap',              currentLap);
  updateHud('current_lap_time', formatTime(currentLapTime));

  // Sync position to Firebase (throttled) - include playerX for collision
  var now = Date.now();
  if (now - lastSyncTime >= syncInterval) {
    var absolutePos = position + playerZ;
    syncPosition(absolutePos, speed, nitroActive, finished, playerX);
    lastSyncTime = now;
  }

  // Update remote players - get fresh data every frame
  remotePlayers = getRemoteCars();
  
  // Debug: log remote players count
  if (remotePlayers.length > 0 && Math.random() < 0.01) { // Log 1% of frames to avoid spam
    console.log('Remote players:', remotePlayers.length, remotePlayers.map(p => p.name + ' @ ' + p.position));
  }
}

//-------------------------------------------------------------------------

function updateCars(dt, playerSegment, playerW) {
  var n, car, oldSegment, newSegment;
  for(n = 0 ; n < cars.length ; n++) {
    car         = cars[n];
    oldSegment  = findSegment(car.z);
    car.offset  = car.offset + updateCarOffset(car, oldSegment, playerSegment, playerW);
    car.z       = Util.increase(car.z, dt * car.speed, trackLength);
    car.percent = Util.percentRemaining(car.z, segmentLength);
    newSegment  = findSegment(car.z);
    if (oldSegment != newSegment) {
      var index = oldSegment.cars.indexOf(car);
      oldSegment.cars.splice(index, 1);
      newSegment.cars.push(car);
    }
  }
}

function updateCarOffset(car, carSegment, playerSegment, playerW) {
  var i, j, dir, segment, otherCar, otherCarW, lookahead = 20, carW = car.sprite.w * SPRITES.SCALE;

  if ((carSegment.index - playerSegment.index) > drawDistance)
    return 0;

  for(i = 1 ; i < lookahead ; i++) {
    segment = segments[(carSegment.index+i)%segments.length];

    if ((segment === playerSegment) && (car.speed > speed) && (Util.overlap(playerX, playerW, car.offset, carW, 1.2))) {
      if (playerX > 0.5)
        dir = -1;
      else if (playerX < -0.5)
        dir = 1;
      else
        dir = (car.offset > playerX) ? 1 : -1;
      return dir * 1/i * (car.speed-speed)/maxSpeed;
    }

    for(j = 0 ; j < segment.cars.length ; j++) {
      otherCar  = segment.cars[j];
      otherCarW = otherCar.sprite.w * SPRITES.SCALE;
      if ((car.speed > otherCar.speed) && Util.overlap(car.offset, carW, otherCar.offset, otherCarW, 1.2)) {
        if (otherCar.offset > 0.5)
          dir = -1;
        else if (otherCar.offset < -0.5)
          dir = 1;
        else
          dir = (car.offset > otherCar.offset) ? 1 : -1;
        return dir * 1/i * (car.speed-otherCar.speed)/maxSpeed;
      }
    }
  }

  if (car.offset < -0.9)
    return 0.1;
  else if (car.offset > 0.9)
    return -0.1;
  else
    return 0;
}

//-------------------------------------------------------------------------

function updateHud(key, value) {
  if (hud[key].value !== value) {
    hud[key].value = value;
    Dom.set(hud[key].dom, value);
  }
}

function formatTime(dt) {
  var minutes = Math.floor(dt/60);
  var seconds = Math.floor(dt - (minutes * 60));
  var tenths  = Math.floor(10 * (dt - Math.floor(dt)));
  if (minutes > 0)
    return minutes + "." + (seconds < 10 ? "0" : "") + seconds + "." + tenths;
  else
    return seconds + "." + tenths;
}

//=========================================================================
// RENDER THE GAME WORLD
//=========================================================================

function render() {
  var baseSegment   = findSegment(position);
  var basePercent   = Util.percentRemaining(position, segmentLength);
  var playerSegment = findSegment(position+playerZ);
  var playerPercent = Util.percentRemaining(position+playerZ, segmentLength);
  var playerY       = Util.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
  var maxy          = height;

  var x  = 0;
  var dx = - (baseSegment.curve * basePercent);

  ctx.clearRect(0, 0, width, height);

  Render.background(ctx, background, width, height, BACKGROUND.SKY,   skyOffset,  resolution * skySpeed  * playerY);
  Render.background(ctx, background, width, height, BACKGROUND.HILLS, hillOffset, resolution * hillSpeed * playerY);
  Render.background(ctx, background, width, height, BACKGROUND.TREES, treeOffset, resolution * treeSpeed * playerY);

  var n, i, segment, car, sprite, spriteScale, spriteX, spriteY;

  for(n = 0 ; n < drawDistance ; n++) {
    segment        = segments[(baseSegment.index + n) % segments.length];
    segment.looped = segment.index < baseSegment.index;
    segment.fog    = Util.exponentialFog(n/drawDistance, fogDensity);
    segment.clip   = maxy;

    Util.project(segment.p1, (playerX * roadWidth) - x,      playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);
    Util.project(segment.p2, (playerX * roadWidth) - x - dx, playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);

    x  = x + dx;
    dx = dx + segment.curve;

    if ((segment.p1.camera.z <= cameraDepth)         ||
        (segment.p2.screen.y >= segment.p1.screen.y) ||
        (segment.p2.screen.y >= maxy))
      continue;

    Render.segment(ctx, width, lanes,
                   segment.p1.screen.x,
                   segment.p1.screen.y,
                   segment.p1.screen.w,
                   segment.p2.screen.x,
                   segment.p2.screen.y,
                   segment.p2.screen.w,
                   segment.fog,
                   segment.color);

    maxy = segment.p1.screen.y;
  }

  for(n = (drawDistance-1) ; n > 0 ; n--) {
    segment = segments[(baseSegment.index + n) % segments.length];

    for(i = 0 ; i < segment.cars.length ; i++) {
      car         = segment.cars[i];
      sprite      = car.sprite;
      spriteScale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, car.percent);
      spriteX     = Util.interpolate(segment.p1.screen.x,     segment.p2.screen.x,     car.percent) + (spriteScale * car.offset * roadWidth * width/2);
      spriteY     = Util.interpolate(segment.p1.screen.y,     segment.p2.screen.y,     car.percent);
      Render.sprite(ctx, width, height, resolution, roadWidth, sprites, car.sprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);
    }

    for(i = 0 ; i < segment.sprites.length ; i++) {
      sprite      = segment.sprites[i];
      spriteScale = segment.p1.screen.scale;
      spriteX     = segment.p1.screen.x + (spriteScale * sprite.offset * roadWidth * width/2);
      spriteY     = segment.p1.screen.y;
      Render.sprite(ctx, width, height, resolution, roadWidth, sprites, sprite.source, spriteScale, spriteX, spriteY, (sprite.offset < 0 ? -1 : 0), -1, segment.clip);
    }

    if (segment == playerSegment) {
      Render.player(ctx, width, height, resolution, roadWidth, sprites, speed/maxSpeed,
                    cameraDepth/playerZ,
                    width/2,
                    (height/2) - (cameraDepth/playerZ * Util.interpolate(playerSegment.p1.camera.y, playerSegment.p2.camera.y, playerPercent) * height/2),
                    speed * (keyLeft ? -1 : keyRight ? 1 : 0),
                    playerSegment.p2.world.y - playerSegment.p1.world.y);
      
      // Render player name above own car
      renderPlayerName(width/2, (height/2) - (cameraDepth/playerZ * Util.interpolate(playerSegment.p1.camera.y, playerSegment.p2.camera.y, playerPercent) * height/2) - 30, getCurrentPlayerName(), true);
    }

    // Render remote players DIRECTLY in segment loop
    if (remotePlayers && remotePlayers.length > 0) {
      var absolutePosition = position + playerZ;
      
      remotePlayers.forEach((remotePlayer) => {
        var baseRemotePosition = remotePlayer.position || 0;
        
        // Cách 3: Đẩy lệch Z theo UID để players đứng hàng ngang đẹp, không dính
        var uidHash = 0;
        if (remotePlayer.uid) {
          for (var i = 0; i < Math.min(remotePlayer.uid.length, 5); i++) {
            uidHash += remotePlayer.uid.charCodeAt(i);
          }
        }
        var zOffset = (uidHash % 5) * 20; // Lệch Z từ 0-80 theo UID
        var remotePosition = baseRemotePosition + zOffset;
        
        // Cách 2: Ignore render khi quá sát để tránh vẽ chồng sprite
        var dz = Math.abs(remotePosition - absolutePosition);
        if (dz < 30) {
          return; // Skip render nếu quá gần (tránh chồng hình)
        }
        
        // remoteOffset should be offset (-1 to 1), same as playerX and car.offset
        var remoteOffset = remotePlayer.playerX || 0;
        var remoteSegment = findSegment(remotePosition);
        var remotePercent = Util.percentRemaining(remotePosition, segmentLength);
        
        // If remote player is on this segment, render them
        if (remoteSegment.index === segment.index && segment.p1.screen && segment.p2.screen) {
          var spriteScale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, remotePercent);
          var baseX = Util.interpolate(segment.p1.screen.x, segment.p2.screen.x, remotePercent);
          var spriteY = Util.interpolate(segment.p1.screen.y, segment.p2.screen.y, remotePercent);
          
          // Calculate X position with lane offset (same as AI cars: car.offset * roadWidth * width/2)
          var spriteX = baseX + (spriteScale * remoteOffset * roadWidth * width/2);
          
          // Use a different car sprite for remote players
          var remoteCarSprite = SPRITES.CAR01;
          Render.sprite(ctx, width, height, resolution, roadWidth, sprites, remoteCarSprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);
          
          // Render player name above car
          renderPlayerName(spriteX, spriteY - 30, remotePlayer.name, false);
        }
      });
    }
  }
}

/**
 * Render remote players with names
 * Called during the main render loop after segments are projected
 */
function renderRemotePlayers(baseSegment, basePercent, playerSegment, playerPercent, playerY) {
  if (!remotePlayers || remotePlayers.length === 0) return;

  remotePlayers.forEach((remotePlayer) => {
    var remotePosition = remotePlayer.position || 0;
    var absolutePosition = position + playerZ;
    var remoteZ = remotePosition - absolutePosition;
    
    // Render if player is within view distance (both ahead and slightly behind)
    var maxViewDistance = drawDistance * segmentLength;
    // Allow rendering if players are close together (within 5 segments)
    var closeDistance = 5 * segmentLength;
    if (Math.abs(remoteZ) > maxViewDistance && Math.abs(remoteZ) > closeDistance) return;
    
    // If player is too far behind camera, skip (but allow if very close or at start)
    if (remoteZ < -playerZ && Math.abs(remoteZ) > closeDistance) return;

    var remoteSegment = findSegment(remotePosition);
    var remotePercent = Util.percentRemaining(remotePosition, segmentLength);
    var remoteY = Util.interpolate(remoteSegment.p1.world.y, remoteSegment.p2.world.y, remotePercent);
    
    // Calculate which segment in the draw loop this corresponds to
    var segmentIndex = remoteSegment.index;
    var baseIndex = baseSegment.index;
    var n = (segmentIndex - baseIndex + segments.length) % segments.length;
    
    // Handle wrapping
    if (n >= segments.length) n -= segments.length;
    if (n < 0) n += segments.length;
    
    if (n >= 0 && n < drawDistance) {
      var segment = segments[(baseIndex + n) % segments.length];
      
      // Project remote player's segment
      var remoteX = 0;
      var remoteDx = - (baseSegment.curve * basePercent);
      for (var i = 0; i < n; i++) {
        var seg = segments[(baseIndex + i) % segments.length];
        remoteX = remoteX + remoteDx;
        remoteDx = remoteDx + seg.curve;
      }
      
      // Project segment for remote player
      Util.project(segment.p1, (playerX * roadWidth) - remoteX, playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);
      Util.project(segment.p2, (playerX * roadWidth) - remoteX - remoteDx, playerY + cameraHeight, position - (segment.looped ? trackLength : 0), cameraDepth, width, height, roadWidth);
      
      if (segment.p1.screen && segment.p2.screen && segment.p1.camera.z > cameraDepth) {
        var spriteScale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, remotePercent);
        var spriteX = Util.interpolate(segment.p1.screen.x, segment.p2.screen.x, remotePercent);
        var spriteY = Util.interpolate(segment.p1.screen.y, segment.p2.screen.y, remotePercent);
        
        // Render remote player car (using a different car sprite)
        var remoteCarSprite = SPRITES.CAR01;
        Render.sprite(ctx, width, height, resolution, roadWidth, sprites, remoteCarSprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);
        
        // Render player name above car
        renderPlayerName(spriteX, spriteY - 30, remotePlayer.name, false);
      }
    }
  });
}

/**
 * Render player name above car
 */
function renderPlayerName(x, y, name, isLocal) {
  if (!name) return;
  
  ctx.save();
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  
  // Draw text with outline
  ctx.strokeText(name, x, y);
  ctx.fillText(name, x, y);
  
  ctx.restore();
}

/**
 * Get current player name from room data
 */
function getCurrentPlayerName() {
  var roomData = getRoomData();
  if (roomData && roomData.players && roomData.players[uid]) {
    return roomData.players[uid].name || 'Player';
  }
  return 'Player';
}

function findSegment(z) {
  return segments[Math.floor(z/segmentLength) % segments.length]; 
}

//=========================================================================
// BUILD ROAD GEOMETRY
//=========================================================================

function lastY() { return (segments.length == 0) ? 0 : segments[segments.length-1].p2.world.y; }

function addSegment(curve, y) {
  var n = segments.length;
  segments.push({
      index: n,
         p1: { world: { y: lastY(), z:  n   *segmentLength }, camera: {}, screen: {} },
         p2: { world: { y: y,       z: (n+1)*segmentLength }, camera: {}, screen: {} },
      curve: curve,
    sprites: [],
       cars: [],
      color: Math.floor(n/rumbleLength)%2 ? COLORS.DARK : COLORS.LIGHT
  });
}

function addSprite(n, sprite, offset) {
  segments[n].sprites.push({ source: sprite, offset: offset });
}

function addRoad(enter, hold, leave, curve, y) {
  var startY   = lastY();
  var endY     = startY + (Util.toInt(y, 0) * segmentLength);
  var n, total = enter + hold + leave;
  for(n = 0 ; n < enter ; n++)
    addSegment(Util.easeIn(0, curve, n/enter), Util.easeInOut(startY, endY, n/total));
  for(n = 0 ; n < hold  ; n++)
    addSegment(curve, Util.easeInOut(startY, endY, (enter+n)/total));
  for(n = 0 ; n < leave ; n++)
    addSegment(Util.easeInOut(curve, 0, n/leave), Util.easeInOut(startY, endY, (enter+hold+n)/total));
}

var ROAD = {
  LENGTH: { NONE: 0, SHORT:  25, MEDIUM:   50, LONG:  100 },
  HILL:   { NONE: 0, LOW:    20, MEDIUM:   40, HIGH:   60 },
  CURVE:  { NONE: 0, EASY:    2, MEDIUM:    4, HARD:    6 }
};

function addStraight(num) {
  num = num || ROAD.LENGTH.MEDIUM;
  addRoad(num, num, num, 0, 0);
}

function addHill(num, height) {
  num    = num    || ROAD.LENGTH.MEDIUM;
  height = height || ROAD.HILL.MEDIUM;
  addRoad(num, num, num, 0, height);
}

function addCurve(num, curve, height) {
  num    = num    || ROAD.LENGTH.MEDIUM;
  curve  = curve  || ROAD.CURVE.MEDIUM;
  height = height || ROAD.HILL.NONE;
  addRoad(num, num, num, curve, height);
}
    
function addLowRollingHills(num, height) {
  num    = num    || ROAD.LENGTH.SHORT;
  height = height || ROAD.HILL.LOW;
  addRoad(num, num, num,  0,                height/2);
  addRoad(num, num, num,  0,               -height);
  addRoad(num, num, num,  ROAD.CURVE.EASY,  height);
  addRoad(num, num, num,  0,                0);
  addRoad(num, num, num, -ROAD.CURVE.EASY,  height/2);
  addRoad(num, num, num,  0,                0);
}

function addSCurves() {
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,  -ROAD.CURVE.EASY,    ROAD.HILL.NONE);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,   ROAD.CURVE.MEDIUM,  ROAD.HILL.MEDIUM);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,   ROAD.CURVE.EASY,   -ROAD.HILL.LOW);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,  -ROAD.CURVE.EASY,    ROAD.HILL.MEDIUM);
  addRoad(ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM, ROAD.LENGTH.MEDIUM,  -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
}

function addBumps() {
  addRoad(10, 10, 10, 0,  5);
  addRoad(10, 10, 10, 0, -2);
  addRoad(10, 10, 10, 0, -5);
  addRoad(10, 10, 10, 0,  8);
  addRoad(10, 10, 10, 0,  5);
  addRoad(10, 10, 10, 0, -7);
  addRoad(10, 10, 10, 0,  5);
  addRoad(10, 10, 10, 0, -2);
}

function addDownhillToEnd(num) {
  num = num || 200;
  addRoad(num, num, num, -ROAD.CURVE.EASY, -lastY()/segmentLength);
}

function resetRoad() {
  segments = [];

  addStraight(ROAD.LENGTH.SHORT);
  addLowRollingHills();
  addSCurves();
  addCurve(ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
  addBumps();
  addLowRollingHills();
  addCurve(ROAD.LENGTH.LONG*2, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
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

  resetSprites();
  resetCars();

  segments[findSegment(playerZ).index + 2].color = COLORS.START;
  segments[findSegment(playerZ).index + 3].color = COLORS.START;
  for(var n = 0 ; n < rumbleLength ; n++)
    segments[segments.length-1-n].color = COLORS.FINISH;

  trackLength = segments.length * segmentLength;
}

function resetSprites() {
  var n, i;

  addSprite(20,  SPRITES.BILLBOARD07, -1);
  addSprite(40,  SPRITES.BILLBOARD06, -1);
  addSprite(60,  SPRITES.BILLBOARD08, -1);
  addSprite(80,  SPRITES.BILLBOARD09, -1);
  addSprite(100, SPRITES.BILLBOARD01, -1);
  addSprite(120, SPRITES.BILLBOARD02, -1);
  addSprite(140, SPRITES.BILLBOARD03, -1);
  addSprite(160, SPRITES.BILLBOARD04, -1);
  addSprite(180, SPRITES.BILLBOARD05, -1);

  addSprite(240,                  SPRITES.BILLBOARD07, -1.2);
  addSprite(240,                  SPRITES.BILLBOARD06,  1.2);
  addSprite(segments.length - 25, SPRITES.BILLBOARD07, -1.2);
  addSprite(segments.length - 25, SPRITES.BILLBOARD06,  1.2);

  for(n = 10 ; n < 200 ; n += 4 + Math.floor(n/100)) {
    addSprite(n, SPRITES.PALM_TREE, 0.5 + Math.random()*0.5);
    addSprite(n, SPRITES.PALM_TREE,   1 + Math.random()*2);
  }

  for(n = 250 ; n < 1000 ; n += 5) {
    addSprite(n,     SPRITES.COLUMN, 1.1);
    addSprite(n + Util.randomInt(0,5), SPRITES.TREE1, -1 - (Math.random() * 2));
    addSprite(n + Util.randomInt(0,5), SPRITES.TREE2, -1 - (Math.random() * 2));
  }

  for(n = 200 ; n < segments.length ; n += 3) {
    addSprite(n, Util.randomChoice(SPRITES.PLANTS), Util.randomChoice([1,-1]) * (2 + Math.random() * 5));
  }

  var side, sprite, offset;
  for(n = 1000 ; n < (segments.length-50) ; n += 100) {
    side      = Util.randomChoice([1, -1]);
    addSprite(n + Util.randomInt(0, 50), Util.randomChoice(SPRITES.BILLBOARDS), -side);
    for(i = 0 ; i < 20 ; i++) {
      sprite = Util.randomChoice(SPRITES.PLANTS);
      offset = side * (1.5 + Math.random());
      addSprite(n + Util.randomInt(0, 50), sprite, offset);
    }
  }
}

function resetCars() {
  cars = [];
  var n, car, segment, offset, z, sprite, speed;
  for (n = 0 ; n < totalCars ; n++) {
    offset = Math.random() * Util.randomChoice([-0.8, 0.8]);
    z      = Math.floor(Math.random() * segments.length) * segmentLength;
    sprite = Util.randomChoice(SPRITES.CARS);
    speed  = maxSpeed/4 + Math.random() * maxSpeed/(sprite == SPRITES.SEMI ? 4 : 2);
    car = { offset: offset, z: z, sprite: sprite, speed: speed };
    segment = findSegment(car.z);
    segment.cars.push(car);
    cars.push(car);
  }
}

//=========================================================================
// THE GAME LOOP
//=========================================================================

// Set waiting room ID from URL
const urlParams = new URLSearchParams(window.location.search);
const urlRoomId = urlParams.get('roomId');
if (urlRoomId) {
  const waitingRoomIdEl = Dom.get('waitingRoomId');
  if (waitingRoomIdEl) {
    waitingRoomIdEl.textContent = urlRoomId;
  }
}

Game.run({
  canvas: canvas, render: render, update: update, stats: null, step: step,
  images: ["background", "sprites"],
  keys: [
    { keys: [KEY.LEFT,  KEY.A], mode: 'down', action: function() { keyLeft   = true;  } },
    { keys: [KEY.RIGHT, KEY.D], mode: 'down', action: function() { keyRight  = true;  } },
    { keys: [KEY.UP,    KEY.W], mode: 'down', action: function() { keyFaster = true;  } },
    { keys: [KEY.DOWN,  KEY.S], mode: 'down', action: function() { keySlower = true;  } },
    { keys: [KEY.SPACE], mode: 'down', action: function() { keySpace = true; } },
    { keys: [KEY.LEFT,  KEY.A], mode: 'up',   action: function() { keyLeft   = false; } },
    { keys: [KEY.RIGHT, KEY.D], mode: 'up',   action: function() { keyRight  = false; } },
    { keys: [KEY.UP,    KEY.W], mode: 'up',   action: function() { keyFaster = false; } },
    { keys: [KEY.DOWN,  KEY.S], mode: 'up',   action: function() { keySlower = false; } },
    { keys: [KEY.SPACE], mode: 'up', action: function() { keySpace = false; } }
  ],
  ready: function(images) {
    background = images[0];
    sprites    = images[1];
    reset();
    Dom.storage.fast_lap_time = Dom.storage.fast_lap_time || 180;
    updateHud('fast_lap_time', formatTime(Util.toFloat(Dom.storage.fast_lap_time)));
  }
});

function reset(options) {
  options       = options || {};
  // Update to fullscreen
  width  = window.innerWidth || 1920;
  height = window.innerHeight || 1080;
  canvas.width  = width;
  canvas.height = height;
  lanes                  = Util.toInt(options.lanes,          lanes);
  roadWidth              = Util.toInt(options.roadWidth,      roadWidth);
  cameraHeight           = Util.toInt(options.cameraHeight,   cameraHeight);
  drawDistance           = Util.toInt(options.drawDistance,   drawDistance);
  fogDensity             = Util.toInt(options.fogDensity,     fogDensity);
  fieldOfView            = Util.toInt(options.fieldOfView,    fieldOfView);
  segmentLength          = Util.toInt(options.segmentLength,  segmentLength);
  rumbleLength           = Util.toInt(options.rumbleLength,   rumbleLength);
  cameraDepth            = 1 / Math.tan((fieldOfView/2) * Math.PI/180);
  playerZ                = (cameraHeight * cameraDepth);
  resolution             = height/480;

  if ((segments.length==0) || (options.segmentLength) || (options.rumbleLength))
    resetRoad();
}
