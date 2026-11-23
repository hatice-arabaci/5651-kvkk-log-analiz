
let currentLogs = [];

document.addEventListener("DOMContentLoaded", () => {
  // 1. Logları Yükle (Read & LocalStorage Veri Kalıcılığı)
  const savedLogs = localStorage.getItem("kvkk_logs");
  
  if (savedLogs) {
    // Hafızada veri varsa onu kullan (Sayfa yenilendiğinde veriler kaybolmaz)
    currentLogs = JSON.parse(savedLogs);
    renderLogs();
  } else {
    // Hafızada yoksa logs.json dosyasından çek ve hafızaya kaydet
    fetch("logs.json")
      .then((response) => {
        if (!response.ok) throw new Error(`logs.json okunamadı (HTTP ${response.status})`);
        return response.json();
      })
      .then((logs) => {
        currentLogs = Array.isArray(logs) ? logs : (logs.logs || []);
        saveToLocalStorage();
        renderLogs();
      })
      .catch((err) => {
        console.error("Log yükleme hatası:", err);
        const container = document.getElementById("logContainer");
        if (container) {
          container.innerHTML = `<p style="color:red;"><b>Loglar yüklenemedi:</b> ${err.message}</p>`;
        }
      });
  }

  // 2. Yeni Log Ekleme Formu (Create)
  const addLogForm = document.getElementById("addLogForm");
  if (addLogForm) {
    addLogForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const newLog = {
        id: Date.now(), // Silme ve Güncelleme işlemleri için benzersiz kimlik (ID)
        timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
        log_type: document.getElementById("logType").value,
        source_ip: "192.168.1.99",
        user: document.getElementById("user").value,
        details: document.getElementById("details").value,
        severity: document.getElementById("severity").value,
        status: "Aktif"
      };

      currentLogs.unshift(newLog); // En başa ekle
      saveToLocalStorage();        // Hafızaya kaydet
      renderLogs();                // Ekranı güncelle
      addLogForm.reset();
    });
  }

  // Yapay Zeka Özeti Al Butonu
  const aiBtn = document.getElementById("generateAiSummaryBtn");
  if (aiBtn) aiBtn.addEventListener("click", generateAiSummary);

  // API Anahtarı Yönetim Butonu (Güncelle / Sıfırla)
  const apiKeyBtn = document.getElementById("apiKeyBtn");
  if (apiKeyBtn) apiKeyBtn.addEventListener("click", manageApiKey);

  // 3. Anlık Arama ve Çoklu Filtre Dinleyicileri
  const searchInput = document.getElementById("searchInput");
  const filterSeverity = document.getElementById("filterSeverity");
  const filterStatus = document.getElementById("filterStatus");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");

  if (searchInput) searchInput.addEventListener("input", renderLogs);
  if (filterSeverity) filterSeverity.addEventListener("change", renderLogs);
  if (filterStatus) filterStatus.addEventListener("change", renderLogs);

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (filterSeverity) filterSeverity.value = "ALL";
      if (filterStatus) filterStatus.value = "ALL";
      renderLogs();
    });
  }
});

// Tarayıcı Hafızasına (LocalStorage) Kaydetme
function saveToLocalStorage() {
  localStorage.setItem("kvkk_logs", JSON.stringify(currentLogs));
}

// Log Silme İşlemi (Delete)
window.deleteLog = function(id) {
  if (confirm("Bu log kaydını kalıcı olarak silmek istediğinize emin misiniz?")) {
    currentLogs = currentLogs.filter(log => log.id !== id);
    saveToLocalStorage();
    renderLogs();
  }
};

// Log Durumu Güncelleme İşlemi (Update)
window.updateLogStatus = function(id) {
  const logIndex = currentLogs.findIndex(log => log.id === id);
  if (logIndex !== -1) {
    currentLogs[logIndex].status = "İncelendi";
    currentLogs[logIndex].severity = "RESOLVED"; 
    saveToLocalStorage();
    renderLogs();
  }
};

