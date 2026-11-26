
const firebaseConfig = {
  apiKey: "AIzaSyAuts9sbuV-MoZxKR44shz4sFzk0gDR8ig",
  authDomain: "logornegi-12cfb.firebaseapp.com",
  projectId: "logornegi-12cfb",
  storageBucket: "logornegi-12cfb.firebasestorage.app",
  messagingSenderId: "613328383024",
  appId: "1:613328383024:web:d0e859fabe1aa6cf6a11f5",
  measurementId: "G-KZ0WET10S8"
};

const FIREBASE_SDK_VERSION = "10.12.2";
const LOGS_COLLECTION = "logs";
const API_KEY_STORAGE = "gemini_api_key";
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.5-flash-lite"];

const VIEW_META = {
  overview: { title: "Genel Bakış", subtitle: "5651 & KVKK uyumlu güvenlik operasyon özeti" },
  logs: { title: "Log Kayıtları", subtitle: "Tüm kayıtlar, arama ve çoklu filtreleme" },
  ai: { title: "AI Analiz", subtitle: "Gemini ile 5651 & KVKK günlük yönetici özeti (BYOK)" },
  threats: { title: "Tehdit Durumu", subtitle: "CRITICAL ve HIGH seviyesindeki bekleyen tehditler" },
  compliance: { title: "Uyumluluk (KVKK)", subtitle: "5651 zaman damgası ve KVKK veri erişim denetimi" },
  settings: { title: "Ayarlar", subtitle: "API anahtarı yönetimi ve analist hesabı" }
};

const state = {
  logs: [],
  view: [],
  db: null,
  fb: null,
  auth: null,
  fbAuth: null,
  user: null,
  authReady: false,
  authFailed: false,
  authMode: "login",
  charts: { severity: null, daily: null, type: null },
  lastSync: null,
  currentView: "overview",
  pendingAiRun: false,
  aiReportText: "",
  filters: { query: "", severity: "ALL", status: "ALL", type: "ALL" }
};

const $ = (id) => document.getElementById(id);
function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    } catch (_) {
      return null;
    }
  }
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseTimestamp(value);
  if (!date) return escapeHtml(value || "-");
  return date.toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function formatClock(date) {
  return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isWithinLast24Hours(value) {
  const date = parseTimestamp(value);
  if (!date) return false;
  const diff = Date.now() - date.getTime();
  return diff >= -60000 && diff <= 24 * 60 * 60 * 1000;
}

const SEVERITIES = ["CRITICAL", "HIGH", "WARNING", "INFO"];

function normalizeSeverity(raw) {
  const value = String(raw || "").toUpperCase();
  return SEVERITIES.includes(value) ? value : "INFO";
}

function isResolvedLog(log) {
  const status = String(log.status || "").toLocaleLowerCase("tr");
  return status === "incelendi" || status === "i̇ncelendi";
}

function severityCounts() {
  const counts = { CRITICAL: 0, HIGH: 0, WARNING: 0, INFO: 0 };
  state.logs.forEach((log) => {
    const sev = normalizeSeverity(log.severity);
    counts[sev] += 1;
  });
  return counts;
}
function localTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const TOAST_ICONS = { success: "#i-check", error: "#i-alert", warning: "#i-alert", info: "#i-info" };

function toast(message, type = "info", title = "") {
  const stack = $("toastStack");
  if (!stack) return;

  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `
    <svg><use href="${TOAST_ICONS[type] || TOAST_ICONS.info}"/></svg>
    <div>${title ? `<strong>${escapeHtml(title)}</strong>` : ""}<span>${escapeHtml(message)}</span></div>
  `;
  stack.appendChild(node);

  setTimeout(() => {
    node.classList.add("hide");
    setTimeout(() => node.remove(), 220);
  }, 5200);
}

function setConnection(stateName, text) {
  const pill = $("connPill");
  const label = $("connPillText");
  const dbStatus = $("statusDb");

  if (pill) pill.className = `conn-pill ${stateName}`;
  if (label) label.textContent = text;

  const pretty = { online: "Bağlı", offline: "Hata", loading: "Bağlanıyor..." }[stateName] || text;
  if (dbStatus) dbStatus.textContent = pretty;
}

function updateStatusbar({ count } = {}) {
  if (count !== undefined) {
    const el = $("statusCount");
    if (el) el.textContent = count;
  }
  if (state.lastSync) {
    const el = $("statusSync");
    if (el) el.textContent = formatClock(state.lastSync);
  }
  const project = $("statusProject");
  if (project) project.textContent = firebaseConfig.projectId || "-";
  const syncUser = $("statusUser");
  if (syncUser) syncUser.textContent = state.user?.email || "-";
}

function switchView(name) {
  const target = VIEW_META[name] ? name : "overview";
  state.currentView = target;

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === target);
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.target === target);
  });

  const meta = VIEW_META[target];
  const title = $("pageTitle");
  const subtitle = $("pageSubtitle");
  if (title) title.textContent = meta.title;
  if (subtitle) subtitle.textContent = meta.subtitle;

  if (target === "overview") {
    requestAnimationFrame(() => {
      Object.values(state.charts).forEach((chart) => {
        if (chart && typeof chart.resize === "function") chart.resize();
      });
    });
  }

  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindNavigation() {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => switchView(link.dataset.target));
  });
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.goto));
  });
}

function openSidebar() {
  $("sidebar")?.classList.add("open");
  $("sidebarBackdrop")?.classList.add("open");
}

function closeSidebar() {
  $("sidebar")?.classList.remove("open");
  $("sidebarBackdrop")?.classList.remove("open");
}

let lastFocusedElement = null;

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  const focusTarget = modal.querySelector("input:not([type=hidden]), textarea, select") || modal.querySelector("button");
  if (focusTarget) setTimeout(() => focusTarget.focus(), 60);
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-backdrop.open")) document.body.style.overflow = "";
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
  state.pendingAiRun = false;
}

function closeAllModals() {
  document.querySelectorAll(".modal-backdrop.open").forEach((modal) => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
  document.body.style.overflow = "";
}

function bindModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      const modal = event.currentTarget.closest(".modal-backdrop");
      if (modal) closeModal(modal.id);
    });
  });


  document.querySelectorAll(".modal-backdrop").forEach((modal) => {
    modal.addEventListener("mousedown", (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.querySelector(".modal-backdrop.open")) {
      closeAllModals();
    }
    closeSidebar();
  });
}



