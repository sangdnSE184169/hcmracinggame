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

// Hardcoded quiz questions
const QUIZ_QUESTIONS = [
  {
    question: "What is the capital of France?",
    options: ["London", "Berlin", "Paris", "Madrid"],
    correctIndex: 2
  },
  {
    question: "Which planet is known as the Red Planet?",
    options: ["Venus", "Mars", "Jupiter", "Saturn"],
    correctIndex: 1
  },
  {
    question: "What is 2 + 2?",
    options: ["3", "4", "5", "6"],
    correctIndex: 1
  },
  {
    question: "Who wrote 'Romeo and Juliet'?",
    options: ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"],
    correctIndex: 1
  },
  {
    question: "What is the largest ocean on Earth?",
    options: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"],
    correctIndex: 3
  },
  {
    question: "What is the chemical symbol for gold?",
    options: ["Go", "Gd", "Au", "Ag"],
    correctIndex: 2
  },
  {
    question: "How many continents are there?",
    options: ["5", "6", "7", "8"],
    correctIndex: 2
  },
  {
    question: "What is the speed of light?",
    options: ["300,000 km/s", "150,000 km/s", "450,000 km/s", "600,000 km/s"],
    correctIndex: 0
  },
  {
    question: "Which gas do plants absorb from the atmosphere?",
    options: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"],
    correctIndex: 2
  },
  {
    question: "What is the smallest prime number?",
    options: ["0", "1", "2", "3"],
    correctIndex: 2
  }
];

let currentQuestionIndex = 0;

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
    const data = snapshot.val();
    quizData = data; // Store the data
    
    // Only show quiz if data exists AND active is explicitly true
    if (data && data.active === true) {
      showQuiz();
    } else {
      // Hide quiz if no data, or active is false/undefined
      hideQuiz();
      // Reset quizData to null if quiz is not active
      if (!data || data.active !== true) {
        quizData = null;
      }
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

  const duration = 20000; // 20 seconds
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
 * Get next quiz question from hardcoded list
 */
export function getNextQuiz() {
  if (QUIZ_QUESTIONS.length === 0) return null;
  
  const quiz = QUIZ_QUESTIONS[currentQuestionIndex % QUIZ_QUESTIONS.length];
  currentQuestionIndex++;
  return quiz;
}

/**
 * Auto-create quiz (called every 45s)
 */
export async function autoCreateQuiz(roomIdParam) {
  if (!roomIdParam) return;
  
  const quiz = getNextQuiz();
  if (!quiz) return;
  
  await createQuiz(quiz.question, quiz.options, quiz.correctIndex);
  
  // Auto-end quiz after 20 seconds
  setTimeout(async () => {
    await endQuiz(roomIdParam);
  }, 20000);
}

/**
 * End quiz and grant nitro to fastest correct answer (admin only)
 */
export async function endQuiz(roomIdParam) {
  const targetRoomId = roomIdParam || roomId;
  if (!targetRoomId) return;
  
  // Get quiz data if not available
  if (!quizData) {
    const quizRef = ref(`rooms/${targetRoomId}/quiz`);
    const quizSnapshot = await get(quizRef);
    quizData = quizSnapshot.val();
  }
  
  if (!quizData) return;

  const answersRef = ref(`rooms/${targetRoomId}/answers`);
  const answersSnapshot = await get(answersRef);
  
  if (!answersSnapshot.exists()) {
    // No answers, just end quiz
    const quizRef = ref(`rooms/${targetRoomId}/quiz`);
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
    
    const playerRef = ref(`rooms/${targetRoomId}/players/${winner.uid}`);
    await update(playerRef, { nitro: true });

    // Auto-disable nitro after 10 seconds
    setTimeout(async () => {
      await update(playerRef, { nitro: false });
    }, 10000);
  }

  // Clear answers and end quiz
  await set(ref(`rooms/${targetRoomId}/answers`), {});
  const quizRef = ref(`rooms/${targetRoomId}/quiz`);
  await update(quizRef, { active: false });
}

/**
 * Check if quiz is currently active
 */
export function isQuizActive() {
  // Only return true if quizData exists AND active is explicitly true
  if (!quizData) return false;
  return quizData.active === true;
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