// Zaman Filtresi Algoritması: Olayın son 24 saat içinde gerçekleşip gerçekleşmediğini kontrol eder
function isWithinLast24Hours(timestampStr) {
  if (!timestampStr) return false;

  // "YYYY-MM-DD HH:mm:ss" formatını ISO standartına uyumlu hale getirmek için boşluğu "T" ile değiştiriyoruz
  const formattedStr = timestampStr.includes("T") ? timestampStr : timestampStr.replace(" ", "T");
  const logDate = new Date(formattedStr);

  // Geçersiz tarih kontrolü
  if (isNaN(logDate.getTime())) return false;

  const now = new Date();
  const diffInMs = now.getTime() - logDate.getTime();
  const twentyFourHoursInMs = 24 * 60 * 60 * 1000;

  // 0 ms ile 24 saat arası (küçük saat farkı ve gecikmeler için -60 saniyelik tolerans)
  return diffInMs >= -60000 && diffInMs <= twentyFourHoursInMs;
}

// KPI Metriklerini Hesaplayan ve Ekrana Yansıtan Fonksiyon
function updateKPIMetrics() {
  const totalLogs = currentLogs.length;

  // Son 24 saat içinde gerçekleşen CRITICAL ve HIGH seviyesindeki tehditler
  const riskLogs = currentLogs.filter((log) => {
    const isThreat = log.severity === "CRITICAL" || log.severity === "HIGH";
    return isThreat && isWithinLast24Hours(log.timestamp);
  }).length;

  // İncelenen kayıtlar
  const resolvedLogs = currentLogs.filter(
    (log) => log.status === "İncelendi" || log.severity === "RESOLVED"
  ).length;

  // Bekleyen kayıtlar (İncelenmemiş olanlar)
  const pendingLogs = Math.max(0, totalLogs - resolvedLogs);

  const totalEl = document.getElementById("kpiTotalLogs");
  const riskEl = document.getElementById("kpiRiskLogs");
  const resolvedEl = document.getElementById("kpiResolvedLogs");
  const pendingEl = document.getElementById("kpiPendingLogs");

  if (totalEl) totalEl.textContent = totalLogs;
  if (riskEl) riskEl.textContent = riskLogs;
  if (resolvedEl) resolvedEl.textContent = resolvedLogs;
  if (pendingEl) pendingEl.textContent = pendingLogs;
}

let severityChart = null;

// Logların CRITICAL, HIGH, WARNING, INFO ve RESOLVED oranlarını gösteren Chart.js Halka (Doughnut) grafiği
function updateSeverityChart() {
  const canvas = document.getElementById("severityChart");
  if (!canvas || typeof Chart === "undefined") return;

  const counts = {
    CRITICAL: 0,
    HIGH: 0,
    WARNING: 0,
    INFO: 0,
    RESOLVED: 0
  };

  currentLogs.forEach((log) => {
    const sev = (log.severity || "").toUpperCase();
    if (counts.hasOwnProperty(sev)) {
      counts[sev]++;
    }
  });

  const chartData = [
    counts.CRITICAL,
    counts.HIGH,
    counts.WARNING,
    counts.INFO,
    counts.RESOLVED
  ];

  if (!severityChart) {
    const ctx = canvas.getContext("2d");
    severityChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["CRITICAL", "HIGH", "WARNING", "INFO", "RESOLVED"],
        datasets: [
          {
            label: "Kayıt Sayısı",
            data: chartData,
            backgroundColor: [
              "#ef4444", // CRITICAL (Kırmızı)
              "#f97316", // HIGH (Turuncu)
              "#eab308", // WARNING (Sarı)
              "#3b82f6", // INFO (Mavi)
              "#10b981"  // RESOLVED (Yeşil)
            ],
            borderWidth: 2,
            borderColor: "#ffffff"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 12,
              padding: 10,
              font: {
                size: 11
              }
            }
          }
        },
        cutout: "65%"
      }
    });
  } else {
    // CRUD işlemleri sonrası grafiğin anlık güncellenmesi
    severityChart.data.datasets[0].data = chartData;
    severityChart.update();
  }
}

let dailyDensityChart = null;

// Tarihlere göre log kayıtlarını gruplayan veri agregasyonu (reduce) ve Günlük Log Yoğunluğu Grafiği
function updateDailyDensityChart() {
  const canvas = document.getElementById("dailyDensityChart");
  if (!canvas || typeof Chart === "undefined") return;

  // currentLogs dizisindeki kayıtları tarihlere göre gruplayan veri agregasyonu (reduce)
  const dateCounts = currentLogs.reduce((acc, log) => {
    if (!log.timestamp) return acc;
    // Zaman damgasından gün bilgisini ("YYYY-MM-DD") alıyoruz
    const dateKey = log.timestamp.substring(0, 10);
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {});

  // Tarihleri kronolojik sıraya diziyoruz
  const labels = Object.keys(dateCounts).sort();
  const data = labels.map((date) => dateCounts[date]);

  if (!dailyDensityChart) {
    const ctx = canvas.getContext("2d");
    dailyDensityChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Günlük Log Yoğunluğu",
            data: data,
            backgroundColor: "rgba(37, 99, 235, 0.75)",
            borderColor: "#2563eb",
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => ` Toplam Olay: ${context.parsed.y}`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              precision: 0
            },
            grid: {
              color: "#f1f5f9"
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    });
  } else {
    // CRUD işlemleri sonrası grafiğin anlık güncellenmesi
    dailyDensityChart.data.labels = labels;
    dailyDensityChart.data.datasets[0].data = data;
    dailyDensityChart.update();
  }
}