function isFirebaseConfigured() {
  return ["apiKey", "projectId", "appId"].every((key) => {
    const value = typeof firebaseConfig[key] === "string" ? firebaseConfig[key].trim() : "";
    return value !== "" && !/^BURAYA/i.test(value);
  });
}

async function initFirebase() {
  if (state.db && state.fb && state.fbAuth) return;

  if (!isFirebaseConfigured()) {
    throw new Error("firebaseConfig eksik veya geçersiz. app.js içindeki yapılandırmayı kontrol edin.");
  }

  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [appMod, firestoreMod, authMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`)
  ]);

  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);

  state.fb = firestoreMod;
  state.db = firestoreMod.getFirestore(app);
  state.fbAuth = authMod;
  state.auth = authMod.getAuth(app);
}


const AUTH_ERRORS = {
  "auth/invalid-email": "E-posta adresi geçersiz görünüyor.",
  "auth/missing-password": "Lütfen parolanızı girin.",
  "auth/user-not-found": "Bu e-posta ile kayıtlı analist bulunamadı.",
  "auth/wrong-password": "Parola hatalı. Lütfen tekrar deneyin.",
  "auth/invalid-credential": "E-posta veya parola hatalı.",
  "auth/invalid-login-credentials": "E-posta veya parola hatalı.",
  "auth/email-already-in-use": "Bu e-posta ile zaten bir analist hesabı var. Giriş yapmayı deneyin.",
  "auth/weak-password": "Parola çok zayıf. En az 6 karakter kullanın.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı. Lütfen kısa bir süre sonra tekrar deneyin.",
  "auth/network-request-failed": "Ağ bağlantısı hatası. İnternet bağlantınızı kontrol edin.",
  "auth/user-disabled": "Bu analist hesabı devre dışı bırakılmış."
};

function authErrorMessage(error) {
  const code = String(error?.code || "").toLowerCase();
  if (AUTH_ERRORS[code]) return AUTH_ERRORS[code];

  if (code.includes("operation-not-allowed") || code.includes("configuration-not-found") || code.includes("admin-restricted-operation")) {
    return "Firebase Authentication bu projede etkin değil. Firebase Console → Authentication → " +
      "\"Başlarken\" → Sign-in method bölümünden Email/Password sağlayıcısını etkinleştirin.";
  }
  return error?.message || "Oturum işlemi tamamlanamadı.";
}

function firstLetter(value) {
  const text = String(value || "A").trim();
  return (text.charAt(0) || "A").toLocaleUpperCase("tr");
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  const isRegister = state.authMode === "register";

  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.authMode === state.authMode);
  });

  const title = $("authTitle");
  const subtitle = $("authSubtitle");
  const submitText = $("authSubmitText");
  const pw2Row = $("authPassword2Row");
  const pwInput = $("authPassword");

  if (title) title.textContent = isRegister ? "Analist Kaydı Oluştur" : "SOC Analist Girişi";
  if (subtitle) subtitle.textContent = isRegister
    ? "Kurumsal e-posta ile yeni bir analist hesabı oluşturun."
    : "Kurumsal e-posta adresinizle oturum açın.";
  if (submitText) submitText.textContent = isRegister ? "Kayıt Ol" : "Giriş Yap";
  pw2Row?.classList.toggle("hidden", !isRegister);
  if (pwInput) pwInput.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");

  showAuthError("");
}

function showAuthError(message) {
  const box = $("authError");
  if (!box) return;
  if (!message) {
    box.classList.remove("show");
    box.innerHTML = "";
    return;
  }
  box.classList.add("show");
  box.innerHTML = message;
}

function setAuthBusy(busy, label) {
  const btn = $("authSubmitBtn");
  const text = $("authSubmitText");
  if (!btn) return;
  btn.disabled = busy;
  if (text) text.textContent = busy ? label || "İşleniyor..." : (state.authMode === "register" ? "Kayıt Ol" : "Giriş Yap");
}


function showAuthScreen() {
  $("appShell")?.classList.add("hidden");
  $("authScreen")?.classList.remove("hidden");
}

function showApp() {
  $("authScreen")?.classList.add("hidden");
  $("appShell")?.classList.remove("hidden");
}

function renderSessionUser(user, demo = false) {
  const email = demo ? "demo@soc.local" : user?.email || "-";
  const uid = demo ? "demo-session" : user?.uid || "-";

  const emailEl = $("userEmail");
  const avatarEl = $("userAvatar");
  const roleEl = $("userRole");
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = firstLetter(email);
  if (roleEl) roleEl.textContent = demo ? "Demo Modu" : "SOC Analist";

  const sEmail = $("settingsEmail");
  const sAvatar = $("settingsAvatar");
  const sUid = $("settingsUid");
  const sSignIn = $("settingsSignIn");
  const sVerified = $("settingsVerified");
  const sProject = $("settingsProject");
  const sSdk = $("settingsSdk");

  if (sEmail) sEmail.textContent = email;
  if (sAvatar) sAvatar.textContent = firstLetter(email);
  if (sUid) sUid.textContent = `UID: ${uid}`;
  if (sSignIn) {
    const lastSignIn = user?.metadata?.lastSignInTime;
    sSignIn.textContent = lastSignIn ? new Date(lastSignIn).toLocaleString("tr-TR") : (demo ? "Demo oturumu" : "-");
  }function renderSessionUser(user) {
  const email = user?.email || "-";
  const uid = user?.uid || "-";

  const emailEl = $("userEmail");
  const avatarEl = $("userAvatar");
  const roleEl = $("userRole");
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = firstLetter(email);
  if (roleEl) roleEl.textContent = "SOC Analist";

  const sEmail = $("settingsEmail");
  const sAvatar = $("settingsAvatar");
  const sUid = $("settingsUid");
  const sSignIn = $("settingsSignIn");
  const sVerified = $("settingsVerified");
  const sProject = $("settingsProject");
  const sSdk = $("settingsSdk");

  if (sEmail) sEmail.textContent = email;
  if (sAvatar) sAvatar.textContent = firstLetter(email);
  if (sUid) sUid.textContent = `UID: ${uid}`;
  if (sSignIn) {
    const lastSignIn = user?.metadata?.lastSignInTime;
    sSignIn.textContent = lastSignIn ? new Date(lastSignIn).toLocaleString("tr-TR") : "-";
  }
  if (sVerified) sVerified.textContent = user?.emailVerified ? "Doğrulandı" : "Doğrulanmadı";
  if (sProject) sProject.textContent = firebaseConfig.projectId || "-";
  if (sSdk) sSdk.textContent = `v${FIREBASE_SDK_VERSION}`;

  updateStatusbar();
}

}
async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.fbAuth || !state.auth) {
    showAuthError("Firebase Authentication başlatılamadı. Sayfayı yenileyip tekrar deneyin.");
    return;
  }

  const email = ($("authEmail")?.value || "").trim();
  const password = $("authPassword")?.value || "";
  const password2 = $("authPassword2")?.value || "";

  if (!email || !password) {
    showAuthError("E-posta ve parola zorunludur.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAuthError(AUTH_ERRORS["auth/invalid-email"]);
    return;
  }
  if (state.authMode === "register") {
    if (password.length < 6) {
      showAuthError(AUTH_ERRORS["auth/weak-password"]);
      return;
    }
    if (password !== password2) {
      showAuthError("Girdiğiniz parolalar birbiriyle eşleşmiyor.");
      return;
    }
  }

  const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = state.fbAuth;
  setAuthBusy(true, state.authMode === "register" ? "Hesap oluşturuluyor..." : "Giriş yapılıyor...");
  showAuthError("");

  try {
    const credential = state.authMode === "register"
      ? await createUserWithEmailAndPassword(state.auth, email, password)
      : await signInWithEmailAndPassword(state.auth, email, password);

    toast(`${credential.user.email} olarak oturum açıldı.`, "success", "Giriş başarılı");
 } catch (error) {
    console.error("Auth hatası:", error);
    const message = authErrorMessage(error);
    showAuthError(`<strong>Oturum açılamadı</strong>${escapeHtml(message)}`);
  } finally {
    setAuthBusy(false);
  }
}

async function handleLogout() {
  try {
    if (state.fbAuth && state.auth && state.user) {
      await state.fbAuth.signOut(state.auth);
    }
  } catch (error) {
    console.error("Çıkış hatası:", error);
  }
  state.user = null;

  state.logs = [];
  state.view = [];
  Object.keys(state.charts).forEach((key) => {
    if (state.charts[key] && typeof state.charts[key].destroy === "function") {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  });

  showAuthScreen();
  setConnection("loading", "Bağlanıyor...");
  toast("Oturum kapatıldı.", "info", "Çıkış yapıldı");
}

async function initAuth() {
  try {
    await initFirebase();
  } catch (error) {
    console.error("Firebase başlatma hatası:", error);
    showAuthScreen();
    state.authReady = true;
    state.authFailed = true;
    showAuthError(`<strong>Firebase başlatılamadı</strong>${escapeHtml(error.message)}`);
    return;
  }

  const { onAuthStateChanged } = state.fbAuth;

  const authTimeout = setTimeout(() => {
    if (state.authReady) return;
    state.authReady = true;
    state.authFailed = true;
    showAuthScreen();
    showAuthError(
      "<strong>Oturum durumu alınamadı</strong>Firebase Authentication bu projede etkin olmayabilir. " +
      "Firebase Console → Authentication → Sign-in method bölümünden Email/Password sağlayıcısını etkinleştirin."
    );
  }, 6000);
 
  onAuthStateChanged(state.auth, (user) => {
    clearTimeout(authTimeout);
    state.authReady = true;
    state.user = user || null;

   if (user) {
      renderSessionUser(user);
      showApp();
      loadLogs();
      return;
    }

    renderSessionUser(null);
    showAuthScreen();
  }, (error) => {
    clearTimeout(authTimeout);
    console.error("Oturum dinleme hatası:", error);
    state.authReady = true;
    showAuthScreen();
    showAuthError(`<strong>Oturum hatası</strong>${escapeHtml(authErrorMessage(error))}`);
  });
}


async function ensureFirestore() {
  if (!state.db || !state.fb) await initFirebase();
}

async function fetchLogs() {
  await ensureFirestore();
  const { collection, query, orderBy, getDocs } = state.fb;
  const snapshot = await getDocs(query(collection(state.db, LOGS_COLLECTION), orderBy("timestamp", "desc")));
  return snapshot.docs.map((docSnap) => ({ ...(docSnap.data() || {}), id: docSnap.id }));
}


async function loadLogs({ silent = false } = {}) {
  if (!silent) {
    setConnection("loading", "Bağlanıyor...");
    ["logTbody", "recentTbody"].forEach((id) => {
      const tbody = $(id);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><span class="spinner"></span><p>Firestore kayıtları yükleniyor...</p></div></td></tr>`;
      }
    });
  }

