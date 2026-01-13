//=========================================================================
// Quiz System (Kahoot-style)
//=========================================================================

import { getDatabase, ref, set, update, get, onValue, off, initFirebase } from './firebase.js';

// Initialize Firebase
if (!initFirebase()) {
  console.error('Failed to initialize Firebase in quiz.js');
}

const db = getDatabase();

let roomId = null;
let uid = null;
let quizData = null;
let quizListener = null;

/**
 * Initialize quiz system
 */
export function initQuiz(roomIdParam, uidParam) {
  roomId = roomIdParam;
  uid = uidParam;

  if (!roomId || !uid) return;

  // Listen to quiz updates
  const quizRef = ref(`rooms/${roomId}/quiz`);
  quizListener = onValue(quizRef, (snapshot) => {
    quizData = snapshot.val();
    if (quizData && quizData.active) {
      showQuiz();
    } else {
      hideQuiz();
    }
  });
}

/**
 * Show quiz overlay
 */
function showQuiz() {
  if (!quizData) return;

  const overlay = document.getElementById('quizOverlay');
  if (!overlay) return;

  overlay.classList.add('active');

  // Update quiz content
  const questionEl = document.getElementById('quizQuestion');
  const timerEl = document.getElementById('quizTimer');
  const optionsContainer = document.getElementById('quizOptions');

  if (questionEl) questionEl.textContent = quizData.question || '';

  // Clear previous options
  if (optionsContainer) {
    optionsContainer.innerHTML = '';
    
    if (quizData.options && Array.isArray(quizData.options)) {
      quizData.options.forEach((option, index) => {
        const optionBtn = document.createElement('div');
        optionBtn.className = 'quiz-option';
        optionBtn.textContent = option;
        optionBtn.dataset.index = index;
        optionBtn.addEventListener('click', () => selectAnswer(index));
        optionsContainer.appendChild(optionBtn);
      });
    }
  }

  // Start countdown timer
  if (quizData.startTime) {
    startCountdown(quizData.startTime);
  }
}

/**
 * Hide quiz overlay
 */
function hideQuiz() {
  const overlay = document.getElementById('quizOverlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
}

/**
 * Start countdown timer
 */
function startCountdown(startTime) {
  const timerEl = document.getElementById('quizTimer');
  if (!timerEl) return;

  const duration = 5000; // 5 seconds
  const updateTimer = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, duration - elapsed);
    const seconds = (remaining / 1000).toFixed(1);
    
    timerEl.textContent = seconds + 's';
    
    if (remaining > 0) {
      requestAnimationFrame(updateTimer);
    } else {
      timerEl.textContent = 'Time\'s up!';
      // Auto-hide after a moment
      setTimeout(() => {
        hideQuiz();
      }, 1000);
    }
  };
  
  updateTimer();
}

/**
 * Select answer and submit to Firebase
 */
async function selectAnswer(answerIndex) {
  if (!roomId || !uid) return;

  // Mark option as selected
  const options = document.querySelectorAll('.quiz-option');
  options.forEach((opt, idx) => {
    if (idx === answerIndex) {
      opt.classList.add('selected');
    } else {
      opt.classList.remove('selected');
    }
  });

  // Submit answer to Firebase
  const answerRef = ref(`rooms/${roomId}/answers/${uid}`);
  await set(answerRef, {
    answerIndex: answerIndex,
    time: Date.now()
  });
}

/**
 * Create quiz (admin only)
 */
export async function createQuiz(question, options, correctIndex) {
  if (!roomId) return;

  const quizRef = ref(`rooms/${roomId}/quiz`);
  await update(quizRef, {
    active: true,
    question: question,
    options: options,
    correctIndex: correctIndex,
    startTime: Date.now()
  });
}

/**
 * End quiz and grant nitro to fastest correct answer (admin only)
 */
export async function endQuiz() {
  if (!roomId || !quizData) return;

  const answersRef = ref(`rooms/${roomId}/answers`);
  const answersSnapshot = await get(answersRef);
  
  if (!answersSnapshot.exists()) {
    // No answers, just end quiz
    const quizRef = ref(db, `rooms/${roomId}/quiz`);
    await update(quizRef, { active: false });
    return;
  }

  const answers = answersSnapshot.val();
  const correctAnswers = [];

  // Find all correct answers
  for (const [playerUid, answerData] of Object.entries(answers)) {
    if (answerData.answerIndex === quizData.correctIndex) {
      correctAnswers.push({
        uid: playerUid,
        time: answerData.time
      });
    }
  }

  // Grant nitro to fastest correct answer
  if (correctAnswers.length > 0) {
    correctAnswers.sort((a, b) => a.time - b.time);
    const winner = correctAnswers[0];
    
    const playerRef = ref(`rooms/${roomId}/players/${winner.uid}`);
    await update(playerRef, { nitro: true });

    // Auto-disable nitro after 3 seconds
    setTimeout(async () => {
      await update(playerRef, { nitro: false });
    }, 3000);
  }

  // Clear answers and end quiz
  await set(ref(`rooms/${roomId}/answers`), {});
  const quizRef = ref(`rooms/${roomId}/quiz`);
  await update(quizRef, { active: false });
}

/**
 * Cleanup quiz listeners
 */
export function cleanup() {
  if (quizListener && roomId) {
    const quizRef = ref(`rooms/${roomId}/quiz`);
    off(quizRef);
  }
}