// Gelişmiş Arama ve Çoklu Filtreleme Mantığı
function getFilteredLogs() {
  const searchInput = document.getElementById("searchInput");
  const filterSeverity = document.getElementById("filterSeverity");
  const filterStatus = document.getElementById("filterStatus");

  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const selectedSeverity = filterSeverity ? filterSeverity.value : "ALL";
  const selectedStatus = filterStatus ? filterStatus.value : "ALL";

  return currentLogs.filter((log) => {
    // 1. Arama Çubuğu: Kullanıcı adı, IP adresi (kaynak/hedef) ve Olay açıklaması
    if (query) {
      const user = (log.user || "").toLowerCase();
      const sourceIp = (log.source_ip || "").toLowerCase();
      const destIp = (log.destination_ip || "").toLowerCase();
      const details = (log.details || "").toLowerCase();

      const matches =
        user.includes(query) ||
        sourceIp.includes(query) ||
        destIp.includes(query) ||
        details.includes(query);

      if (!matches) return false;
    }

    // 2. Önem Seviyesi Filtresi (CRITICAL, HIGH, WARNING, INFO, RESOLVED)
    if (selectedSeverity !== "ALL") {
      const logSev = (log.severity || "").toUpperCase();
      if (logSev !== selectedSeverity) return false;
    }

    // 3. İnceleme Durumu Filtresi (İncelenen veya Bekleyen)
    const isResolved = log.status === "İncelendi" || log.severity === "RESOLVED";
    if (selectedStatus === "RESOLVED" && !isResolved) return false;
    if (selectedStatus === "PENDING" && isResolved) return false;

    return true;
  });
}

