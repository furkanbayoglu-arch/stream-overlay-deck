const STORAGE_KEY = "stream-overlay-deck-assets-v1";
const PRESET_STORAGE_KEY = "stream-overlay-deck-presets-v1";
const CHANNEL_NAME = "stream-overlay-live-channel";
const HOTKEY_LIMIT = 9;

const mode = new URLSearchParams(window.location.search).get("mode");
const isOverlayMode = mode === "overlay";
const isRemoteMode = mode === "remote";
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
    transition: "fade",
    layer: "main"
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
    transition: "fade",
    layer: "lower-third"
  }
];

const state = {
  assets: [],
  activeAssetId: null,
  selectedAssetId: null,
  deferredPrompt: null,
  activeGroup: "all",
  countdownTimer: null,
  rundownAutoplayTimer: null,
  rundownAutoplayEnabled: false,
  rundownGapSeconds: 3,
  overlayAudioContext: null,
  rundown: [],
  rundownIndex: -1,
  presets: [],
  obs: {
    socket: null,
    connected: false,
    messageId: 0,
    pending: new Map(),
    scenes: [],
    inputs: [],
    currentScene: "",
    currentSourceEnabled: null
  }
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

function loadPresets() {
  const raw = localStorage.getItem(PRESET_STORAGE_KEY);
  if (!raw) {
    state.presets = [];
    return;
  }
  try {
    state.presets = JSON.parse(raw);
  } catch {
    state.presets = [];
  }
}

function persistAssets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.assets));
}

function persistPresets() {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.presets));
}

function clearRundownAutoplayTimer() {
  if (state.rundownAutoplayTimer) {
    window.clearTimeout(state.rundownAutoplayTimer);
    state.rundownAutoplayTimer = null;
  }
}

function updateRundownAutoplayStatus() {
  const text = state.rundownAutoplayEnabled
    ? `Otomatik oynatma acik • ${state.rundownGapSeconds}s bekleme`
    : "Otomatik oynatma kapali";
  const deckStatus = document.getElementById("rundownAutoStatus");
  const remoteStatus = document.getElementById("remoteAutoStatus");
  const toggle = document.getElementById("rundownAutoToggle");
  const remoteToggle = document.getElementById("remoteAutoToggle");
  if (deckStatus) {
    deckStatus.textContent = text;
  }
  if (remoteStatus) {
    remoteStatus.textContent = text;
  }
  if (toggle) {
    toggle.textContent = state.rundownAutoplayEnabled ? "Auto Durdur" : "Auto Oynat";
  }
  if (remoteToggle) {
    remoteToggle.textContent = state.rundownAutoplayEnabled ? "Auto Durdur" : "Auto";
  }
}

function syncObsIndicators() {
  const sceneNode = document.getElementById("obsCurrentScene");
  const sourceNode = document.getElementById("obsSourceState");
  if (sceneNode) {
    sceneNode.textContent = state.obs.currentScene || "-";
  }
  if (sourceNode) {
    if (state.obs.currentSourceEnabled === null) {
      sourceNode.textContent = "Bilinmiyor";
    } else {
      sourceNode.textContent = state.obs.currentSourceEnabled ? "Gorunur" : "Gizli";
    }
  }
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
  const layer = document.getElementById("assetLayer").value;

  return {
    id: crypto.randomUUID(),
    type,
    title: title || "Adsiz Kart",
    text,
    mediaUrl,
    theme,
    duration,
    group: group || "Genel",
    transition,
    layer
  };
}

function getSelectedAsset() {
  return state.assets.find((asset) => asset.id === state.selectedAssetId) || null;
}

function updateQuickEditStatus(text) {
  const node = document.getElementById("quickEditStatus");
  if (node) {
    node.textContent = text;
  }
}

function syncQuickEditor() {
  const asset = getSelectedAsset();
  const title = document.getElementById("quickEditTitle");
  const text = document.getElementById("quickEditText");
  const group = document.getElementById("quickEditGroup");
  const duration = document.getElementById("quickEditDuration");
  const apply = document.getElementById("quickEditApply");
  const show = document.getElementById("quickEditShow");

  if (!title || !text || !group || !duration || !apply || !show) {
    return;
  }

  if (!asset) {
    title.value = "";
    text.value = "";
    group.value = "";
    duration.value = "0";
    apply.disabled = true;
    show.disabled = true;
    updateQuickEditStatus("Duzenlemek icin kart listesinden bir kart secin.");
    return;
  }

  title.value = asset.title || "";
  text.value = asset.text || "";
  group.value = asset.group || "";
  duration.value = String(asset.duration || 0);
  apply.disabled = false;
  show.disabled = false;
  updateQuickEditStatus(
    state.activeAssetId === asset.id
      ? `Secili kart su an yayinda: ${asset.title}`
      : `Secili kart hazir: ${asset.title}`
  );
}