try {
    await ensureFirestore();
    state.logs = await fetchLogs();
    state.lastSync = new Date();

    renderAll();
    setConnection("online", `Canlı • ${state.logs.length} kayıt`);
    updateStatusbar({ count: state.logs.length });

    if (!silent) {
      toast(`${state.logs.length} kayıt Firestore'dan yüklendi.`, "success", "Firestore bağlı");
    }
  } catch (error) {
    console.error("Firestore yükleme hatası:", error);
    state.logs = [];
    state.view = [];
    renderAll();
    setConnection("offline", "Bağlantı hatası");
    updateStatusbar({ count: 0 });

    const detail = `${escapeHtml(error.message)}<br><small>Firebase proje ayarlarını, Firestore güvenlik kurallarını ve oturum yetkilerini kontrol edin.</small>`;
    ["logTbody", "recentTbody"].forEach((id) => {
      const tbody = $(id);
      if (!tbody) return;
      tbody.innerHTML = `
        <tr><td colspan="9">
          <div class="empty-state">
            <svg><use href="#i-alert"/></svg>
            <h3>Firestore bağlantısı kurulamadı</h3>
            <p>${detail}</p>
          </div>
        </td></tr>`;
    });
    toast(error.message, "error", "Bağlantı hatası");
  }
}


async function markLogResolved(id) {
  await ensureFirestore();
  const { doc, updateDoc } = state.fb;
  await updateDoc(doc(state.db, LOGS_COLLECTION, String(id)), { status: "İncelendi" });
}

