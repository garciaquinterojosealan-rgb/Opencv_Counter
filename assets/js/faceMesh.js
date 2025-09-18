// Contadores
let eyeCount = 0, mouthCount = 0, browCount = 0;

// Estados previos
let prevEyesClosed = false, prevMouthOpen = false, prevBrowsRaised = false;

// Línea base para cejas
let browBaseline = null;

// Suavizado (EMA) para cejas
let browEMA = null;
const BROW_EMA_ALPHA = 0.38;       // sensibilidad

// Control de estabilidad cejas
let browStableFrames = 0;
const browMinFrames = 2;           // frames para confirmar gesto

// Cooldown tras parpadeo
let browCooldown = 0;
const browCooldownFrames = 5;

// Histeresis para cejas (porcentajes relativos a baseline)
const RAISE_DELTA_UP = 0.08;
const RAISE_DELTA_DOWN = 0.05;
const BASELINE_ADAPT = 0.02;

// Ventana corta y ruido para robustez cejas
const BROW_BUFFER_SIZE   = 7;
const BROW_NOISE_K       = 2.2;
const BROW_MIN_ABS_DELTA = 0.006;
const BASELINE_WARMUP_FRAMES = 6;

// Detector de pendiente (impulsos breves)
const SLOPE_MIN_ABS   = 0.0028;
const SLOPE_NOISE_K   = 1.2;
const IMPULSE_OVERRIDE = 0.0035;

let browBuf = [];
let browWarmup = 0;
let prevBrowSmooth = null;
let riseFrames = 0;

// Utilidades
function pushAndTrim(arr, v, max) { arr.push(v); if (arr.length > max) arr.shift(); }
function median(a){ if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y); const m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function mad(a){ if(a.length<3) return 0; const m=median(a); const d=a.map(v=>Math.abs(v-m)); return 1.4826*median(d); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Métrica robusta: ceja–ojo normalizada por IPD
function browRaiseMetric(lm, ipd) {
  const leftEyeCenter  = { x: (lm[33].x + lm[133].x) / 2, y: (lm[33].y + lm[133].y) / 2 };
  const rightEyeCenter = { x: (lm[362].x + lm[263].x) / 2, y: (lm[362].y + lm[263].y) / 2 };
  const leftBrow  = lm[105];
  const rightBrow = lm[334];
  const leftDy  = (leftEyeCenter.y - leftBrow.y);
  const rightDy = (rightEyeCenter.y - rightBrow.y);
  return ((leftDy / (ipd || 1e-6)) + (rightDy / (ipd || 1e-6))) / 2;
}

// Lógica principal (ojos y boca quedan iguales)
function detectMovements(landmarks) {
  if (!landmarks || landmarks.length < 400) return;

  // --- Parpadeo (SIN CAMBIOS) ---
  const rightEyeDist = distance(landmarks[159], landmarks[145]);
  const leftEyeDist  = distance(landmarks[386], landmarks[374]);
  const eyesClosed   = rightEyeDist < 0.012 && leftEyeDist < 0.012;

  if (!prevEyesClosed && eyesClosed) {
    eyeCount++;
    browCooldown = browCooldownFrames;
  }
  prevEyesClosed = eyesClosed;

  // --- Boca (SIN CAMBIOS) ---
  const mouthDist = distance(landmarks[13], landmarks[14]);
  const mouthOpen = mouthDist > 0.03;
  if (!prevMouthOpen && mouthOpen) mouthCount++;
  prevMouthOpen = mouthOpen;

  // --- CEJAS (MEJORADO, seguro) ---
  const ipd = distance(landmarks[33], landmarks[263]);
  const browRaw = browRaiseMetric(landmarks, ipd);

  // Suavizado: EMA + mediana/MAD
  browEMA = (browEMA == null) ? browRaw : (BROW_EMA_ALPHA * browRaw + (1 - BROW_EMA_ALPHA) * browEMA);
  pushAndTrim(browBuf, browRaw, BROW_BUFFER_SIZE);
  const browMed   = median(browBuf);
  const browNoise = mad(browBuf);
  const browSmooth = (browEMA == null) ? browMed : 0.5 * browEMA + 0.5 * browMed;

  // Warmup baseline con rostro “neutro”
  if (browBaseline == null && !eyesClosed && !mouthOpen) {
    browWarmup++;
    if (browWarmup >= BASELINE_WARMUP_FRAMES) {
      browBaseline = browSmooth;
    }
  }

  // Umbrales con histéresis + ruido + delta absoluto
  let browsRaisedCandidate = false;
  let upper = NaN, lower = NaN;
  if (browBaseline != null) {
    const upByPct   = browBaseline * (1 + RAISE_DELTA_UP);
    const downByPct = browBaseline * (1 + RAISE_DELTA_DOWN);
    const upByAbs   = browBaseline + BROW_MIN_ABS_DELTA;
    const downByAbs = browBaseline + Math.min(BROW_MIN_ABS_DELTA * 0.6, BROW_MIN_ABS_DELTA);
    const upByNoise   = browBaseline + BROW_NOISE_K * browNoise;
    const downByNoise = browBaseline + Math.max(0.4 * BROW_NOISE_K * browNoise, 0);

    upper = Math.max(upByPct, upByAbs, upByNoise);
    lower = Math.max(downByPct, downByAbs, downByNoise);

    browsRaisedCandidate = prevBrowsRaised ? (browSmooth > lower) : (browSmooth > upper);
  }

  // Pendiente (impulso breve)
  const slope = (prevBrowSmooth == null) ? 0 : (browSmooth - prevBrowSmooth);
  const slopeGate = Math.max(SLOPE_MIN_ABS, SLOPE_NOISE_K * browNoise);
  const nearUpper = (browBaseline != null && !Number.isNaN(upper)) ? (browSmooth > (upper - 0.002)) : false;
  const strongImpulse = slope > slopeGate;

  if (!prevBrowsRaised && (browsRaisedCandidate || (strongImpulse && nearUpper))) {
    riseFrames++;
  } else if (!browsRaisedCandidate) {
    riseFrames = 0;
  }

  // Cooldown por parpadeo (con override si impulso claro)
  let browsRaised = browsRaisedCandidate;
  if (browCooldown > 0) {
    if (!(strongImpulse && (browBaseline != null && !Number.isNaN(upper) && browSmooth > (upper + IMPULSE_OVERRIDE)))) {
      browsRaised = false;
    }
    browCooldown--;
  }

  // Estabilidad mínima clásica O impulso breve
  const impulseMinFrames = 1;
  const impulseOk = riseFrames >= impulseMinFrames;

  if (!eyesClosed && ((browsRaised && (browStableFrames + 1 >= browMinFrames)) || impulseOk)) {
    if (!prevBrowsRaised) {
      browCount++;
      prevBrowsRaised = true;
      riseFrames = 0;
    }
    browStableFrames = Math.min(browStableFrames + 1, 10);
  } else {
    if (!browsRaised) {
      browStableFrames = 0;
      prevBrowsRaised = false;
    }
  }

  // Adaptación lenta de baseline solo cuando NO hay candidata ni impulso
  if (!browsRaised && !browsRaisedCandidate && !strongImpulse && browBaseline != null) {
    browBaseline = browBaseline + BASELINE_ADAPT * (browSmooth - browBaseline);
  }

  prevBrowSmooth = browSmooth;

  // Actualizar DOM
  document.getElementById("eyeCount").innerText = eyeCount;
  document.getElementById("mouthCount").innerText = mouthCount;
  document.getElementById("browCount").innerText = browCount;
}