function selectAsset(assetId) {
  state.selectedAssetId = assetId;
  renderAssetList();
  renderRemoteLists();
  syncQuickEditor();
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
  document.getElementById("assetLayer").value = "main";
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
  renderRemoteLists();
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
    const cardClasses = ["asset-card"];
    if (asset.id === state.activeAssetId) {
      cardClasses.push("is-current");
    }
    if (asset.id === state.selectedAssetId) {
      cardClasses.push("is-selected");
    }
    card.className = cardClasses.join(" ");
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
          <span class="chip">${asset.layer || "main"}</span>
          ${asset.duration ? `<span class="chip">${asset.duration}s</span>` : ""}
        </div>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-action="show" data-id="${asset.id}">Yayina Ver</button>
        <button class="secondary-button" data-action="edit" data-id="${asset.id}">Duzenle</button>
        <button class="secondary-button" data-action="queue" data-id="${asset.id}">Rundown</button>
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
      if (action === "edit") {
        selectAsset(assetId);
        return;
      }
      if (action === "queue") {
        state.rundown.push(assetId);
        renderRundown();
        renderRemoteLists();
        return;
      }
      if (action === "delete") {
        if (state.selectedAssetId === assetId) {
          state.selectedAssetId = null;
        }
        if (state.activeAssetId === assetId) {
          state.activeAssetId = null;
        }
        state.assets.splice(index, 1);
        persistAssets();
        renderAssetList();
        renderRemoteLists();
        syncQuickEditor();
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

function renderRundown() {
  const rundownList = document.getElementById("rundownList");
  if (!rundownList) {
    return;
  }
  rundownList.innerHTML = "";
  state.rundown.forEach((assetId, index) => {
    const asset = state.assets.find((entry) => entry.id === assetId);
    if (!asset) {
      return;
    }
    const item = document.createElement("article");
    item.className = `asset-card ${index === state.rundownIndex ? "is-current" : ""}`;
    item.innerHTML = `
      <div class="asset-meta">
        <div class="section-head">
          <div class="hotkey-badge">${index + 1}</div>
          <div>
            <h3>${asset.title}</h3>
            <p>${asset.group || "Genel"} • ${asset.layer || "main"}</p>
          </div>
        </div>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-run-action="play" data-index="${index}">Oynat</button>
        <button class="secondary-button" data-run-action="remove" data-index="${index}">Cikar</button>
      </div>
    `;
    rundownList.appendChild(item);
  });

  rundownList.querySelectorAll("button[data-run-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (button.dataset.runAction === "play") {
        playRundownIndex(index);
      } else {
        state.rundown.splice(index, 1);
        if (state.rundownIndex >= state.rundown.length) {
          state.rundownIndex = state.rundown.length - 1;
        }
        renderRundown();
        renderRemoteLists();
      }
    });
  });
}

function renderPresetList() {
  const presetList = document.getElementById("presetList");
  if (!presetList) {
    return;
  }
  presetList.innerHTML = "";
  state.presets.forEach((preset, index) => {
    const item = document.createElement("article");
    item.className = "asset-card";
    item.innerHTML = `
      <div class="asset-meta">
        <div class="section-head">
          <div class="hotkey-badge">${index + 1}</div>
          <div>
            <h3>${preset.name}</h3>
            <p>${preset.sceneName || "Scene yok"} • ${preset.assetTitle || "Kart yok"}</p>
          </div>
        </div>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-preset-action="run" data-index="${index}">Calistir</button>
        <button class="secondary-button" data-preset-action="delete" data-index="${index}">Sil</button>
      </div>
    `;
    presetList.appendChild(item);
  });

  presetList.querySelectorAll("button[data-preset-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.index);
      const preset = state.presets[index];
      if (!preset) {
        return;
      }
      if (button.dataset.presetAction === "delete") {
        state.presets.splice(index, 1);
        persistPresets();
        renderPresetList();
        return;
      }
      await runPreset(preset);
    });
  });
}