async function deleteLogRecord(id) {
  await ensureFirestore();
  const { doc, deleteDoc } = state.fb;
  await deleteDoc(doc(state.db, LOGS_COLLECTION, String(id)));
}


const ACTION_CLASSES = {
  ALLOW: "allow",
  BLOCK: "block",
  ALERT: "alert",
  FAILED_LOGIN: "failed-login"
};

function actionBadge(action) {
  const label = String(action || "N/A").toUpperCase();
  const cls = ACTION_CLASSES[label] || "other";
  return `<span class="badge-action ${cls}">${escapeHtml(label)}</span>`;
}

function severityBadge(log) {
  const sev = normalizeSeverity(log.severity);
  return `<span class="tag ${sev.toLowerCase()}">${escapeHtml(sev)}</span>`;
}

function statusBadge(log) {
  return isResolvedLog(log)
    ? `<span class="tag resolved">İncelendi</span>`
    : `<span class="tag info">Aktif</span>`;
}


function ipCell(log) {
  const source = String(log.source_ip || "").trim();
  const dest = String(log.destination_ip || "").trim();

  const sourceHtml = source
    ? `<span class="ip">${escapeHtml(source)}</span>`
    : `<span class="ip-empty">-</span>`;

  if (!dest) return `<span class="ip-cell">${sourceHtml}</span>`;

  return `<span class="ip-cell">${sourceHtml}<span class="ip-arrow">→</span><span class="ip dest">${escapeHtml(dest)}</span></span>`;
}


function renderKPIs() {
  const total = state.logs.length;
  const last24 = state.logs.filter((log) => isWithinLast24Hours(log.timestamp)).length;
  const threat = state.logs.filter((log) => {
    const sev = normalizeSeverity(log.severity);
    return !isResolvedLog(log) && (sev === "CRITICAL" || sev === "HIGH") && isWithinLast24Hours(log.timestamp);
  }).length;
  const resolved = state.logs.filter(isResolvedLog).length;
  const pending = Math.max(0, total - resolved);

  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };
  set("kpiTotal", total);
  set("kpiLast24", last24);
  set("kpiThreat", threat);
  set("kpiResolved", resolved);
  set("kpiPending", pending);

  const hint = $("kpiTotalHint");
  if (hint) hint.innerHTML = `Firestore <span class="mono">${escapeHtml(firebaseConfig.projectId)}/logs</span>`;

  const info = $("logSectionInfo");
  if (info) info.textContent = `Toplam ${total} kayıt • ${state.view.length} kayıt listeleniyor`;

  const badge = $("navThreatCount");
  if (badge) badge.textContent = String(threat);
}

function ensureChartDefaults() {
  if (typeof Chart === "undefined") return false;
  Chart.defaults.color = "#93a4c0";
  Chart.defaults.font.family = '"Segoe UI", Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = "rgba(34, 48, 74, 0.65)";
  return true;
}

function tooltipBase() {
  return {
    backgroundColor: "#0b1422",
    borderColor: "#22304a",
    borderWidth: 1,
    padding: 10,
    titleColor: "#e8eefb",
    bodyColor: "#93a4c0"
  };
}

function renderSeverityChart() {
  const canvas = $("chartSeverity");
  if (!canvas || !ensureChartDefaults()) return;

 const counts = severityCounts();
  const labels = ["CRITICAL", "HIGH", "WARNING", "INFO"];
  const data = labels.map((label) => counts[label] || 0);
  const palette = { CRITICAL: "#f43f5e", HIGH: "#fb923c", WARNING: "#facc15", INFO: "#38bdf8" };

  if (!state.charts.severity) {
    state.charts.severity = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          label: "Kayıt",
          data,
          backgroundColor: labels.map((label) => palette[label]),
          borderColor: "#0b1422",
          borderWidth: 3,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, padding: 12, usePointStyle: true, pointStyle: "circle" } },
          tooltip: tooltipBase()
        }
      }
    });
    return;
  }

  state.charts.severity.data.datasets[0].data = data;
  state.charts.severity.update();
}

function renderDailyChart() {
  const canvas = $("chartDaily");
  if (!canvas || !ensureChartDefaults()) return;

  const counts = state.logs.reduce((acc, log) => {
    const date = parseTimestamp(log.timestamp);
    if (!date) return acc;
    const key = date.toISOString().slice(0, 10);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const labels = Object.keys(counts).sort();
  const data = labels.map((key) => counts[key]);

  if (!state.charts.daily) {
    state.charts.daily = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Olay sayısı",
          data,
          backgroundColor: "rgba(56, 189, 248, 0.55)",
          hoverBackgroundColor: "rgba(56, 189, 248, 0.85)",
          borderColor: "#38bdf8",
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 38
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipBase(), callbacks: { label: (ctx) => ` ${ctx.parsed.y} olay` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: "rgba(34, 48, 74, 0.45)" } }
        }
      }
    });
    return;
  }

  state.charts.daily.data.labels = labels;
  state.charts.daily.data.datasets[0].data = data;
  state.charts.daily.update();
}

function renderTypeChart() {
  const canvas = $("chartType");
  if (!canvas || !ensureChartDefaults()) return;

  const counts = state.logs.reduce((acc, log) => {
    const key = log.log_type || "BILINMEYEN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const data = labels.map((key) => counts[key]);

  if (!state.charts.type) {
    state.charts.type = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Kayıt",
          data,
          backgroundColor: "rgba(167, 139, 250, 0.55)",
          hoverBackgroundColor: "rgba(167, 139, 250, 0.85)",
          borderColor: "#a78bfa",
          borderWidth: 1,
          borderRadius: 6,
          maxBarThickness: 26
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipBase(), callbacks: { label: (ctx) => ` ${ctx.parsed.x} kayıt` } }
        },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: "rgba(34, 48, 74, 0.45)" } },
          y: { grid: { display: false } }
        }
      }
    });
    return;
  }

  state.charts.type.data.labels = labels;
  state.charts.type.data.datasets[0].data = data;
  state.charts.type.update();
}



