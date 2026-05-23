const STORAGE_KEY = "stream-overlay-deck-assets-v1";
const CHANNEL_NAME = "stream-overlay-live-channel";
const HOTKEY_LIMIT = 9;

const isOverlayMode = new URLSearchParams(window.location.search).get("mode") === "overlay";
const channel = new BroadcastChannel(CHANNEL_NAME);

const defaultAssets = [
  {
    id: crypto.randomUUID(),
    type: "slide",
    title: "Birazdan Donuyoruz",
    text: "Yayin kisa bir araya girdi. Lutfen ayrilmayin.",
    mediaUrl: "",
    theme: "neon",
    duration: 0,
    group: "Mola",
    transition: "fade"
  },
  {
    id: crypto.randomUUID(),
    type: "ticker",
    title: "Alt Bant",
    text: "Abone olun • Bildirimleri acin • Sorularinizi canli sohbetten yazin",
    mediaUrl: "",
    theme: "minimal",
    duration: 0,
    group: "Alt Bant",
    transition: "fade"
  }
];

const state = {
  assets: [],
  activeAssetId: null,
  deferredPrompt: null,
  activeGroup: "all",
  countdownTimer: null,
  overlayAudioContext: null
};

function loadAssets() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.assets = defaultAssets;
    persistAssets();
    return;
  }

  try {
    state.assets = JSON.parse(raw);
  } catch {
    state.assets = defaultAssets;
  }
}

function persistAssets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.assets));
}

function createFileURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function saveDeckFormState() {
  const type = document.getElementById("assetType").value;
  const title = document.getElementById("assetTitle").value.trim();
  const text = document.getElementById("assetText").value.trim();
  const mediaUrl = document.getElementById("assetMedia").value.trim();
  const theme = document.getElementById("assetTheme").value;
  const duration = Number(document.getElementById("assetDuration").value || 0);
  const group = document.getElementById("assetGroup").value.trim();
  const transition = document.getElementById("assetTransition").value;

  return {
    id: crypto.randomUUID(),
    type,
    title: title || "Adsiz Kart",
    text,
    mediaUrl,
    theme,
    duration,
    group: group || "Genel",
    transition
  };
}

function clearForm() {
  document.getElementById("assetType").value = "slide";
  document.getElementById("assetTitle").value = "";
  document.getElementById("assetText").value = "";
  document.getElementById("assetMedia").value = "";
  document.getElementById("assetTheme").value = "neon";
  document.getElementById("assetDuration").value = "0";
  document.getElementById("assetGroup").value = "";
  document.getElementById("assetTransition").value = "fade";
  document.getElementById("assetFile").value = "";
}

function sendOverlayCommand(command) {
  channel.postMessage(command);
}

function getHotkeyLabel(index) {
  return index < HOTKEY_LIMIT ? `${index + 1}` : "—";
}

function moveAsset(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= state.assets.length) {
    return;
  }
  const [item] = state.assets.splice(fromIndex, 1);
  state.assets.splice(toIndex, 0, item);
  persistAssets();
  renderAssetList();
}

