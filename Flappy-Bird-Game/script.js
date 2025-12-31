// ---------- Constants & Tuning (base defaults kept) ----------
const MOVE_SPEED = 3;
const GRAVITY = 0.5;
const FLAP_VELOCITY = -7.6;
const PIPE_SEPARATION_THRESHOLD = 115;
const PIPE_GAP_VH = 50;

const FLAP_COOLDOWN_MS = 250;
const FLAP_DY_THRESHOLD = 0.03; // sensitivity for upward flick

// ---------- Difficulty runtime vars & presets ----------
let MOVE_SPEED_VAR = MOVE_SPEED;
let GRAVITY_VAR = GRAVITY;
let FLAP_VELOCITY_VAR = FLAP_VELOCITY; // adjustable if needed
let PIPE_SEPARATION_THRESHOLD_VAR = PIPE_SEPARATION_THRESHOLD;
let PIPE_GAP_VH_VAR = PIPE_GAP_VH;

const DIFFICULTY = {
  easy: { moveSpeed: 2.0, gravity: 0.38, flapVelocity: -7.6, pipeGapVH: 58, pipeSep: 135 },
  medium: { moveSpeed: 3.0, gravity: 0.50, flapVelocity: -7.6, pipeGapVH: 50, pipeSep: 115 },
  hard: { moveSpeed: 4.5, gravity: 0.62, flapVelocity: -7.6, pipeGapVH: 42, pipeSep: 95 }
};

function applyDifficulty(key) {
  const p = DIFFICULTY[key] || DIFFICULTY.medium;
  MOVE_SPEED_VAR = p.moveSpeed;
  GRAVITY_VAR = p.gravity;
  FLAP_VELOCITY_VAR = p.flapVelocity;
  PIPE_GAP_VH_VAR = p.pipeGapVH;
  PIPE_SEPARATION_THRESHOLD_VAR = p.pipeSep;
}

/* Wire up difficulty select */
const diffEl = document.getElementById('difficulty_select');
if (diffEl) {
  diffEl.addEventListener('change', (e) => applyDifficulty(e.target.value));
  applyDifficulty(diffEl.value || 'medium');
} else {
  applyDifficulty('medium');
}

// ---------- DOM References ----------
const bird = document.querySelector('.bird');
const birdImg = document.getElementById('bird-1');
const backgroundEl = document.querySelector('.background');

const scoreValEl = document.querySelector('.score_val');
const scoreTitleEl = document.querySelector('.score_title');
const messageEl = document.querySelector('.message');

// Audio
const soundPoint = new Audio('sounds effect/point.mp3');
const soundDie = new Audio('sounds effect/die.mp3');

// ---------- Score Flash Overlay setup (re-use existing div if present) ----------
let scoreFlashEl = document.getElementById('score_flash_overlay');
if (!scoreFlashEl) {
  scoreFlashEl = document.createElement('div');
  scoreFlashEl.id = 'score_flash_overlay';
  // Inline style as fallback (CSS file also styles it)
  Object.assign(scoreFlashEl.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(255, 255, 0, 0.55)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 120ms ease-out',
    zIndex: '9999'
  });
  document.body.appendChild(scoreFlashEl);
}

function triggerScoreFlash(duration = 120) {
  if (!scoreFlashEl) return;
  // quick fade in/out
  scoreFlashEl.style.opacity = '1';
  setTimeout(() => {
    scoreFlashEl.style.opacity = '0';
  }, duration);
}

// ---------- State ----------
let gameState = 'Start'; // 'Start' | 'Ready' | 'Play' | 'End'
let birdDy = 0;
let birdRect = bird.getBoundingClientRect();
let backgroundRect = backgroundEl.getBoundingClientRect();

// MediaPipe / camera flags
let cameraStarted = false;

// Gesture state
let prevTipY = null;
let lastFlapTime = 0;

// Initialize UI state
if (birdImg) birdImg.style.display = 'none';
if (messageEl) messageEl.classList.add('messageStyle');

// ---------- Keyboard Controls ----------
document.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowUp' || e.key === ' ') && gameState === 'Ready') {
    startPlayFromInput();
  } else if ((e.key === 'ArrowUp' || e.key === ' ') && gameState === 'Play') {
    flap();
  }

  if ((e.key === 'Enter' || e.key === 'ArrowUp' || e.key === ' ') && !cameraStarted) {
    startCameraAndMediapipe();
  }

  if (e.key === 'Enter' && gameState !== 'Play') {
    resetToReady();
  }
});