function applyFilters() {
  const { query, severity, status, type } = state.filters;
  const needle = query.trim().toLowerCase();

  state.view = state.logs.filter((log) => {
    if (needle) {
      const haystack = [
        log.user, log.source_ip, log.destination_ip, log.details,
        log.log_type, log.action, log.mac_address
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      if (!haystack.includes(needle)) return false;
    }

  if (severity !== "ALL") {
      const sev = normalizeSeverity(log.severity);
      if (sev !== severity) return false;
    }

    if (status !== "ALL") {
      const resolved = isResolvedLog(log);
      if (status === "RESOLVED" && !resolved) return false;
      if (status === "PENDING" && resolved) return false;
    }

    if (type !== "ALL" && String(log.log_type || "") !== type) return false;

    return true;
  });

  const info = $("filterInfo");
  const active = Boolean(needle) || severity !== "ALL" || status !== "ALL" || type !== "ALL";
  if (info) {
    info.classList.toggle("show", active);
    info.innerHTML = active
      ? `🔍 <b>Filtre aktif:</b> toplam <b>${state.logs.length}</b> kayıttan <b>${state.view.length}</b> kayıt gösteriliyor.`
      : "";
  }
}

function renderTable() {
  const tbody = $("logTbody");
  if (!tbody) return;

  if (!state.logs.length) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <svg><use href="#i-inbox"/></svg>
          <h3>Henüz log kaydı yok</h3>
          <p>Firestore <span class="mono">logs</span> koleksiyonu boş. “Yeni Log” butonuyla ilk kaydı oluşturabilirsiniz.</p>
        </div>
      </td></tr>`;
    return;
  }

  if (!state.view.length) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <svg><use href="#i-search"/></svg>
          <h3>Eşleşen kayıt bulunamadı</h3>
          <p>Arama terimini veya seçili filtreleri değiştirmeyi deneyin.</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = state.view.map((log) => {
    const id = escapeHtml(log.id);
    const resolved = isResolvedLog(log);
    return `
      <tr>
        <td class="cell-time">${formatDateTime(log.timestamp)}</td>
        <td><span class="tag type">${escapeHtml(log.log_type || "-")}</span></td>
        <td class="cell-user">${escapeHtml(log.user || "-")}</td>
        <td>${actionBadge(log.action)}</td>
        <td>${ipCell(log)}</td>
        <td>${severityBadge(log)}</td>
        <td>${statusBadge(log)}</td>
        <td class="cell-details">${escapeHtml(log.details || "-")}</td>
        <td class="cell-actions">
          <span class="row-actions">
            ${resolved
              ? `<span class="tag resolved">✓ Onaylandı</span>`
              : `<button class="btn btn-sm btn-ok" type="button" data-action="resolve" data-id="${id}" title="İncelendi olarak işaretle">
                   <svg><use href="#i-check"/></svg> İncelendi
                 </button>`}
            <button class="btn btn-sm btn-danger" type="button" data-action="delete" data-id="${id}" title="Kaydı sil" aria-label="Kaydı sil">
              <svg><use href="#i-trash"/></svg>
            </button>
          </span>
        </td>
      </tr>`;
  }).join("");
}


function renderRecent() {
  const tbody = $("recentTbody");
  if (!tbody) return;

  const prioritized = [...state.logs].sort((a, b) => {
    const rank = (log) => {
      const sev = normalizeSeverity(log.severity);
      if (isResolvedLog(log)) return 3;
      if (sev === "CRITICAL") return 0;
      if (sev === "HIGH") return 1;
      return 2;
    };
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    const da = parseTimestamp(a.timestamp)?.getTime() || 0;
    const dbTime = parseTimestamp(b.timestamp)?.getTime() || 0;
    return dbTime - da;
  }).slice(0, 5);

  if (!prioritized.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Gösterilecek kayıt bulunmuyor.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = prioritized.map((log) => `
    <tr>
      <td class="cell-time">${formatDateTime(log.timestamp)}</td>
      <td><span class="tag type">${escapeHtml(log.log_type || "-")}</span></td>
      <td class="cell-user">${escapeHtml(log.user || "-")}</td>
      <td>${actionBadge(log.action)}</td>
      <td>${ipCell(log)}</td>
      <td>${severityBadge(log)}</td>
      <td class="cell-details">${escapeHtml(log.details || "-")}</td>
    </tr>`).join("");
}


function pendingThreats() {
  return state.logs.filter((log) => {
    const sev = normalizeSeverity(log.severity);
    return !isResolvedLog(log) && (sev === "CRITICAL" || sev === "HIGH");
  });
}

function renderThreats() {
  const threats = pendingThreats();
  const critical = threats.filter((log) => normalizeSeverity(log.severity) === "CRITICAL").length;
  const high = threats.length - critical;
  const resolvedThreats = state.logs.filter((log) => {
    const sev = normalizeSeverity(log.severity);
    return isResolvedLog(log) && (sev === "RESOLVED" || sev === "CRITICAL" || sev === "HIGH");
  }).length;

  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };
  set("threatCritical", critical);
  set("threatHigh", high);
  set("threatTotal", threats.length);
  set("threatResolved", resolvedThreats);

  const list = $("threatList");
  if (!list) return;

  if (!threats.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg><use href="#i-shield"/></svg>
        <h3>Açık kritik tehdit yok</h3>
        <p>CRITICAL veya HIGH seviyesinde bekleyen kayıt bulunmuyor. Tüm yüksek öncelikli olaylar incelenmiş görünüyor.</p>
      </div>`;
    return;
  }

  list.innerHTML = threats.map((log) => {
    const sev = normalizeSeverity(log.severity);
    const id = escapeHtml(log.id);
    return `
      <article class="threat-item ${sev.toLowerCase()}">
        <span class="threat-icon"><svg><use href="#i-alert"/></svg></span>
        <div class="threat-main">
          <strong>${escapeHtml(log.details || "Açıklama bulunmuyor")}</strong>
          <div class="threat-meta">
            <span class="tag ${sev.toLowerCase()}">${escapeHtml(sev)}</span>
            <span>${escapeHtml(log.log_type || "-")}</span>
            <span>${escapeHtml(log.user || "-")}</span>
            <span>${formatDateTime(log.timestamp)}</span>
            <span>${ipCell(log)}</span>
          </div>
        </div>
        <div class="threat-actions">
          <button class="btn btn-sm btn-ok" type="button" data-action="resolve" data-id="${id}">
            <svg><use href="#i-check"/></svg> İncelendi
          </button>
          <button class="btn btn-sm btn-danger" type="button" data-action="delete" data-id="${id}" aria-label="Kaydı sil">
            <svg><use href="#i-trash"/></svg>
          </button>
        </div>
      </article>`;
  }).join("");
}