function renderRemoteLists() {
  const remoteAssetList = document.getElementById("remoteAssetList");
  const remoteRundownList = document.getElementById("remoteRundownList");
  if (!remoteAssetList || !remoteRundownList) {
    return;
  }

  remoteAssetList.innerHTML = "";
  state.assets.slice(0, 12).forEach((asset) => {
    const item = document.createElement("article");
    item.className = "asset-card";
    item.innerHTML = `
      <div class="asset-meta">
        <h3>${asset.title}</h3>
        <p>${asset.group || "Genel"} • ${asset.layer || "main"}</p>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-remote-asset="${asset.id}">Goster</button>
      </div>
    `;
    remoteAssetList.appendChild(item);
  });

  remoteRundownList.innerHTML = "";
  state.rundown.forEach((assetId, index) => {
    const asset = state.assets.find((entry) => entry.id === assetId);
    if (!asset) {
      return;
    }
    const item = document.createElement("article");
    item.className = `asset-card ${index === state.rundownIndex ? "is-current" : ""}`;
    item.innerHTML = `
      <div class="asset-meta">
        <h3>${asset.title}</h3>
        <p>${asset.group || "Genel"} • ${asset.layer || "main"}</p>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-remote-rundown="${index}">Calistir</button>
      </div>
    `;
    remoteRundownList.appendChild(item);
  });

  remoteAssetList.querySelectorAll("button[data-remote-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      const asset = state.assets.find((entry) => entry.id === button.dataset.remoteAsset);
      if (asset) {
        activateAsset(asset);
      }
    });
  });

  remoteRundownList.querySelectorAll("button[data-remote-rundown]").forEach((button) => {
    button.addEventListener("click", () => {
      playRundownIndex(Number(button.dataset.remoteRundown));
    });
  });
}

function playRundownIndex(index) {
  const assetId = state.rundown[index];
  const asset = state.assets.find((entry) => entry.id === assetId);
  if (!asset) {
    return;
  }
  state.rundownIndex = index;
  activateAsset(asset);
  renderRundown();
  renderRemoteLists();

  clearRundownAutoplayTimer();
  if (state.rundownAutoplayEnabled) {
    const waitSeconds = Math.max(0, Number(asset.duration || 0)) + Math.max(0, Number(state.rundownGapSeconds || 0));
    const hasNext = index < state.rundown.length - 1;
    if (hasNext) {
      state.rundownAutoplayTimer = window.setTimeout(() => {
        nextRundown(1);
      }, Math.max(1, waitSeconds) * 1000);
    } else {
      state.rundownAutoplayEnabled = false;
      updateRundownAutoplayStatus();
    }
  }
}

function nextRundown(step) {
  if (!state.rundown.length) {
    return;
  }
  const nextIndex = Math.min(Math.max(state.rundownIndex + step, 0), state.rundown.length - 1);
  playRundownIndex(nextIndex);
}

function activateAsset(asset) {
  state.activeAssetId = asset.id;
  if (!state.selectedAssetId) {
    state.selectedAssetId = asset.id;
  }
  sendOverlayCommand({
    type: "show",
    payload: asset
  });
  renderAssetList();
  syncQuickEditor();

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
  clearRundownAutoplayTimer();
  sendOverlayCommand({ type: "clear" });
  renderAssetList();
  syncQuickEditor();
}

async function setObsSourceEnabled(enabled) {
  const sceneName = document.getElementById("obsSceneSelect")?.value;
  const sourceName = document.getElementById("obsSourceName")?.value.trim();
  if (!sceneName || !sourceName) {
    updateObsStatus("Scene ve source adi girin");
    return;
  }
  try {
    const list = await obsRequest("GetSceneItemList", { sceneName });
    const item = (list?.responseData?.sceneItems || []).find((entry) => entry.sourceName === sourceName);
    if (!item) {
      throw new Error("Source bulunamadi");
    }
    await obsRequest("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: enabled
    });
    state.obs.currentSourceEnabled = enabled;
    syncObsIndicators();
    updateObsStatus(`${sourceName} ${enabled ? "acildi" : "gizlendi"}`);
  } catch (error) {
    updateObsStatus(`Source islemi olmadi: ${error.message}`);
  }
}