document.addEventListener('keyup', (e) => {
  if ((e.key === 'ArrowUp' || e.key === ' ') && gameState === 'Play') {
    if (birdImg) birdImg.src = 'images/Bird.png';
  }
});

// ---------- Small helpers ----------
function startPlayFromInput() {
  gameState = 'Play';
  if (messageEl) messageEl.innerHTML = '';
  play();
  if (birdImg) birdImg.src = 'images/Bird-2.png';
  birdDy = FLAP_VELOCITY_VAR;
  if (birdImg) birdImg.style.display = 'block';
}

function flap() {
  if (birdImg) birdImg.src = 'images/Bird-2.png';
  birdDy = FLAP_VELOCITY_VAR;
}

function resetToReady() {
  document.querySelectorAll('.pipe_sprite').forEach((p) => p.remove());
  if (birdImg) birdImg.style.display = 'block';
  if (bird) bird.style.top = '40vh';
  birdDy = 0;
  birdRect = bird.getBoundingClientRect();
  backgroundRect = backgroundEl.getBoundingClientRect();
  gameState = 'Ready';
  if (messageEl) messageEl.innerHTML = 'Press ArrowUp or Space to Start';
  if (scoreTitleEl) scoreTitleEl.innerHTML = 'Score : ';
  if (scoreValEl) scoreValEl.innerHTML = '0';
  if (messageEl) messageEl.classList.remove('messageStyle');
}

// ---------- MediaPipe Hands Setup ----------
const videoElement = document.getElementById('input_video') || (() => {
  const v = document.createElement('video');
  v.id = 'input_video';
  v.autoplay = true;
  v.playsInline = true;
  v.classList.add('debug-video'); // class-controlled styling
  document.body.appendChild(v);
  return v;
})();

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.6
});

// MediaPipe results callback -> gesture detection
hands.onResults((results) => {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    prevTipY = null;
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const tip = landmarks[8];
  const tipY = tip.y;
  const now = performance.now();

  if (prevTipY !== null) {
    const dy = prevTipY - tipY; // positive when hand moved up
    if (dy > FLAP_DY_THRESHOLD && (now - lastFlapTime) > FLAP_COOLDOWN_MS) {
      lastFlapTime = now;
      if (gameState === 'Ready') {
        startPlayFromInput();
      } else if (gameState === 'Play') {
        flap();
      }
    }
  }

  prevTipY = tipY;
});

// ---------- Camera start helper (user gesture friendly) ----------
async function startCameraAndMediapipe() {
  if (cameraStarted) return;
  cameraStarted = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    });

    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;

    // Show debug video by toggling class — styling lives in CSS
    videoElement.classList.add('visible');

    await new Promise(resolve => videoElement.onloadedmetadata = resolve);
    await videoElement.play().catch(() => {/* ignore play reject after user gesture check */ });

    // Start MediaPipe Camera wrapper
    const camera = new Camera(videoElement, {
      onFrame: async () => { await hands.send({ image: videoElement }); },
      width: 640,
      height: 480
    });

    await camera.start();
    console.log('MediaPipe camera STARTED');

    // Remove the enable button if present
    const btn = document.getElementById('enable_cam_btn');
    if (btn && btn.parentElement) btn.remove();
  } catch (err) {
    console.error('Camera/MediaPipe init failed:', err);
    cameraStarted = false; // allow retry
  }
}

// Minimal UI: create Enable Camera button (styling in CSS)
(function createEnableCameraButton() {
  if (document.getElementById('enable_cam_btn')) return;
  const btn = document.createElement('button');
  btn.id = 'enable_cam_btn';
  btn.type = 'button';
  btn.classList.add('enable-cam-btn'); // use CSS class
  btn.innerText = 'Enable Camera';
  btn.addEventListener('click', () => startCameraAndMediapipe());
  document.body.appendChild(btn);
})();