function renderAssetList() {
  const assetList = document.getElementById("assetList");
  assetList.innerHTML = "";
  const visibleAssets = state.activeGroup === "all"
    ? state.assets
    : state.assets.filter((asset) => asset.group === state.activeGroup);

  visibleAssets.forEach((asset) => {
    const index = state.assets.findIndex((entry) => entry.id === asset.id);
    const card = document.createElement("article");
    card.className = "asset-card";
    card.innerHTML = `
      <div class="asset-meta">
        <div class="section-head">
          <div class="hotkey-badge">${getHotkeyLabel(index)}</div>
          <div>
            <h3>${asset.title}</h3>
            <p>${asset.text || asset.mediaUrl || "Icerik hazir"}</p>
          </div>
        </div>
        <div class="asset-tags">
          <span class="chip">${asset.type}</span>
          <span class="chip">${asset.theme}</span>
          <span class="chip">${asset.group || "Genel"}</span>
          <span class="chip">${asset.transition || "fade"}</span>
          ${asset.duration ? `<span class="chip">${asset.duration}s</span>` : ""}
        </div>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-action="show" data-id="${asset.id}">Yayina Ver</button>
        <button class="secondary-button" data-action="up" data-id="${asset.id}">Yukari</button>
        <button class="secondary-button" data-action="down" data-id="${asset.id}">Asagi</button>
        <button class="secondary-button" data-action="delete" data-id="${asset.id}">Sil</button>
      </div>
    `;
    assetList.appendChild(card);
  });

  assetList.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const assetId = button.dataset.id;
      const action = button.dataset.action;
      const index = state.assets.findIndex((asset) => asset.id === assetId);
      if (index === -1) {
        return;
      }

      if (action === "show") {
        activateAsset(state.assets[index]);
        return;
      }
      if (action === "delete") {
        state.assets.splice(index, 1);
        persistAssets();
        renderAssetList();
        return;
      }
      if (action === "up") {
        moveAsset(index, index - 1);
        return;
      }
      if (action === "down") {
        moveAsset(index, index + 1);
      }
    });
  });
}

function refreshGroupFilter() {
  const groupFilter = document.getElementById("groupFilter");
  const groups = [...new Set(state.assets.map((asset) => asset.group || "Genel"))].sort();
  const previous = state.activeGroup;
  groupFilter.innerHTML = `<option value="all">Tum Gruplar</option>${groups
    .map((group) => `<option value="${group}">${group}</option>`)
    .join("")}`;
  if (groups.includes(previous)) {
    groupFilter.value = previous;
  } else {
    groupFilter.value = "all";
    state.activeGroup = "all";
  }
}

function activateAsset(asset) {
  state.activeAssetId = asset.id;
  sendOverlayCommand({
    type: "show",
    payload: asset
  });

  if (asset.duration > 0) {
    window.setTimeout(() => {
      if (state.activeAssetId === asset.id) {
        clearOverlay();
      }
    }, asset.duration * 1000);
  }
}

function clearOverlay() {
  state.activeAssetId = null;
  sendOverlayCommand({ type: "clear" });
}

async function addAssetFromForm() {
  const asset = saveDeckFormState();
  const fileInput = document.getElementById("assetFile");
  const file = fileInput.files?.[0];

  if (file) {
    asset.mediaUrl = await createFileURL(file);
    if (file.type.startsWith("video/")) {
      asset.type = "video";
    } else if (file.type.startsWith("image/")) {
      asset.type = "image";
    }
  }

  state.assets.unshift(asset);
  persistAssets();
  refreshGroupFilter();
  renderAssetList();
  clearForm();
}

function downloadOfflineHtml() {
  const html = document.documentElement.outerHTML;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "stream-overlay-deck-offline.html";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setupDeckMode() {
  loadAssets();
  refreshGroupFilter();
  renderAssetList();

  document.getElementById("saveAsset").addEventListener("click", addAssetFromForm);
  document.getElementById("clearForm").addEventListener("click", clearForm);
  document.getElementById("clearAllAssets").addEventListener("click", () => {
    state.assets = [];
    persistAssets();
    renderAssetList();
    clearOverlay();
  });
  document.getElementById("downloadHtml").addEventListener("click", downloadOfflineHtml);
  document.getElementById("groupFilter").addEventListener("change", (event) => {
    state.activeGroup = event.target.value;
    renderAssetList();
  });
  document.getElementById("openOverlayWindow").addEventListener("click", () => {
    window.open("./index.html?mode=overlay", "_blank", "noopener,noreferrer");
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
  });

  document.getElementById("installApp").addEventListener("click", async () => {
    if (!state.deferredPrompt) {
      alert("Tarayici kurulum istemi vermedi. Chrome veya Edge ile deneyin.");
      return;
    }
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
  });

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const asset = state.assets[index];
      if (asset) {
        activateAsset(asset);
      }
    }

    if (event.code === "Space") {
      event.preventDefault();
      clearOverlay();
    }
  });

  channel.postMessage({ type: "sync-request" });
}