function renderCompliance() {
  const total = state.logs.length;
  const withTimestamp = state.logs.filter((log) => parseTimestamp(log.timestamp)).length;
  const kvkkLogs = state.logs.filter((log) => String(log.log_type || "").startsWith("KVKK"));
  const dlpAlerts = state.logs.filter((log) =>
    String(log.log_type || "") === "KVKK_DLP" && String(log.action || "").toUpperCase() === "ALERT"
  );
  const resolved = state.logs.filter(isResolvedLog).length;

  const tsRate = total ? Math.round((withTimestamp / total) * 100) : 0;
  const resolveRate = total ? Math.round((resolved / total) * 100) : 0;

  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };
  set("cmpTimestamp", `${tsRate}%`);
  set("cmpKvkk", kvkkLogs.length);
  set("cmpDlp", dlpAlerts.length);
  set("cmpRate", `${resolveRate}%`);

  const checklist = $("complianceChecklist");
  if (checklist) {
    const items = [
      {
        status: total > 0 && tsRate === 100 ? "pass" : total === 0 ? "warn" : "fail",
        title: "5651 — Zaman damgası bütünlüğü",
        text: total === 0
          ? "Değerlendirme için kayıt bulunmuyor."
          : `${withTimestamp}/${total} kayıtta geçerli timestamp mevcut (${tsRate}%).`
      },
      {
        status: kvkkLogs.length > 0 ? "pass" : "warn",
        title: "KVKK — Veri erişim kayıtları",
        text: kvkkLogs.length > 0
          ? `${kvkkLogs.length} KVKK kapsamlı erişim/DLP kaydı tutuluyor.`
          : "KVKK kapsamında erişim kaydı bulunamadı."
      },
      {
        status: dlpAlerts.length === 0 ? "pass" : "warn",
        title: "KVKK — Veri dışa aktarma alarmı",
        text: dlpAlerts.length === 0
          ? "Bekleyen veri dışa aktarma alarmı yok."
          : `${dlpAlerts.length} DLP alarmı inceleme bekliyor.`
      },
      {
        status: resolveRate >= 70 ? "pass" : resolveRate >= 40 ? "warn" : "fail",
        title: "Olay müdahale oranı",
        text: `İncelenme oranı ${resolveRate}% (${resolved}/${total}). Hedef: %70 ve üzeri.`
      },
      {
        status: pendingThreats().length === 0 ? "pass" : "warn",
        title: "Açık kritik tehdit kontrolü",
        text: pendingThreats().length === 0
          ? "CRITICAL/HIGH bekleyen tehdit yok."
          : `${pendingThreats().length} adet yüksek öncelikli olay müdahale bekliyor.`
      }
    ];

    const iconOf = (status) => (status === "pass" ? "#i-check" : status === "fail" ? "#i-close" : "#i-info");

    checklist.innerHTML = items.map((item) => `
      <li class="${item.status}">
        <span class="check-icon"><svg><use href="${iconOf(item.status)}"/></svg></span>
        <span><strong>${escapeHtml(item.title)}</strong>${escapeHtml(item.text)}</span>
      </li>`).join("");
  }

  
  const tbody = $("kvkkTbody");
  if (tbody) {
    const recent = kvkkLogs.slice(0, 6);
    tbody.innerHTML = recent.length
      ? recent.map((log) => `
          <tr>
            <td class="cell-time">${formatDateTime(log.timestamp)}</td>
            <td class="cell-user">${escapeHtml(log.user || "-")}</td>
            <td>${actionBadge(log.action)}</td>
            <td>${severityBadge(log)}</td>
          </tr>`).join("")
      : `<tr><td colspan="4"><div class="empty-state"><p>KVKK kapsamında kayıt bulunmuyor.</p></div></td></tr>`;
  }
}


function renderAiScope() {
  const counts = severityCounts();
  const pending = state.logs.filter((log) => !isResolvedLog(log)).length;
  const latest = state.logs[0];
  const set = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };

  set("scopeTotal", state.logs.length);
  set("scopeThreats", counts.CRITICAL + counts.HIGH);
  set("scopePending", pending);
  set("scopeLatest", latest ? formatDateTime(latest.timestamp) : "-");
}

function renderAll() {
  applyFilters();
  renderKPIs();
  renderSeverityChart();
  renderDailyChart();
  renderTypeChart();
  renderTable();
  renderRecent();
  renderThreats();
  renderCompliance();
  renderAiScope();
  updateStatusbar({ count: state.logs.length });
}


function getApiKey() {
  try {
    const key = localStorage.getItem(API_KEY_STORAGE);
    return key ? key.trim() : "";
  } catch (error) {
    console.warn("API anahtarı okunamadı:", error);
    return "";
  }
}

function saveApiKey(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  try {
    localStorage.setItem(API_KEY_STORAGE, clean);
    return clean;
  } catch (error) {
    console.warn("API anahtarı kaydedilemedi:", error);
    return "";
  }
}

function clearApiKey() {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch (error) {
    console.warn("API anahtarı silinemedi:", error);
  }
}

function maskedKey(key) {
  return key ? `${key.slice(0, 5)}...${key.slice(-4)}` : "";
}

function updateKeyState() {
  const key = getApiKey();
  const stateBox = $("aiKeyState");
  const modalHint = $("apiKeyHint");
  const settingsHint = $("settingsKeyHint");

  if (stateBox) {
    stateBox.className = key ? "key-state saved" : "key-state";
    stateBox.innerHTML = `<span class="dot"></span> ${key ? `API anahtarı kayıtlı (${escapeHtml(maskedKey(key))})` : "API anahtarı tanımlı değil"}`;
  }
  if (modalHint) modalHint.textContent = key ? `Kayıtlı anahtar: ${maskedKey(key)}` : "Kayıtlı anahtar yok.";
  if (settingsHint) settingsHint.textContent = key ? `Kayıtlı anahtar: ${maskedKey(key)}` : "Kayıtlı anahtar yok.";
}

