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
    question: "Nội dung nào được coi là \"sợi chỉ đỏ\" xuyên suốt toàn bộ di sản tư tưởng lý luận và hoạt động thực tiễn của Chủ tịch Hồ Chí Minh?",
    options: [
      "Phát triển kinh tế thị trường định hướng xã hội chủ nghĩa",
      "Độc lập dân tộc gắn liền với chủ nghĩa xã hội",
      "Mở rộng quan hệ ngoại giao đa phương hóa, đa dạng hóa",
      "Xây dựng nền văn hóa tiên tiến, đậm đà bản sắc dân tộc"
    ],
    correctIndex: 1
  },
  {
    question: "Sau Cách mạng Tháng Tám 1945, Chủ tịch Hồ Chí Minh đã khẳng định: \"Nước độc lập mà dân không hưởng hạnh phúc tự do, thì độc lập cũng...\"?",
    options: [
      "Là mục tiêu cuối cùng của cách mạng",
      "Cần phải được bảo vệ bằng mọi giá",
      "Chẳng có ý nghĩa gì",
      "Sẽ sớm bị các thế lực thù địch thôn tính"
    ],
    correctIndex: 2
  },
  {
    question: "Chân lý bất hủ nào được Chủ tịch Hồ Chí Minh khẳng định vào năm 1966, trở thành lẽ sống và nguồn cổ vũ to lớn cho dân tộc Việt Nam và các dân tộc bị áp bức trên thế giới?",
    options: [
      "Đoàn kết, đoàn kết, đại đoàn kết",
      "Không có gì quý hơn độc lập, tự do",
      "Dân là gốc của nước, nước lấy dân làm gốc",
      "Muốn cứu nước phải đi theo con đường cách mạng vô sản"
    ],
    correctIndex: 1
  },
  {
    question: "Theo Chủ tịch Hồ Chí Minh, con đường duy nhất đúng đắn để giải phóng dân tộc và mang lại độc lập thật sự cho nhân dân Việt Nam là gì?",
    options: [
      "Con đường cách mạng dân chủ tư sản",
      "Con đường cải cách lương bang, ôn hòa",
      "Con đường cách mạng vô sản",
      "Con đường phục hồi chế độ phong kiến tiến bộ"
    ],
    correctIndex: 2
  },
  {
    question: "Trong cách diễn đạt dung dị, mộc mạc của Chủ tịch Hồ Chí Minh, mục tiêu cao nhất của chủ nghĩa xã hội là gì?",
    options: [
      "Xây dựng các khu công nghiệp nặng hiện đại",
      "Làm cho dân giàu, nước mạnh, nhân dân được ấm no, hạnh phúc",
      "Hoàn thành công cuộc cải cách ruộng đất trên cả nước",
      "Thiết lập quan hệ ngoại giao với tất cả các nước tư bản"
    ],
    correctIndex: 1
  },
  {
    question: "Theo tư tưởng Chủ tịch Hồ Chí Minh, mối quan hệ giữa độc lập dân tộc và chủ nghĩa xã hội được xác định như thế nào?",
    options: [
      "Độc lập dân tộc là mục tiêu cuối cùng, chủ nghĩa xã hội chỉ là phương tiện",
      "Độc lập dân tộc là cơ sở, tiền đề để tiến lên chủ nghĩa xã hội",
      "Chủ nghĩa xã hội phải được xây dựng xong thì mới có độc lập dân tộc",
      "Đây là hai mục tiêu tách biệt, không có mối liên hệ biện chứng"
    ],
    correctIndex: 1
  },
  {
    question: "Theo Chủ tịch Hồ Chí Minh, chủ thể đóng vai trò quyết định, là động lực hàng đầu trong công cuộc xây dựng chủ nghĩa xã hội là ai?",
    options: [
      "Đội ngũ trí thức và chuyên gia nước ngoài",
      "Nhân dân lao động dưới sự lãnh đạo của Đảng",
      "Các tập đoàn kinh tế nhà nước lớn",
      "Lực lượng vũ trang nhân dân"
    ],
    correctIndex: 1
  },
  {
    question: "Trong \"Kỷ nguyên mới - Kỷ nguyên vươn mình của dân tộc\", mục tiêu đến năm 2045 mà chúng ta phấn đấu thực hiện theo tư tưởng của Chủ tịch Hồ Chí Minh là gì?",
    options: [
      "Trở thành nước có thu nhập trung bình thấp",
      "Trở thành nước phát triển, có thu nhập cao",
      "Hoàn thành cơ bản quá trình xóa mù chữ trên toàn quốc",
      "Trở thành một cường quốc quân sự hàng đầu khu vực"
    ],
    correctIndex: 1
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