async function refreshObsSourceState() {
  const sceneName = document.getElementById("obsSceneSelect")?.value;
  const sourceName = document.getElementById("obsSourceName")?.value.trim();
  if (!sceneName || !sourceName || !state.obs.connected) {
    state.obs.currentSourceEnabled = null;
    syncObsIndicators();
    return;
  }
  try {
    const list = await obsRequest("GetSceneItemList", { sceneName });
    const item = (list?.responseData?.sceneItems || []).find((entry) => entry.sourceName === sourceName);
    state.obs.currentSourceEnabled = item ? Boolean(item.sceneItemEnabled) : null;
    syncObsIndicators();
  } catch {
    state.obs.currentSourceEnabled = null;
    syncObsIndicators();
  }
}

function savePreset() {
  const sceneName = document.getElementById("obsSceneSelect")?.value || "";
  const sourceName = document.getElementById("obsSourceName")?.value.trim() || "";
  const activeAsset = state.assets.find((asset) => asset.id === state.activeAssetId) || state.assets[0];
  const preset = {
    id: crypto.randomUUID(),
    name: `${sceneName || "Scene"} / ${activeAsset?.title || "Kart"}`,
    sceneName,
    sourceName,
    assetId: activeAsset?.id || "",
    assetTitle: activeAsset?.title || ""
  };
  state.presets.unshift(preset);
  persistPresets();
  renderPresetList();
}

async function runPreset(preset) {
  if (preset.sceneName) {
    const sceneSelect = document.getElementById("obsSceneSelect");
    if (sceneSelect) {
      sceneSelect.value = preset.sceneName;
    }
    await switchObsScene();
  }
  if (preset.sourceName) {
    const sourceInput = document.getElementById("obsSourceName");
    if (sourceInput) {
      sourceInput.value = preset.sourceName;
    }
    await setObsSourceEnabled(true);
  }
  const asset = state.assets.find((entry) => entry.id === preset.assetId);
  if (asset) {
    activateAsset(asset);
  }
}

function updateObsStatus(text) {
  const node = document.getElementById("obsStatus");
  if (node) {
    node.textContent = text;
  }
}

async function sha256Base64(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function obsRequest(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    if (!state.obs.connected || !state.obs.socket) {
      reject(new Error("OBS bagli degil"));
      return;
    }
    const requestId = `req-${++state.obs.messageId}`;
    state.obs.pending.set(requestId, { resolve, reject });
    state.obs.socket.send(
      JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData }
      })
    );
  });
}

async function populateObsScenes() {
  try {
    const response = await obsRequest("GetSceneList");
    const scenes = response?.responseData?.scenes || [];
    state.obs.scenes = scenes;
    const select = document.getElementById("obsSceneSelect");
    select.innerHTML = `<option value="">Scene secin</option>${scenes
      .map((scene) => `<option value="${scene.sceneName}">${scene.sceneName}</option>`)
      .join("")}`;
    if (response?.responseData?.currentProgramSceneName) {
      select.value = response.responseData.currentProgramSceneName;
      state.obs.currentScene = response.responseData.currentProgramSceneName;
    }
    syncObsIndicators();
    updateObsStatus(`OBS bagli • ${scenes.length} scene`);
  } catch (error) {
    updateObsStatus(`Scene okunamadi: ${error.message}`);
  }
}

async function populateObsInputs() {
  try {
    const response = await obsRequest("GetInputList");
    const inputs = response?.responseData?.inputs || [];
    state.obs.inputs = inputs;
    const select = document.getElementById("obsSourceSelect");
    if (!select) {
      return;
    }
    select.innerHTML = `<option value="">Source secin</option>${inputs
      .map((input) => `<option value="${input.inputName}">${input.inputName}</option>`)
      .join("")}`;
    refreshObsSourceState();
  } catch (error) {
    updateObsStatus(`Source listesi okunamadi: ${error.message}`);
  }
}