function persistKeyFromInput(inputId) {
  const input = $(inputId);
  const saved = saveApiKey(input ? input.value : "");
  if (!saved) {
    toast("Anahtar boş olamaz. Geçerli bir Gemini API anahtarı girin.", "warning", "Kaydedilemedi");
    return false;
  }
  if (input) input.value = "";
  updateKeyState();
  return true;
}

function handleSaveKey() {
  if (!persistKeyFromInput("apiKeyInput")) return;

  const shouldResume = state.pendingAiRun;
  closeModal("keyModal");
  toast("API anahtarı bu tarayıcı için kaydedildi.", "success", "Anahtar kaydedildi");

  if (shouldResume) generateAiSummary();
}

function handleSaveKeyFromSettings() {
  if (!persistKeyFromInput("settingsKeyInput")) return;
  toast("API anahtarı bu tarayıcı için kaydedildi.", "success", "Anahtar kaydedildi");
}

function handleClearKey() {
  clearApiKey();
  updateKeyState();
  ["apiKeyInput", "settingsKeyInput"].forEach((id) => {
    const input = $(id);
    if (input) input.value = "";
  });
  closeModal("keyModal");
  toast("Kayıtlı API anahtarı silindi.", "info", "Anahtar silindi");
}

function isInvalidKeyError(status, error) {
  if (status === 400 || status === 401 || status === 403) return true;
  const text = `${(error && error.status) || ""} ${(error && error.message) || ""} ${
    error && error.details ? JSON.stringify(error.details) : ""
  }`;
  return /API_KEY_INVALID|API_KEY_EXPIRED|API key not valid/i.test(text);
}

function renderMarkdown(text) {
  const lines = escapeHtml(text).split("\n");
  let html = "";
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  const bold = (value) => value.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      closeList();
      html += `<h4>${bold(heading[1])}</h4>`;
      continue;
    }

    const item = line.match(/^[-*•]\s+(.*)$/);
    if (item) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${bold(item[1])}</li>`;
      continue;
    }

    closeList();
    html += `<p>${bold(line)}</p>`;
  }

  closeList();
  return html;
}

function aiBusy(message) {
  const output = $("aiOutput");
  if (!output) return;
  output.classList.add("show");
  $("aiPlaceholder")?.classList.add("hidden");
  output.innerHTML = `<span class="ai-loading"><span class="spinner"></span> ${escapeHtml(message)}</span>`;
}

function aiError(title, message) {
  const output = $("aiOutput");
  if (!output) return;
  output.classList.add("show");
  $("aiPlaceholder")?.classList.add("hidden");
  output.innerHTML = `<div class="ai-error"><strong>${escapeHtml(title)}</strong><br>${escapeHtml(message)}</div>`;
  const copyBtn = $("copyReportBtn");
  if (copyBtn) copyBtn.disabled = true;
}


async function generateAiSummary() {
  const apiKey = getApiKey();

  if (!apiKey) {
    state.pendingAiRun = true;
    aiBusy("API anahtarı bekleniyor. Lütfen anahtarınızı girin...");
    openModal("keyModal");
    return;
  }

  if (!state.logs.length) {
    aiError("Analiz edilecek kayıt yok", "Firestore'da log kaydı bulunamadı.");
    return;
  }

  const counts = severityCounts();
  const recent = state.logs.slice(0, 60);
  const scope = `Toplam kayıt: ${state.logs.length}
CRITICAL: ${counts.CRITICAL}, HIGH: ${counts.HIGH}, WARNING: ${counts.WARNING}, INFO: ${counts.INFO}, RESOLVED: ${counts.RESOLVED}`;

const promptText = `Sen kıdemli bir Siber Güvenlik Operasyon Merkezi (SOC) Analisti ve 5651 / KVKK Uyum Danışmanısın. Aşağıdaki anonimleştirilmiş sistem ve güvenlik loglarını teknik derinlikle analiz et ve Türkçe olarak kapsamlı bir Yönetici Güvenlik Raporu hazırla.

Raporu şu 4 başlık altında yapılandır:
1. GENEL RİSK DURUMU VE ÖZET: Toplam olay sayısı, kritik/yüksek tehdit yoğunluğu ve sistemin genel güvenlik skoru değerlendirmesi.
2. KRİTİK VE YÜKSEK SEVİYELİ OLAYLARIN TEKNİK ANALİZİ: Yetki yükseltme (sudo/su) denemeleri, kullanıcı hesabı değişiklikleri ve şüpheli erişimleri; kaynak/hedef IP, kullanıcı adı ve zaman damgası korelasyonuyla tek tek açıkla.
3. 5651 SAYILI KANUN VE KVKK MEVZUATI DEĞERLENDİRMESİ: Log bütünlüğü (SHA-256), yetkisiz erişim girişimlerinin kişisel veri güvenliğine etkisi ve KVKK 72 saatlik ihlal bildirimi gerekliliği açısından hukuki risk analizi.
4. ÖNCELİKLİ TEKNİK VE İDARİ AKSİYON PLANI: Sistem yöneticilerinin hemen uygulaması gereken somut sıkılaştırma (hardening), erişim kısıtlama ve izleme adımları.

Analiz Edilecek Log Kayıtları:

${scope}