// Logları Ekrana Basan Fonksiyon
function renderLogs() {
  updateKPIMetrics();
  updateSeverityChart();
  updateDailyDensityChart();
  const container = document.getElementById("logContainer");
  if (!container) return;
  container.innerHTML = "";

  const filteredLogs = getFilteredLogs();

  // Filtre durum bilgisini güncelle (Örn: "5 kayıttan 2'si listeleniyor")
  const resultInfo = document.getElementById("filterResultInfo");
  const searchInput = document.getElementById("searchInput");
  const filterSeverity = document.getElementById("filterSeverity");
  const filterStatus = document.getElementById("filterStatus");

  const isFilterActive =
    (searchInput && searchInput.value.trim() !== "") ||
    (filterSeverity && filterSeverity.value !== "ALL") ||
    (filterStatus && filterStatus.value !== "ALL");

  if (resultInfo) {
    if (isFilterActive) {
      resultInfo.style.display = "block";
      resultInfo.innerHTML = `🔍 <b>Filtre Aktif:</b> Toplam <b>${currentLogs.length}</b> kayıttan <b>${filteredLogs.length}</b> kayıt gösteriliyor.`;
    } else {
      resultInfo.style.display = "none";
    }
  }

  if (currentLogs.length === 0) {
    container.innerHTML = "<p>Henüz kayıtlı log bulunmuyor.</p>";
    return;
  }

  if (filteredLogs.length === 0) {
    container.innerHTML = `
      <div style="background: #fff; padding: 25px; border-radius: 6px; text-align: center; color: #64748b; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <p style="font-size: 1.1rem; margin-top:0; margin-bottom: 5px; color: #334155;">⚠️ <b>Eşleşen log kaydı bulunamadı.</b></p>
        <small>Arama teriminizi veya seçtiğiniz önem/durum filtrelerini değiştirmeyi deneyebilirsiniz.</small>
      </div>
    `;
    return;
  }

  filteredLogs.forEach((log) => {
    const div = document.createElement("div");
    const isResolved = log.severity === "RESOLVED";
    div.className = `log-card ${log.severity}`;
    
    // Çözülmüş loglar için görsel geribildirim (Yeşil çerçeve)
    div.style.border = isResolved ? "2px solid #4CAF50" : "";
    div.style.padding = "10px";
    div.style.marginBottom = "10px";
    div.style.borderRadius = "5px";

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <strong>[${log.timestamp}] - ${log.log_type}</strong> (Kullanıcı: <b>${log.user}</b>)<br>
          <span>${log.details}</span> <br>
          <small>Önem Seviyesi: <b style="color: ${isResolved ? '#4CAF50' : 'inherit'}">${isResolved ? "ÇÖZÜLDÜ" : log.severity}</b> | Kaynak IP: ${log.source_ip}${log.destination_ip ? ` ➔ Hedef IP: ${log.destination_ip}` : ''}</small>
        </div>
        <div>
          ${!isResolved ? `<button onclick="updateLogStatus(${log.id})" style="background-color:#4CAF50; color:white; border:none; padding:5px 10px; cursor:pointer; margin-right:5px; border-radius:3px;">✓ İncelendi</button>` : `<span style="color:#4CAF50; font-weight:bold; margin-right:10px;">✓ Onaylandı</span>`}
          <button onclick="deleteLog(${log.id})" style="background-color:#f44336; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:3px;">X Sil</button>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

// -----------------------------
// Gemini API Anahtarı Yönetimi (BYOK - Bring Your Own Key)
// Anahtar kod içinde tutulmaz; yalnızca kullanıcının kendi tarayıcısında (localStorage) saklanır.
// -----------------------------
const GEMINI_API_KEY_STORAGE_KEY = "gemini_api_key";

// Kayıtlı anahtarı temizlenmiş (trim) hâliyle döndürür, yoksa boş string döner
function getApiKey() {
  try {
    const key = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    return key ? key.trim() : "";
  } catch (err) {
    console.warn("API anahtarı okunamadı:", err);
    return "";
  }
}

// Anahtarı trim edip kaydeder, kaydedilen değeri döndürür
function saveApiKey(key) {
  const cleanKey = (key || "").trim();
  if (!cleanKey) return "";

  try {
    localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, cleanKey);
    return cleanKey;
  } catch (err) {
    console.warn("API anahtarı kaydedilemedi:", err);
    return "";
  }
}

// Kayıtlı anahtarı tarayıcıdan siler
function clearApiKey() {
  try {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch (err) {
    console.warn("API anahtarı silinemedi:", err);
  }
}

// Anahtar kayıtlı değilse kullanıcıdan ister, kaydeder ve analize devam eder
function ensureApiKey() {
  let apiKey = getApiKey();
  if (apiKey) return apiKey;

  const userKey = window.prompt(
    "Yapay zeka özeti için Gemini API anahtarınızı girin.\n\n" +
      "Anahtar oluşturmak için: https://aistudio.google.com/app/apikey\n" +
      "Anahtar yalnızca bu tarayıcıda (localStorage) saklanır, kod içinde tutulmaz."
  );

  if (userKey === null) return ""; // Kullanıcı iptal etti

  apiKey = saveApiKey(userKey);
  if (!apiKey) {
    alert("Geçerli bir Gemini API anahtarı girilmedi. Anahtar boş olamaz.");
    return "";
  }
  return apiKey;
}

// "🔑 API Anahtarı" butonu: kayıtlı anahtarı günceller veya sıfırlar
function manageApiKey() {
  const existingKey = getApiKey();
  const maskedKey = existingKey
    ? `${existingKey.slice(0, 6)}...${existingKey.slice(-4)}`
    : "";

  const input = window.prompt(
    existingKey
      ? `Kayıtlı Gemini API anahtarı: ${maskedKey}\n\n` +
          "Yeni anahtarı girin. Anahtarı sıfırlamak için alanı BOŞ bırakıp Tamam'a basın."
      : "Gemini API anahtarınızı girin.\n\n" +
          "Anahtar oluşturmak için: https://aistudio.google.com/app/apikey"
  );

  if (input === null) return; // Kullanıcı iptal etti

  const inputKey = input.trim();

  if (!inputKey) {
    if (!existingKey) {
      alert("Kayıtlı bir API anahtarı bulunmuyor. Yapay zeka özeti sırasında anahtar istenecektir.");
      return;
    }
    clearApiKey();
    alert("Kayıtlı API anahtarı silindi. Yapay zeka özeti için anahtar yeniden sorulacak.");
    return;
  }

  if (saveApiKey(inputKey)) {
    alert("API anahtarı bu tarayıcı için kaydedildi.");
  } else {
    alert("API anahtarı kaydedilemedi. Tarayıcı depolaması (localStorage) kullanılamıyor olabilir.");
  }
}

// Geçersiz / yetkisiz anahtar kontrolü (400, 401, 403 veya API_KEY_INVALID)
function isInvalidApiKeyError(status, error) {
  if (status === 400 || status === 401 || status === 403) return true;

  const errorText = `${(error && error.status) || ""} ${(error && error.message) || ""} ${
    error && error.details ? JSON.stringify(error.details) : ""
  }`;

  return /API_KEY_INVALID|API_KEY_EXPIRED|API key not valid/i.test(errorText);
}

// Gemini API Entegrasyonu (Gemini 3.5 Flash)
async function generateAiSummary() {
  const summaryBox = document.getElementById("aiSummaryBox");
  const summaryText = document.getElementById("aiSummaryText");
  if (!summaryBox || !summaryText) return;

  summaryBox.style.display = "block";

  // 1. Anahtar kontrolü: yoksa kullanıcıdan iste (BYOK)
  const apiKey = ensureApiKey();
  if (!apiKey) {
    summaryText.innerHTML =
      "🔑 <b>API anahtarı gerekli:</b> Özet çıkarmak için Gemini API anahtarınızı girmelisiniz. Sağ üstteki <b>🔑 API Anahtarı</b> butonunu kullanabilirsiniz.";
    return;
  }

  if (currentLogs.length === 0) {
    summaryText.innerHTML = "⚠️ <b>Uyarı:</b> Analiz edilecek log kaydı bulunamadı.";
    return;
  }

  summaryText.innerHTML = "<i>Yapay zeka canlı log verilerini inceliyor ve özet çıkarıyor...</i>";

  const promptText = `
Sen bir Siber Güvenlik ve KVKK Danışmanısın. Aşağıda bir şirketin son 5651 ve KVKK log verileri yer almaktadır.
Teknik olmayan bir şirket yöneticisine sunmak üzere, bu logları inceleyip Türkçe olarak kısa bir günlük güvenlik özeti hazırla.
Eğer kritik (CRITICAL/HIGH) bir KVKK veya güvenlik ihlali varsa özellikle vurgula.

Log Verisi:
${JSON.stringify(currentLogs, null, 2)}
`;

  // Gemini model listesi (ilk model bulunamazsa sıradaki denenir)
  const models = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    // Yayınlanmış/kararlı model adları (yedek)
    "gemini-2.5-flash",
    "gemini-2.0-flash"
  ];

  let lastError = null;

  for (const model of models) {
    try {
      summaryText.innerHTML = `<i>Yapay zeka (${model}) verileri inceliyor...</i>`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: promptText }]
              }
            ]
          })
        }
      );

      const data = await response.json().catch(() => ({}));

      // Geçersiz / yetkisiz anahtar: hatalı anahtarı tarayıcıdan temizle ve uyar
      if (isInvalidApiKeyError(response.status, data.error)) {
        clearApiKey();
        const detail = data.error && data.error.message ? ` (${data.error.message})` : "";
        summaryText.innerHTML =
          `🔑 <b>Geçersiz API Anahtarı:</b> Girdiğiniz Gemini API anahtarı geçersiz veya yetkisiz ` +
          `(HTTP ${response.status})${detail}. Hatalı anahtar bu tarayıcıdan silindi. ` +
          `Lütfen <b>🔑 API Anahtarı</b> butonundan geçerli bir anahtar girin.`;
        alert(
          "Geçersiz veya yetkisiz Gemini API anahtarı. Kayıtlı anahtar tarayıcıdan silindi.\n" +
            "Lütfen '🔑 API Anahtarı' butonundan geçerli bir anahtar girin."
        );
        return;
      }

      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        const aiReply = data.candidates[0].content.parts[0].text;

        summaryText.innerHTML = aiReply
          .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
          .replace(/\n/g, "<br>");
        return; 
      } else if (data.error) {
        console.warn(`${model} uyarısı:`, data.error.message);
        lastError = data.error.message;
      }
    } catch (err) {
      console.error(`${model} bağlantı hatası:`, err);
      lastError = err.message;
    }
  }

  summaryText.innerHTML = `⚠️ <b>API Hatası:</b> ${lastError || "Sunucudan yanıt alınamadı."}`;
}