// ---------- Game Loop & Mechanics ----------
function play() {
  // Move pipes and detect collisions/score
  function move() {
    if (gameState !== 'Play') return;

    const pipes = document.querySelectorAll('.pipe_sprite');
    pipes.forEach((pipe) => {
      const pipeRect = pipe.getBoundingClientRect();
      birdRect = bird.getBoundingClientRect();
      backgroundRect = backgroundEl.getBoundingClientRect();

      if (pipeRect.right <= 0) {
        pipe.remove();
        return;
      }

      // Collision detection
      const collided =
        birdRect.left < pipeRect.left + pipeRect.width &&
        birdRect.left + birdRect.width > pipeRect.left &&
        birdRect.top < pipeRect.top + pipeRect.height &&
        birdRect.top + birdRect.height > pipeRect.top;

      if (collided) {
        endGame();
        return;
      }

      // Scoring (use runtime speed var)
      if (
        pipeRect.right < birdRect.left &&
        pipeRect.right + MOVE_SPEED_VAR >= birdRect.left &&
        pipe.increase_score === '1'
      ) {
        const cur = parseInt(scoreValEl.innerHTML) || 0;
        scoreValEl.innerHTML = cur + 1;

        // NEW: yellow flash when scoring
        triggerScoreFlash();

        pipe.increase_score = '0';
        try { soundPoint.play(); } catch (e) { }
      }

      // Move pipe (use runtime speed var)
      pipe.style.left = (pipeRect.left - MOVE_SPEED_VAR) + 'px';
    });

    requestAnimationFrame(move);
  }

  // Gravity / vertical motion
  function applyGravity() {
    if (gameState !== 'Play') return;

    birdDy += GRAVITY_VAR; // runtime gravity
    birdRect = bird.getBoundingClientRect();
    backgroundRect = backgroundEl.getBoundingClientRect();

    if (birdRect.top <= 0 || birdRect.bottom >= backgroundRect.bottom) {
      endGame();
      return;
    }

    bird.style.top = (birdRect.top + birdDy) + 'px';
    birdRect = bird.getBoundingClientRect();
    requestAnimationFrame(applyGravity);
  }

  // Pipe creation (uses runtime gap & separation)
  let pipeSeparationCounter = 0;
  function createPipe() {
    if (gameState !== 'Play') return;

    if (pipeSeparationCounter > PIPE_SEPARATION_THRESHOLD_VAR) {
      pipeSeparationCounter = 0;
      const pipeBase = Math.floor(Math.random() * 43) + 8;

      // top (inverted) pipe
      const topPipe = document.createElement('div');
      topPipe.className = 'pipe_sprite';
      topPipe.style.top = (pipeBase - 70) + 'vh';
      topPipe.style.left = '100vw';
      document.body.appendChild(topPipe);

      // bottom pipe
      const bottomPipe = document.createElement('div');
      bottomPipe.className = 'pipe_sprite';
      bottomPipe.style.top = (pipeBase + PIPE_GAP_VH_VAR) + 'vh';
      bottomPipe.style.left = '100vw';
      bottomPipe.increase_score = '1';
      document.body.appendChild(bottomPipe);
    }

    pipeSeparationCounter++;
    requestAnimationFrame(createPipe);
  }

  requestAnimationFrame(move);
  requestAnimationFrame(applyGravity);
  requestAnimationFrame(createPipe);
}

function endGame() {
  gameState = 'End';
  if (messageEl) {
    messageEl.style.left = '50%';
    messageEl.style.top = '50%';
    messageEl.style.transform = 'translate(-50%, -50%)';
    messageEl.innerHTML = 'Game Over'.fontcolor('red') + '<br>Press Enter To Restart';
    messageEl.classList.add('messageStyle');
  }
  if (birdImg) birdImg.style.display = 'none';
  try { soundDie.play(); } catch (e) { }

  // NOTE: original code doesn't persist high score; if you want that added I can add it
}

// ---------- Optional: Animated Pipe Colors ----------
function getRandomColor() {
  const hex = '0123456789ABCDEF';
  let c = '#';
  for (let i = 0; i < 6; i++) c += hex[Math.floor(Math.random() * 16)];
  return c;
}

(function animatePipeColors() {
  const pipes = document.querySelectorAll('.pipe_sprite');
  pipes.forEach((pipe) => {
    pipe.style.background = getRandomColor();
    pipe.style.borderColor = getRandomColor();
  });
  requestAnimationFrame(animatePipeColors);
})();
