/* assets/js/api.js
   API helper para Opencv_ContadorFacial:
   - Carga contadores del día (eyes/brows/mouth) desde /api/{eyes|brows|mouth}/count-by-day?from=YYYY-MM-DD 00:00:00&to=YYYY-MM-DD 23:59:59
   - Expone insertadores de eventos
   - Expone lectores de "último" y "últimos 5" (last, last5)
*/

// ===== Configuración de base URL (permite override desde localStorage) =====
const DEFAULT_API = "http://127.0.0.1:5000"; // Cambia si tu backend corre en otro host/puerto
function getApiBase() {
  return localStorage.getItem("API_BASE") || DEFAULT_API;
}
function setApiBase(url) {
  if (typeof url === "string" && url.trim()) {
    localStorage.setItem("API_BASE", url.trim());
  }
}

// ===== Helper genérico para GET JSON =====
async function getJSON(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

// ===== Rango de fechas para "hoy" en formato requerido por la API =====
function todayDayRange() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return {
    from: `${yyyy}-${mm}-${dd} 00:00:00`,
    to:   `${yyyy}-${mm}-${dd} 23:59:59`,
  };
}

// ===== Intérprete flexible de resultados { ok, data: [...] } =====
// Suma las columnas típicas de conteo si existen; si solo hay una numérica, la toma.
function sumLikelyCounts(rows) {
  if (!Array.isArray(rows)) return 0;
  const candidateKeys = [
    "count", "total", "total_registros", "total_blinks",
    "veces_levantadas", "aperturas", "aperturas_boca", "valor"
  ];
  return rows.reduce((acc, r) => {
    if (!r || typeof r !== "object") return acc;
    for (const k of candidateKeys) {
      if (typeof r[k] === "number") return acc + r[k];
    }
    const nums = Object.values(r).filter(v => typeof v === "number");
    if (nums.length === 1) return acc + nums[0];
    return acc;
  }, 0);
}

// ===== Llamadas específicas a cada recurso (conteo por día) =====
async function eyeToday() {
  const { from, to } = todayDayRange();
  const q = new URLSearchParams({ from, to }).toString();
  const API_BASE = getApiBase();
  const res = await getJSON(`${API_BASE}/api/eyes/count-by-day?${q}`);
  if (res && res.ok) return sumLikelyCounts(res.data);
  return 0;
}

async function browToday() {
  const { from, to } = todayDayRange();
  const q = new URLSearchParams({ from, to }).toString();
  const API_BASE = getApiBase();
  const res = await getJSON(`${API_BASE}/api/brows/count-by-day?${q}`);
  if (res && res.ok) return sumLikelyCounts(res.data);
  return 0;
}

async function mouthToday() {
  const { from, to } = todayDayRange();
  const q = new URLSearchParams({ from, to }).toString();
  const API_BASE = getApiBase();
  const res = await getJSON(`${API_BASE}/api/mouth/count-by-day?${q}`);
  if (res && res.ok) return sumLikelyCounts(res.data);
  return 0;
}

// ===== Refrescar contadores en el DOM (autoridad: BD de hoy) =====
// IDs esperados en tu index.html:
//   - Ojos  -> #eyeCount
//   - Cejas -> #browCount
//   - Boca  -> #mouthCount
async function refreshTodayCounters() {
  const $eye   = document.getElementById("eyeCount");
  const $brow  = document.getElementById("browCount");
  const $mouth = document.getElementById("mouthCount");

  if (!$eye && !$brow && !$mouth) return;

  if ($eye)   $eye.textContent = "...";
  if ($brow)  $brow.textContent = "...";
  if ($mouth) $mouth.textContent = "...";

  try {
    const [e, b, m] = await Promise.all([
      eyeToday().catch(() => 0),
      browToday().catch(() => 0),
      mouthToday().catch(() => 0),
    ]);
    if ($eye)   $eye.textContent = e;
    if ($brow)  $brow.textContent = b;
    if ($mouth) $mouth.textContent = m;
  } catch (err) {
    console.error("refreshTodayCounters error:", err);
    if ($eye)   $eye.textContent = "ERR";
    if ($brow)  $brow.textContent = "ERR";
    if ($mouth) $mouth.textContent = "ERR";
  }
}

/* ===== LAST / LAST5 ===== */

// Normaliza un renglón devuelto por la API a {status, ts}
function normalizeLastRow(row) {
  if (!row || typeof row !== "object") return { status: "N/A", ts: null };
  const statusKey = Object.keys(row).find(k => /^(status|estado|estatus|value|val)$/i.test(k)) || "status";
  const tsKey = Object.keys(row).find(k => /(ts|time|fecha|date|occurred_at|created_at)$/i.test(k)) || "ts";
  return { status: row[statusKey] ?? "N/A", ts: row[tsKey] ?? null };
}

async function getLast(resource) {
  const API_BASE = getApiBase();
  const res = await getJSON(`${API_BASE}/api/${resource}/last`);
  if (res && res.ok && res.data) return normalizeLastRow(res.data);
  return { status: "N/A", ts: null };
}

async function getLast5(resource) {
  const API_BASE = getApiBase();
  const res = await getJSON(`${API_BASE}/api/${resource}/last5`);
  if (res && res.ok && Array.isArray(res.data)) {
    return res.data.map(normalizeLastRow);
  }
  return [];
}

// Helper de formato de fecha simple
function fmtTS(ts) {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(); // formatea local
}

// ===== Exponer API mínima al global =====
window.api = {
  ...(window.api || {}),

  // Base URL
  getApiBase,
  setApiBase,

  // Contadores del día (DOM y crudo)
  refreshTodayCounters,
  async getTodayCounts() {
    const [e, b, m] = await Promise.all([
      eyeToday().catch(() => 0),
      browToday().catch(() => 0),
      mouthToday().catch(() => 0),
    ]);
    return { eyes: e || 0, brows: b || 0, mouth: m || 0 };
  },

  // Inserciones (ajusta rutas si difieren)
  async insertEye(status) {
    const API_BASE = getApiBase();
    try {
      await fetch(`${API_BASE}/api/eyes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
    } catch (e) {}
  },
  async insertMouth(status) {
    const API_BASE = getApiBase();
    try {
      await fetch(`${API_BASE}/api/mouth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
    } catch (e) {}
  },
  async insertBrow(status) {
    const API_BASE = getApiBase();
    try {
      await fetch(`${API_BASE}/api/brows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
    } catch (e) {}
  },

  // LAST / LAST5
  async eyeLast()   { return getLast("eyes"); },
  async browLast()  { return getLast("brows"); },
  async mouthLast() { return getLast("mouth"); },

  async eyeLast5()   { return getLast5("eyes"); },
  async browLast5()  { return getLast5("brows"); },
  async mouthLast5() { return getLast5("mouth"); },

  // util
  fmtTS,
};