async function connectObs() {
  const host = document.getElementById("obsHost")?.value.trim() || "127.0.0.1:4455";
  const password = document.getElementById("obsPassword")?.value || "";
  updateObsStatus("OBS baglaniyor...");

  const socket = new WebSocket(`ws://${host}`);
  state.obs.socket = socket;

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    const { op, d } = message;

    if (op === 0) {
      let authentication;
      const auth = d.authentication;
      if (auth?.challenge && auth?.salt) {
        const secret = await sha256Base64(password + auth.salt);
        authentication = await sha256Base64(secret + auth.challenge);
      }

      socket.send(
        JSON.stringify({
          op: 1,
          d: {
            rpcVersion: d.rpcVersion || 1,
            eventSubscriptions: 1023,
            authentication
          }
        })
      );
      return;
    }

    if (op === 2) {
      state.obs.connected = true;
      updateObsStatus("OBS baglandi");
      populateObsScenes();
      populateObsInputs();
      return;
    }

    if (op === 5) {
      const eventType = d.eventType;
      if (eventType === "CurrentProgramSceneChanged") {
        state.obs.currentScene = d.eventData?.sceneName || "";
        const select = document.getElementById("obsSceneSelect");
        if (select && state.obs.currentScene) {
          select.value = state.obs.currentScene;
        }
        syncObsIndicators();
      }
      if (eventType === "SceneItemEnableStateChanged") {
        const selectedScene = document.getElementById("obsSceneSelect")?.value;
        const selectedSource = document.getElementById("obsSourceName")?.value.trim();
        if (
          selectedScene &&
          selectedSource &&
          d.eventData?.sceneName === selectedScene &&
          d.eventData?.sourceName === selectedSource
        ) {
          state.obs.currentSourceEnabled = Boolean(d.eventData?.sceneItemEnabled);
          syncObsIndicators();
        }
      }
      return;
    }

    if (op === 7) {
      const pending = state.obs.pending.get(d.requestId);
      if (!pending) {
        return;
      }
      state.obs.pending.delete(d.requestId);
      if (d.requestStatus?.result) {
        pending.resolve(d);
      } else {
        pending.reject(new Error(d.requestStatus?.comment || "OBS request hatasi"));
      }
    }
  });

  socket.addEventListener("close", () => {
    state.obs.connected = false;
    state.obs.currentScene = "";
    state.obs.currentSourceEnabled = null;
    syncObsIndicators();
    updateObsStatus("OBS baglantisi kapandi");
  });

  socket.addEventListener("error", () => {
    state.obs.connected = false;
    state.obs.currentScene = "";
    state.obs.currentSourceEnabled = null;
    syncObsIndicators();
    updateObsStatus("OBS baglanamadi");
  });
}

async function switchObsScene() {
  const sceneName = document.getElementById("obsSceneSelect")?.value;
  if (!sceneName) {
    updateObsStatus("Scene secin");
    return;
  }
  try {
    await obsRequest("SetCurrentProgramScene", { sceneName });
    state.obs.currentScene = sceneName;
    syncObsIndicators();
    updateObsStatus(`OBS scene aktif: ${sceneName}`);
  } catch (error) {
    updateObsStatus(`Scene gecisi olmadi: ${error.message}`);
  }
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
  state.selectedAssetId = asset.id;
  persistAssets();
  refreshGroupFilter();
  renderAssetList();
  renderRemoteLists();
  clearForm();
  syncQuickEditor();
}

function applyQuickEdit() {
  const asset = getSelectedAsset();
  if (!asset) {
    updateQuickEditStatus("Duzenlenecek kart secili degil.");
    return;
  }

  asset.title = document.getElementById("quickEditTitle")?.value.trim() || asset.title;
  asset.text = document.getElementById("quickEditText")?.value.trim() || "";
  asset.group = document.getElementById("quickEditGroup")?.value.trim() || "Genel";
  asset.duration = Math.max(0, Number(document.getElementById("quickEditDuration")?.value || 0));

  persistAssets();
  refreshGroupFilter();
  renderAssetList();
  renderRundown();
  renderRemoteLists();
  syncQuickEditor();

  if (state.activeAssetId === asset.id) {
    sendOverlayCommand({
      type: "show",
      payload: asset
    });
    updateQuickEditStatus(`Yayindaki kart guncellendi: ${asset.title}`);
  } else {
    updateQuickEditStatus(`Kart guncellendi: ${asset.title}`);
  }
}