Log Kayıtları (en yeni ${recent.length} kayıt):
${JSON.stringify(recent)}`;

  aiBusy("Model log kayıtlarını inceliyor...");
  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      aiBusy(`${model} verileri inceliyor...`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
       body: JSON.stringify({
  contents: [{ parts: [{ text: promptText }] }],
  generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 4096
  }
})
        }
      );

      const data = await response.json().catch(() => ({}));

      if (isInvalidKeyError(response.status, data.error)) {
        clearApiKey();
        updateKeyState();
        aiError(
          "Geçersiz API anahtarı",
          `Anahtarınız reddedildi (HTTP ${response.status}). ${data?.error?.message || ""} ` +
          "Hatalı anahtar tarayıcıdan silindi; lütfen Ayarlar veya API Anahtarı bölümünden geçerli bir anahtar girin."
        );
        toast("Gemini API anahtarı geçersiz. Kayıtlı anahtar silindi.", "error", "Anahtar hatası");
        return;
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        state.aiReportText = text;
        const output = $("aiOutput");
        if (output) {
          output.classList.add("show");
          output.innerHTML = renderMarkdown(text);
        }
        $("aiPlaceholder")?.classList.add("hidden");
        const modelInfo = $("aiModelInfo");
        if (modelInfo) modelInfo.textContent = `Model: ${model} • ${formatClock(new Date())}`;
        const copyBtn = $("copyReportBtn");
        if (copyBtn) copyBtn.disabled = false;
        toast("Yönetici özeti oluşturuldu.", "success", "AI Analizi");
        return;
      }

      lastError = data?.error?.message || `${model} yanıt vermedi.`;
    } catch (error) {
      console.warn(`${model} hatası:`, error);
      lastError = error.message;
    }
  }

  aiError("Özet oluşturulamadı", lastError || "Sunucudan yanıt alınamadı.");
  toast(lastError || "AI özeti oluşturulamadı.", "error", "AI hatası");
}

async function copyReport() {
  if (!state.aiReportText) {
    toast("Kopyalanacak rapor bulunmuyor. Önce özet çıkarın.", "warning", "Rapor yok");
    return;
  }

  const header = `SOC Analist Paneli — Günlük Yönetici Özeti\nOluşturma: ${new Date().toLocaleString("tr-TR")}\nAnalist: ${state.user?.email || "-"}\n\n`;
  const content = header + state.aiReportText;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
    } else {
      const area = document.createElement("textarea");
      area.value = content;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast("Rapor panoya kopyalandı.", "success", "Kopyalandı");
  } catch (error) {
    console.error("Kopyalama hatası:", error);
    toast("Rapor kopyalanamadı. Tarayıcı pano iznini kontrol edin.", "error", "Kopyalama hatası");
  }
}

const IP_POOL = ["10.0.14.22", "185.220.101.42", "172.16.8.91", "192.168.1.134", "10.0.22.77", "203.0.113.58"];

function randomIPv4() {
  const privateRanges = [
    () => `10.${rnd(0, 255)}.${rnd(0, 255)}.${rnd(1, 254)}`,
    () => `172.${rnd(16, 31)}.${rnd(0, 255)}.${rnd(1, 254)}`,
    () => `192.168.${rnd(0, 255)}.${rnd(1, 254)}`
  ];
  const pool = privateRanges[rnd(0, privateRanges.length - 1)];
  return pool();
}

function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fillRandomIp() {
  const input = $("logSourceIp");
  if (!input) return;
  // Havuzdan gerçekçi bir adres seç, tekrar etmesin
  const current = input.value.trim();
  const candidates = IP_POOL.filter((ip) => ip !== current);
  input.value = candidates.length ? candidates[rnd(0, candidates.length - 1)] : randomIPv4();
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}


async function handleRowAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  if (!id) return;

  if (action === "resolve") {
    button.disabled = true;
    try {
      await markLogResolved(id);
      await loadLogs({ silent: true });
      toast("Kayıt \"İncelendi\" olarak güncellendi.", "success", "Durum güncellendi");
    } catch (error) {
      console.error("Güncelleme hatası:", error);
      toast(error.message, "error", "Güncellenemedi");
      button.disabled = false;
    }
    return;
  }

  if (action === "delete") {
    if (!window.confirm("Bu log kaydı Firestore'dan kalıcı olarak silinecek. Onaylıyor musunuz?")) return;
    button.disabled = true;
    try {
      await deleteLogRecord(id);
      await loadLogs({ silent: true });
      toast("Kayıt Firestore'dan silindi.", "success", "Kayıt silindi");
    } catch (error) {
      console.error("Silme hatası:", error);
      toast(error.message, "error", "Silinemedi");
      button.disabled = false;
    }
  }
}

let searchTimer = null;

function refreshListView() {
  applyFilters();
  renderKPIs();
  renderTable();
}

function bindFilters() {
  const search = $("searchInput");
  const severity = $("filterSeverity");
  const status = $("filterStatus");
  const type = $("filterType");

  if (search) {
    search.addEventListener("input", () => {
      state.filters.query = search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshListView, 160);
    });
  }

  [
    [severity, "severity"],
    [status, "status"],
    [type, "type"]
  ].forEach(([element, key]) => {
    if (!element) return;
    element.addEventListener("change", () => {
      state.filters[key] = element.value;
      refreshListView();
    });
  });

  $("clearFiltersBtn")?.addEventListener("click", () => {
    state.filters = { query: "", severity: "ALL", status: "ALL", type: "ALL" };
    if (search) search.value = "";
    if (severity) severity.value = "ALL";
    if (status) status.value = "ALL";
    if (type) type.value = "ALL";
    refreshListView();
  });
}

function bindEvents() {
  bindNavigation();
  bindModals();

  $("menuBtn")?.addEventListener("click", () => {
    if ($("sidebar")?.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  $("sidebarBackdrop")?.addEventListener("click", closeSidebar);


 
 
 

  $("aiGenerateBtn")?.addEventListener("click", generateAiSummary);
  $("aiKeyBtn")?.addEventListener("click", () => openModal("keyModal"));
  $("saveKeyBtn")?.addEventListener("click", handleSaveKey);
  $("clearKeyBtn")?.addEventListener("click", handleClearKey);
  $("copyReportBtn")?.addEventListener("click", copyReport);

 
  $("settingsSaveKeyBtn")?.addEventListener("click", handleSaveKeyFromSettings);
  $("settingsClearKeyBtn")?.addEventListener("click", handleClearKey);
  $("settingsGoAiBtn")?.addEventListener("click", () => switchView("ai"));
  $("settingsLogoutBtn")?.addEventListener("click", handleLogout);


  $("refreshBtn")?.addEventListener("click", () => loadLogs());
  $("logoutBtn")?.addEventListener("click", handleLogout);


  document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
  });
  $("authForm")?.addEventListener("submit", handleAuthSubmit);

  document.addEventListener("click", handleRowAction);

  bindFilters();
}


async function init() {
  ["sideProjectId", "statusProject", "settingsProject"].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = firebaseConfig.projectId || "-";
  });

  bindEvents();
  updateKeyState();
  setAuthMode("login");
  updateStatusbar();
  switchView("overview");

  if (typeof Chart === "undefined") {
    toast("Chart.js yüklenemedi. Grafikler devre dışı, tablo çalışmaya devam ediyor.", "warning", "Grafik uyarısı");
  }

  await initAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

