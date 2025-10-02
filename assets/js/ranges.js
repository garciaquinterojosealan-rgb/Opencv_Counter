/* assets/js/ranges.js (tolerante a claves de nombre)
   - Consulta /api/{eyes|brows|mouth}/count-range con fallback a /count-by-day.
   - No autorefresh; solo al pulsar el botón.
*/

(function () {
  const DEFAULT_API = "http://127.0.0.1:5000";
  const getApiBase = (typeof window.getApiBase === "function")
    ? window.getApiBase
    : () => (localStorage.getItem("API_BASE") || DEFAULT_API);

  async function getJSON(url) {
    if (typeof window.getJSON === "function") return window.getJSON(url);
    const res = await fetch(url, { method: "GET" });
    const txt = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status} - ${txt || res.statusText}`);
    try { return JSON.parse(txt); } catch { return { ok: false, error: "JSON inválido" }; }
  }

  // DOM
  const $from = document.getElementById("rangeFrom");
  const $to = document.getElementById("rangeTo");
  const $btn = document.getElementById("btnRangeQuery");

  const $eyes = document.getElementById("rangeEyes");
  const $brows = document.getElementById("rangeBrows");
  const $mouth = document.getElementById("rangeMouth");

  const $eyesDetail = document.getElementById("rangeEyesDetail");
  const $browsDetail = document.getElementById("rangeBrowsDetail");
  const $mouthDetail = document.getElementById("rangeMouthDetail");

  let $error = document.getElementById("rangeError");

  if (!$from || !$to || !$btn || !$eyes || !$brows || !$mouth) return;

  // Fechas
  function pad(n) { return String(n).padStart(2, "0"); }
  function toInputValue(dt) {
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }
  function inputToApi(val) {
    if (!val) return "";
    return val.replace("T", " ") + ":00";
  }
  function prefillToday() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    if (!$from.value) $from.value = toInputValue(start);
    if (!$to.value) $to.value = toInputValue(end);
  }

  // ---------- Normalización ----------
  function toArray(maybe) {
    if (Array.isArray(maybe)) return maybe;
    if (maybe && typeof maybe === "object") return [maybe];
    return [];
  }

  // Toma el nombre/etiqueta del renglón desde muchas posibles claves
  function getStatusLabel(row) {
    const candidates = [
      "status","STATUS","Status",
      "state","STATE","State",
      "label","Label","LABEL",
      "name","Name","NAME",
      "tipo","Tipo","TIPO",
      "kind","Kind","KIND",
      "category","Category","CATEGORY",
      "estado","Estado","ESTADO",
      "estatus","Estatus","ESTATUS",
      "clave","Clave","CLAVE",
      "key","Key","KEY",
      "value","Value","VALUE",
      "descripcion","Descripción","DESCRIPCIÓN","description","Description","DESCRIPTION",
      // por si viene en nested: row.meta?.name, etc. (ignorado aquí para mantener simple)
    ];
    for (const k of candidates) {
      if (row && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
        return String(row[k]).trim();
      }
    }
    return ""; // sin etiqueta -> lo contabilizamos en total
  }

  function normalizeRows(payload) {
    if (!payload) return [];
    const data = (payload.data !== undefined) ? payload.data
               : (payload.rows !== undefined) ? payload.rows
               : (payload.result !== undefined) ? payload.result
               : payload;

    if (data && typeof data === "object" && !Array.isArray(data)) {
      const arr = [];
      if (typeof data.total === "number") arr.push({ status: "", count: data.total });
      if (Array.isArray(data.by_status)) {
        data.by_status.forEach(x => arr.push({ status: getStatusLabel(x) || "", count: x.count ?? x.n ?? 0 }));
      }
      if (arr.length) return arr;
      if (typeof data.count === "number" || typeof data.n === "number") {
        return [{ status: "", count: (data.count ?? data.n ?? 0) }];
      }
    }
    return toArray(data).map(r => {
      const status = (r.status !== undefined) ? r.status : getStatusLabel(r);
      const count = (typeof r.count === "number") ? r.count
                  : (typeof r.n === "number") ? r.n
                  : 0;
      return { status: String(status || ""), count };
    });
  }

  function summarizeData(rows) {
    if (!Array.isArray(rows)) rows = [];
    let total = 0;
    const map = new Map();
    for (const r of rows) {
      const n = (typeof r.count === "number") ? r.count
              : (typeof r.n === "number") ? r.n
              : 0;
      const st = (r.status || "").toString();
      if (st) map.set(st, (map.get(st) || 0) + n);
      total += n;
    }
    const perStatus = Array.from(map.entries()).map(([status, n]) => ({ status, n }));
    return { total, perStatus };
  }

  function statusList(perStatus) {
    if (!perStatus || perStatus.length === 0) return "";
    return perStatus.map(s => `${s.status}: ${s.n}`).join(" • ");
  }

  function setNumber($el, val) { if ($el) $el.textContent = String(val); }
  function setDetail($el, text) { if ($el) $el.textContent = text || ""; }
  function showError(msg) {
    if (!$error) {
      $error = document.createElement("div");
      $error.id = "rangeError";
      $error.className = "alert alert-danger mt-3";
      const container = document.getElementById("rangos") || document.body;
      container.appendChild($error);
    }
    if (!msg) { $error.classList.add("d-none"); $error.textContent = ""; }
    else { $error.classList.remove("d-none"); $error.textContent = msg; }
  }

  // ---------- Fetch ----------
  async function hit(kind, endpoint, fromApi, toApi) {
    const base = getApiBase();
    const url = `${base}/api/${kind}/${endpoint}?from=${encodeURIComponent(fromApi)}&to=${encodeURIComponent(toApi)}`;
    const json = await getJSON(url);
    if (!json || json.ok === false) throw new Error(json?.error || json?.message || `Respuesta inválida (${endpoint})`);
    const rows = normalizeRows(json);
    return summarizeData(rows);
  }
  async function fetchRange(kind, fromApi, toApi) {
    try { return await hit(kind, "count-range", fromApi, toApi); }
    catch { return await hit(kind, "count-by-day", fromApi, toApi); }
  }

  // ---------- Acción ----------
  async function runQuery() {
    showError("");
    const fromApi = inputToApi($from.value);
    const toApi = inputToApi($to.value);
    if (!fromApi || !toApi) { showError("Selecciona un rango válido (desde y hasta)."); return; }

    $btn.disabled = true;
    const oldLabel = $btn.textContent;
    $btn.textContent = "Consultando...";

    try {
      const [eyesRes, browsRes, mouthRes] = await Promise.all([
        fetchRange("eyes", fromApi, toApi),
        fetchRange("brows", fromApi, toApi),
        fetchRange("mouth", fromApi, toApi),
      ]);

      setNumber($eyes, eyesRes.total);
      setDetail($eyesDetail, statusList(eyesRes.perStatus));

      setNumber($brows, browsRes.total);
      setDetail($browsDetail, statusList(browsRes.perStatus));

      setNumber($mouth, mouthRes.total);
      setDetail($mouthDetail, statusList(mouthRes.perStatus));
    } catch (err) {
      showError(err?.message || "Error al consultar rangos.");
    } finally {
      $btn.disabled = false;
      $btn.textContent = oldLabel;
    }
  }

  // ---------- Init ----------
  prefillToday();
  $btn.addEventListener("click", runQuery);
  // runQuery(); // opcional
})();
