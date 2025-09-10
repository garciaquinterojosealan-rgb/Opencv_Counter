// Contadores
let eyeCount = 0, mouthCount = 0, browCount = 0;

// Estados previos
let prevEyesClosed = false, prevMouthOpen = false, prevBrowsRaised = false;

// Línea base para cejas
let browBaseline = null;

// Control de estabilidad cejas
let browStableFrames = 0; 
const browMinFrames = 3; // nº de frames que debe durar levantada para contar

// Cooldown tras parpadeo
let browCooldown = 0; 
const browCooldownFrames = 5; // nº de frames ignorados tras parpadear

// Función para calcular distancia entre dos puntos
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Función para detectar movimientos
function detectMovements(landmarks) {
  // --- Parpadeo ---
  const rightEyeDist = distance(landmarks[159], landmarks[145]);
  const leftEyeDist = distance(landmarks[386], landmarks[374]);
  const eyesClosed = rightEyeDist < 0.012 && leftEyeDist < 0.012;

  if (!prevEyesClosed && eyesClosed) {
    eyeCount++;
    browCooldown = browCooldownFrames; // iniciar cooldown cejas
  }
  prevEyesClosed = eyesClosed;

  // --- Boca ---
  const mouthDist = distance(landmarks[13], landmarks[14]);
  const mouthOpen = mouthDist > 0.03;
  if (!prevMouthOpen && mouthOpen) mouthCount++;
  prevMouthOpen = mouthOpen;

  // --- Cejas ---
  const faceHeight = distance(landmarks[10], landmarks[152]);
  const browRight = Math.abs(landmarks[65].y - landmarks[159].y) / faceHeight;
  const browLeft  = Math.abs(landmarks[295].y - landmarks[386].y) / faceHeight;
  const browAvg = (browRight + browLeft) / 2;

  // Inicializar línea base
  if (browBaseline === null) {
    browBaseline = browAvg;
  }

  let browsRaised = false;
  if (!eyesClosed && browCooldown === 0) {
    const sensitivityFactor = 1.25; 
    browsRaised = browAvg > browBaseline * sensitivityFactor;

    // Requiere estabilidad por varios frames
    if (browsRaised) {
      browStableFrames++;
      if (browStableFrames === browMinFrames) {
        browCount++;
      }
    } else {
      browStableFrames = 0;
    }
  }

  // Reducir cooldown si está activo
  if (browCooldown > 0) {
    browCooldown--;
  }

  prevBrowsRaised = browsRaised;

  // --- Actualizar en DOM ---
  document.getElementById("eyeCount").innerText = eyeCount;
  document.getElementById("mouthCount").innerText = mouthCount;
  document.getElementById("browCount").innerText = browCount;
}