function clearQuickEditSelection() {
  state.selectedAssetId = null;
  renderAssetList();
  syncQuickEditor();
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

function toggleRundownAutoplay(forceValue) {
  state.rundownAutoplayEnabled = typeof forceValue === "boolean"
    ? forceValue
    : !state.rundownAutoplayEnabled;

  if (!state.rundownAutoplayEnabled) {
    clearRundownAutoplayTimer();
  } else if (state.rundown.length) {
    const startIndex = state.rundownIndex >= 0 ? state.rundownIndex : 0;
    playRundownIndex(startIndex);
  }

  updateRundownAutoplayStatus();
}

function setupDeckMode() {
  loadAssets();
  loadPresets();
  refreshGroupFilter();
  renderAssetList();
  renderRundown();
  renderPresetList();
  renderRemoteLists();
  updateRundownAutoplayStatus();
  syncObsIndicators();
  syncQuickEditor();

  document.getElementById("saveAsset").addEventListener("click", addAssetFromForm);
  document.getElementById("clearForm").addEventListener("click", clearForm);
  document.getElementById("clearAllAssets").addEventListener("click", () => {
    state.assets = [];
    persistAssets();
    renderAssetList();
    renderRemoteLists();
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
  document.getElementById("obsConnect")?.addEventListener("click", connectObs);
  document.getElementById("obsRefreshScenes")?.addEventListener("click", () => {
    populateObsScenes();
    populateObsInputs();
  });
  document.getElementById("obsSceneSelect")?.addEventListener("change", (event) => {
    state.obs.currentScene = event.target.value;
    syncObsIndicators();
    refreshObsSourceState();
  });
  document.getElementById("obsSourceSelect")?.addEventListener("change", (event) => {
    document.getElementById("obsSourceName").value = event.target.value;
    refreshObsSourceState();
  });
  document.getElementById("obsSourceName")?.addEventListener("input", refreshObsSourceState);
  document.getElementById("obsSwitchScene")?.addEventListener("click", switchObsScene);
  document.getElementById("obsShowSource")?.addEventListener("click", () => setObsSourceEnabled(true));
  document.getElementById("obsHideSource")?.addEventListener("click", () => setObsSourceEnabled(false));
  document.getElementById("clearRundown")?.addEventListener("click", () => {
    state.rundown = [];
    state.rundownIndex = -1;
    toggleRundownAutoplay(false);
    renderRundown();
    renderRemoteLists();
  });
  document.getElementById("rundownNext")?.addEventListener("click", () => nextRundown(1));
  document.getElementById("rundownPrev")?.addEventListener("click", () => nextRundown(-1));
  document.getElementById("rundownAutoToggle")?.addEventListener("click", () => toggleRundownAutoplay());
  document.getElementById("rundownGapSeconds")?.addEventListener("input", (event) => {
    state.rundownGapSeconds = Math.max(0, Number(event.target.value || 0));
    updateRundownAutoplayStatus();
  });
  document.getElementById("savePreset")?.addEventListener("click", savePreset);
  document.getElementById("quickEditApply")?.addEventListener("click", applyQuickEdit);
  document.getElementById("quickEditShow")?.addEventListener("click", () => {
    const asset = getSelectedAsset();
    if (asset) {
      activateAsset(asset);
    }
  });
  document.getElementById("quickEditClear")?.addEventListener("click", clearQuickEditSelection);

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
    if (event.key === "Enter") {
      nextRundown(1);
    }
  });

  channel.postMessage({ type: "sync-request" });
}

function setupRemoteMode() {
  loadAssets();
  loadPresets();
  document.getElementById("deckApp").hidden = true;
  document.getElementById("remoteApp").hidden = false;
  renderRemoteLists();
  updateRundownAutoplayStatus();

  document.getElementById("remoteNext")?.addEventListener("click", () => nextRundown(1));
  document.getElementById("remoteAutoToggle")?.addEventListener("click", () => toggleRundownAutoplay());
  document.getElementById("remoteClear")?.addEventListener("click", clearOverlay);

  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      clearOverlay();
    }
    if (event.key === "Enter") {
      nextRundown(1);
    }
  });
}

