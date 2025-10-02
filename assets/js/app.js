// app.js
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Inicializar Face Mesh
const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});
faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

// Cada vez que haya detección
faceMesh.onResults((results) => {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];

    // Detecta y actualiza contadores (usa base + live)
    if (window.detectMovements) {
      window.detectMovements(landmarks);
    }

    // Dibujar puntos de cara
    ctx.fillStyle = 'red';
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 1, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();
});

// Inicializar cámara
const camera = new Camera(video, {
  onFrame: async () => {
    await faceMesh.send({ image: video });
  },
  width: 640,
  height: 480
});
camera.start();

// ===== Refrescar contadores del día (DOM) al inicio y cada minuto =====
(async function bootCounters(){
  if (!window.api) return;

  // 1) Pinta lo que venga de la API en el DOM como autoridad inicial (opcional)
  await window.api.refreshTodayCounters?.();

  // 2) Obtén los números crudos y pásalos a facemesh como base (offset del día)
  try {
    const base = await window.api.getTodayCounts();
    if (window.counters?.setBaseCounts) {
      window.counters.setBaseCounts(base);
    }
  } catch(e) {
    console.warn('getTodayCounts failed', e);
  }

  // 3) Cada minuto, refresca la base desde la BD sin tocar "live"
  setInterval(async () => {
    try {
      const latest = await window.api.getTodayCounts();
      if (window.counters?.setBaseCounts) {
        window.counters.setBaseCounts(latest);
      }
    } catch(e) { /* no-op */ }
  }, 60000);
})();

/* === PANEL: Último estatus y Últimos 5 === */

function renderLastCard(prefix, last, last5) {
  // prefix: "eye" | "brow" | "mouth"
  // last: {status, ts}, last5: Array<{status, ts}>
  const $lastStatus = document.getElementById(`${prefix}-last-status`);
  const $lastWhen   = document.getElementById(`${prefix}-last-when`);
  const $list       = document.getElementById(`${prefix}-last5`);

  if ($lastStatus) $lastStatus.textContent = last?.status ?? "N/A";
  if ($lastWhen)   $lastWhen.textContent   = (window.api?.fmtTS && last?.ts) ? window.api.fmtTS(last.ts) : (last?.ts || "");

  if ($list) {
    $list.innerHTML = "";
    (last5 || []).forEach((r, i) => {
      const li = document.createElement("li");
      li.textContent = `${i+1}. ${r.status}${r.ts ? " · " + (window.api?.fmtTS ? window.api.fmtTS(r.ts) : r.ts) : ""}`;
      $list.appendChild(li);
    });
    if (!last5 || last5.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Sin datos";
      $list.appendChild(li);
    }
  }
}

async function refreshLastPanels() {
  if (!window.api) return;
  try {
    const [
      eyeL,  eyeL5,
      browL, browL5,
      mouthL, mouthL5
    ] = await Promise.all([
      window.api.eyeLast(),   window.api.eyeLast5(),
      window.api.browLast(),  window.api.browLast5(),
      window.api.mouthLast(), window.api.mouthLast5(),
    ]);

    renderLastCard("eye",   eyeL,  eyeL5);
    renderLastCard("brow",  browL, browL5);
    renderLastCard("mouth", mouthL, mouthL5);
  } catch (e) {
    console.warn("refreshLastPanels:", e);
  }
}

// Llama una vez al cargar y luego cada 10 s
refreshLastPanels();