function hideAllOverlayMedia() {
  document.getElementById("overlayImage").style.display = "none";
  const video = document.getElementById("overlayVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.style.display = "none";
}

function clearOverlayView() {
  document.getElementById("overlayCard").classList.add("is-hidden");
  document.getElementById("tickerBar").classList.add("is-hidden");
  document.getElementById("countdownBox").classList.add("is-hidden");
  if (state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  hideAllOverlayMedia();
}

function ensureOverlayAudioContext() {
  if (state.overlayAudioContext) {
    return state.overlayAudioContext;
  }
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }
  state.overlayAudioContext = new AudioCtor();
  return state.overlayAudioContext;
}

function playCountdownBeep() {
  const context = ensureOverlayAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    context.resume();
  }
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 740;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

function formatCountdown(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startCountdown(asset) {
  const countdownBox = document.getElementById("countdownBox");
  const countdownLabel = document.getElementById("countdownLabel");
  const countdownTime = document.getElementById("countdownTime");
  let remaining = Math.max(1, Number(asset.duration || 300));
  countdownLabel.textContent = asset.title || "Yayin birazdan basliyor";
  countdownTime.textContent = formatCountdown(remaining);
  countdownBox.classList.remove("is-hidden");
  if (state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
  }
  state.countdownTimer = window.setInterval(() => {
    remaining -= 1;
    countdownTime.textContent = formatCountdown(Math.max(0, remaining));
    if (remaining <= 10 && remaining > 0) {
      playCountdownBeep();
    }
    if (remaining <= 0) {
      playCountdownBeep();
      window.clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }, 1000);
}

function applyOverlayAsset(asset) {
  const overlayCard = document.getElementById("overlayCard");
  const tickerBar = document.getElementById("tickerBar");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayEyebrow = document.getElementById("overlayEyebrow");
  const overlayImage = document.getElementById("overlayImage");
  const overlayVideo = document.getElementById("overlayVideo");
  const tickerContent = document.getElementById("tickerContent");
  const countdownBox = document.getElementById("countdownBox");

  overlayCard.className = `overlay-card theme-${asset.theme} transition-${asset.transition || "fade"}`;
  tickerBar.classList.add("is-hidden");
  countdownBox.classList.add("is-hidden");
  hideAllOverlayMedia();

  overlayEyebrow.textContent = asset.type === "break" ? "Mola" : "Canli Yayin";
  overlayTitle.textContent = asset.title || "";
  overlayText.textContent = asset.text || "";

  if (asset.type === "ticker") {
    tickerContent.textContent = asset.text || asset.title || "";
    tickerBar.classList.remove("is-hidden");
    overlayCard.classList.add("is-hidden");
    return;
  }

  if (asset.type === "countdown") {
    overlayCard.classList.add("is-hidden");
    startCountdown(asset);
    return;
  }

  if (asset.mediaUrl) {
    if (asset.type === "video") {
      overlayVideo.src = asset.mediaUrl;
      overlayVideo.style.display = "block";
      overlayVideo.muted = true;
      overlayVideo.autoplay = true;
      overlayVideo.loop = true;
      overlayVideo.play().catch(() => {});
    } else {
      overlayImage.src = asset.mediaUrl;
      overlayImage.style.display = "block";
    }
  }

  overlayCard.classList.remove("is-hidden");
}

function setupOverlayMode() {
  document.body.style.background = "transparent";
  document.getElementById("deckApp").hidden = true;
  document.getElementById("overlayRoot").hidden = false;
  clearOverlayView();

  channel.addEventListener("message", (event) => {
    const { type, payload } = event.data || {};
    if (type === "show") {
      applyOverlayAsset(payload);
    }
    if (type === "clear") {
      clearOverlayView();
    }
  });
}

if ("serviceWorker" in navigator && !isOverlayMode) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

if (isOverlayMode) {
  setupOverlayMode();
} else {
  setupDeckMode();
}