function hideAllOverlayMedia() {
  document.getElementById("overlayImage").style.display = "none";
  document.getElementById("backgroundImage").style.display = "none";
  const video = document.getElementById("overlayVideo");
  const backgroundVideo = document.getElementById("backgroundVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.style.display = "none";
  backgroundVideo.pause();
  backgroundVideo.removeAttribute("src");
  backgroundVideo.load();
  backgroundVideo.style.display = "none";
}

function clearOverlayView() {
  document.getElementById("backgroundCard").classList.add("is-hidden");
  document.getElementById("overlayCard").classList.add("is-hidden");
  document.getElementById("lowerThirdCard").classList.add("is-hidden");
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
  const backgroundCard = document.getElementById("backgroundCard");
  const overlayCard = document.getElementById("overlayCard");
  const lowerThirdCard = document.getElementById("lowerThirdCard");
  const tickerBar = document.getElementById("tickerBar");
  const backgroundTitle = document.getElementById("backgroundTitle");
  const backgroundText = document.getElementById("backgroundText");
  const backgroundEyebrow = document.getElementById("backgroundEyebrow");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const overlayEyebrow = document.getElementById("overlayEyebrow");
  const lowerThirdTitle = document.getElementById("lowerThirdTitle");
  const lowerThirdText = document.getElementById("lowerThirdText");
  const lowerThirdEyebrow = document.getElementById("lowerThirdEyebrow");
  const backgroundImage = document.getElementById("backgroundImage");
  const backgroundVideo = document.getElementById("backgroundVideo");
  const overlayImage = document.getElementById("overlayImage");
  const overlayVideo = document.getElementById("overlayVideo");
  const tickerContent = document.getElementById("tickerContent");
  const countdownBox = document.getElementById("countdownBox");
  const targetLayer = asset.layer || (asset.type === "ticker" ? "lower-third" : "main");

  tickerBar.classList.add("is-hidden");
  countdownBox.classList.add("is-hidden");

  if (targetLayer === "background") {
    backgroundCard.className = `overlay-card overlay-background theme-${asset.theme} transition-${asset.transition || "fade"}`;
    backgroundEyebrow.textContent = asset.type === "break" ? "Mola" : "Arka Plan";
    backgroundTitle.textContent = asset.title || "";
    backgroundText.textContent = asset.text || "";
    backgroundImage.style.display = "none";
    backgroundVideo.pause();
    backgroundVideo.removeAttribute("src");
    backgroundVideo.load();
  } else if (targetLayer === "lower-third" && asset.type !== "ticker") {
    lowerThirdCard.className = `overlay-card overlay-lower-third theme-${asset.theme} transition-${asset.transition || "fade"}`;
    lowerThirdEyebrow.textContent = "Canli Bilgi";
    lowerThirdTitle.textContent = asset.title || "";
    lowerThirdText.textContent = asset.text || "";
  } else {
    overlayCard.className = `overlay-card theme-${asset.theme} transition-${asset.transition || "fade"}`;
    overlayEyebrow.textContent = asset.type === "break" ? "Mola" : "Canli Yayin";
    overlayTitle.textContent = asset.title || "";
    overlayText.textContent = asset.text || "";
    overlayImage.style.display = "none";
    overlayVideo.pause();
    overlayVideo.removeAttribute("src");
    overlayVideo.load();
  }

  if (asset.type === "ticker") {
    tickerContent.textContent = asset.text || asset.title || "";
    tickerBar.classList.remove("is-hidden");
    return;
  }

  if (asset.type === "countdown") {
    if (targetLayer === "main") {
      overlayCard.classList.add("is-hidden");
    }
    startCountdown(asset);
    return;
  }

  if (asset.mediaUrl) {
    if (asset.type === "video") {
      const targetVideo = targetLayer === "background" ? backgroundVideo : overlayVideo;
      targetVideo.src = asset.mediaUrl;
      targetVideo.style.display = "block";
      targetVideo.muted = true;
      targetVideo.autoplay = true;
      targetVideo.loop = true;
      targetVideo.play().catch(() => {});
    } else {
      const targetImage = targetLayer === "background" ? backgroundImage : overlayImage;
      targetImage.src = asset.mediaUrl;
      targetImage.style.display = "block";
    }
  }

  if (targetLayer === "background") {
    backgroundCard.classList.remove("is-hidden");
  } else if (targetLayer === "lower-third") {
    lowerThirdCard.classList.remove("is-hidden");
  } else {
    overlayCard.classList.remove("is-hidden");
  }
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
} else if (isRemoteMode) {
  setupRemoteMode();
} else {
  setupDeckMode();
}
