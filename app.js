const STORAGE_KEY = "stream-overlay-deck-assets-v1";
const PRESET_STORAGE_KEY = "stream-overlay-deck-presets-v1";
const TEMPLATE_STORAGE_KEY = "stream-overlay-deck-templates-v1";
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

const lowerThirdQuickTemplates = {
  guest: {
    title: "Konuk Adi",
    text: "Gorev / Unvan",
    theme: "minimal",
    group: "Lower Third",
    transition: "slide-up",
    layer: "lower-third"
  },
  topic: {
    title: "Bugunun Konusu",
    text: "Ana baslik veya tartisma maddesi",
    theme: "neon",
    group: "Lower Third",
    transition: "slide-up",
    layer: "lower-third"
  },
  cta: {
    title: "Bizi Takip Edin",
    text: "@kanaladi • abone ol • bildirimleri ac",
    theme: "minimal",
    group: "CTA",
    transition: "fade",
    layer: "lower-third"
  },
  breaking: {
    title: "Son Dakika",
    text: "Yeni gelisme ekrana geliyor",
    theme: "warm",
    group: "Breaking",
    transition: "zoom",
    layer: "lower-third"
  }
};

const state = {
  assets: [],
  activeAssetId: null,
  selectedAssetId: null,
  deferredPrompt: null,
  activeGroup: "all",
  activePresetScene: "all",
  countdownTimer: null,
  rundownAutoplayTimer: null,
  rundownAutoplayEnabled: false,
  rundownGapSeconds: 3,
  overlayAudioContext: null,
  rundown: [],
  rundownIndex: -1,
  presets: [],
  templates: [],
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

function loadTemplates() {
  const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
  if (!raw) {
    state.templates = [];
    return;
  }
  try {
    state.templates = JSON.parse(raw);
  } catch {
    state.templates = [];
  }
}

function persistAssets() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.assets));
}

function persistPresets() {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.presets));
}

function refreshPresetSceneFilter() {
  const select = document.getElementById("presetSceneFilter");
  if (!select) {
    return;
  }
  const scenes = [...new Set(state.presets.map((preset) => preset.sceneName || "Scene yok"))].sort();
  const previous = state.activePresetScene;
  select.innerHTML = `<option value="all">Tum Scene'ler</option>${scenes
    .map((scene) => `<option value="${scene}">${scene}</option>`)
    .join("")}`;
  if (previous !== "all" && scenes.includes(previous)) {
    select.value = previous;
  } else {
    select.value = "all";
    state.activePresetScene = "all";
  }

  syncPresetSceneFilterToCurrentScene();
}

function persistTemplates() {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(state.templates));
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

function updateTickerLiveStatus(text) {
  const node = document.getElementById("tickerLiveStatus");
  if (node) {
    node.textContent = text;
  }
}

function updateLowerThirdQuickStatus(text) {
  const node = document.getElementById("lowerThirdQuickStatus");
  if (node) {
    node.textContent = text;
  }
}

function syncPresetSceneFilterToCurrentScene(force = false) {
  const currentScene = state.obs.currentScene || "";
  const select = document.getElementById("presetSceneFilter");
  if (!select || !currentScene) {
    return;
  }
  const options = [...select.options].map((option) => option.value);
  if (!options.includes(currentScene)) {
    return;
  }
  if (force || state.activePresetScene === "all" || state.activePresetScene === "") {
    state.activePresetScene = currentScene;
    select.value = currentScene;
    renderPresetList();
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

function fillFormFromAsset(asset) {
  document.getElementById("assetType").value = asset.type || "slide";
  document.getElementById("assetTitle").value = asset.title || "";
  document.getElementById("assetText").value = asset.text || "";
  document.getElementById("assetMedia").value = asset.mediaUrl || "";
  document.getElementById("assetTheme").value = asset.theme || "neon";
  document.getElementById("assetDuration").value = String(asset.duration || 0);
  document.getElementById("assetGroup").value = asset.group || "";
  document.getElementById("assetTransition").value = asset.transition || "fade";
  document.getElementById("assetLayer").value = asset.layer || "main";
  document.getElementById("assetFile").value = "";
}

function createLowerThirdFromTemplate(templateKey) {
  const template = lowerThirdQuickTemplates[templateKey];
  if (!template) {
    return;
  }
  const asset = {
    id: crypto.randomUUID(),
    type: "slide",
    mediaUrl: "",
    duration: 0,
    ...template
  };
  state.assets.unshift(asset);
  state.selectedAssetId = asset.id;
  persistAssets();
  refreshGroupFilter();
  renderAssetList();
  renderRemoteLists();
  syncQuickEditor();
  fillFormFromAsset(asset);
  activateAsset(asset);
  updateLowerThirdQuickStatus(`Hazir lower-third yayina verildi: ${asset.title}`);
}

function cloneAsset(asset, overrides = {}) {
  return {
    ...asset,
    ...overrides,
    id: crypto.randomUUID()
  };
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
        <button class="secondary-button" data-action="duplicate" data-id="${asset.id}">Kopyala</button>
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
      if (action === "duplicate") {
        const copy = cloneAsset(state.assets[index], {
          title: `${state.assets[index].title} Kopya`
        });
        state.assets.unshift(copy);
        state.selectedAssetId = copy.id;
        persistAssets();
        refreshGroupFilter();
        renderAssetList();
        renderRemoteLists();
        syncQuickEditor();
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
  const favoritePresetBar = document.getElementById("favoritePresetBar");
  if (!presetList) {
    return;
  }
  presetList.innerHTML = "";
  if (favoritePresetBar) {
    favoritePresetBar.innerHTML = "";
  }

  const visiblePresets = state.activePresetScene === "all"
    ? state.presets
    : state.presets.filter((preset) => (preset.sceneName || "Scene yok") === state.activePresetScene);

  const favoritePresets = visiblePresets.filter((preset) => preset.favorite);
  if (favoritePresetBar) {
    if (!favoritePresets.length) {
      favoritePresetBar.innerHTML = `<article class="asset-card"><div class="asset-meta"><h3>Favori preset yok</h3><p>Yildiz ile favoriye alip hizli bar'da gosterebilirsiniz.</p></div></article>`;
    } else {
      favoritePresets.forEach((preset) => {
        const originalIndex = state.presets.findIndex((entry) => entry.id === preset.id);
        const item = document.createElement("article");
        item.className = "asset-card is-favorite";
        item.innerHTML = `
          <div class="asset-meta">
            <h3>${preset.name}</h3>
            <p>${preset.sceneName || "Scene yok"} • ${preset.assetTitle || "Kart yok"}</p>
          </div>
          <div class="asset-actions">
            <button class="primary-button" data-favorite-preset-run="${originalIndex}">Calistir</button>
          </div>
        `;
        favoritePresetBar.appendChild(item);
      });
    }
  }

  visiblePresets.forEach((preset) => {
    const index = state.presets.findIndex((entry) => entry.id === preset.id);
    const item = document.createElement("article");
    item.className = `asset-card ${preset.favorite ? "is-favorite" : ""}`;
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
        <button class="secondary-button" data-preset-action="favorite" data-index="${index}">${preset.favorite ? "Yildizi Kaldir" : "Favori"}</button>
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
      if (button.dataset.presetAction === "favorite") {
        preset.favorite = !preset.favorite;
        persistPresets();
        refreshPresetSceneFilter();
        renderPresetList();
        return;
      }
      if (button.dataset.presetAction === "delete") {
        state.presets.splice(index, 1);
        persistPresets();
        refreshPresetSceneFilter();
        renderPresetList();
        return;
      }
      await runPreset(preset);
    });
  });

  favoritePresetBar?.querySelectorAll("button[data-favorite-preset-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      const preset = state.presets[Number(button.dataset.favoritePresetRun)];
      if (preset) {
        await runPreset(preset);
      }
    });
  });
}

function renderTemplateList() {
  const templateList = document.getElementById("templateList");
  if (!templateList) {
    return;
  }
  templateList.innerHTML = "";
  if (!state.templates.length) {
    templateList.innerHTML = `<article class="asset-card"><div class="asset-meta"><h3>Henuz sablon yok</h3><p>Secili karttan sablon kaydederek tekrar kullanilabilir formatlar olusturun.</p></div></article>`;
    return;
  }

  state.templates.forEach((template, index) => {
    const item = document.createElement("article");
    item.className = "asset-card";
    item.innerHTML = `
      <div class="asset-meta">
        <div class="section-head">
          <div class="hotkey-badge">${index + 1}</div>
          <div>
            <h3>${template.name}</h3>
            <p>${template.type} • ${template.group || "Genel"} • ${template.layer || "main"}</p>
          </div>
        </div>
      </div>
      <div class="asset-actions">
        <button class="primary-button" data-template-action="use" data-index="${index}">Forma Doldur</button>
        <button class="secondary-button" data-template-action="create" data-index="${index}">Kart Uret</button>
        <button class="secondary-button" data-template-action="delete" data-index="${index}">Sil</button>
      </div>
    `;
    templateList.appendChild(item);
  });

  templateList.querySelectorAll("button[data-template-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const template = state.templates[index];
      if (!template) {
        return;
      }
      if (button.dataset.templateAction === "delete") {
        state.templates.splice(index, 1);
        persistTemplates();
        renderTemplateList();
        return;
      }
      if (button.dataset.templateAction === "use") {
        fillFormFromAsset(template);
        updateQuickEditStatus(`Sablon forma dolduruldu: ${template.name}`);
        return;
      }
      const asset = cloneAsset(template, {
        title: `${template.title} Yeni`
      });
      state.assets.unshift(asset);
      state.selectedAssetId = asset.id;
      persistAssets();
      refreshGroupFilter();
      renderAssetList();
      renderRemoteLists();
      syncQuickEditor();
      updateQuickEditStatus(`Sablondan yeni kart olustu: ${asset.title}`);
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
    assetTitle: activeAsset?.title || "",
    favorite: false
  };
  state.presets.unshift(preset);
  persistPresets();
  refreshPresetSceneFilter();
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
    syncPresetSceneFilterToCurrentScene(true);
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
        syncPresetSceneFilterToCurrentScene(true);
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
  syncTickerEditor();
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
  syncTickerEditor();

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
  syncTickerEditor();
}

function getActiveTickerAsset() {
  return state.assets.find((asset) => asset.id === state.activeAssetId && asset.type === "ticker") || null;
}

function getFirstTickerAsset() {
  return state.assets.find((asset) => asset.type === "ticker") || null;
}

function syncTickerEditor() {
  const tickerField = document.getElementById("tickerLiveText");
  if (!tickerField) {
    return;
  }
  const activeTicker = getActiveTickerAsset();
  const fallbackTicker = getFirstTickerAsset();
  const ticker = activeTicker || fallbackTicker;
  tickerField.value = ticker?.text || ticker?.title || "";
}

function applyLiveTickerUpdate() {
  const text = document.getElementById("tickerLiveText")?.value.trim() || "";
  if (!text) {
    updateTickerLiveStatus("Ticker metni bos olamaz.");
    return;
  }

  let ticker = getActiveTickerAsset() || getFirstTickerAsset();
  if (!ticker) {
    ticker = {
      id: crypto.randomUUID(),
      type: "ticker",
      title: "Canli Ticker",
      text,
      mediaUrl: "",
      theme: "minimal",
      duration: 0,
      group: "Alt Bant",
      transition: "fade",
      layer: "lower-third"
    };
    state.assets.unshift(ticker);
  } else {
    ticker.text = text;
    ticker.title = ticker.title || "Canli Ticker";
  }

  state.selectedAssetId = ticker.id;
  persistAssets();
  refreshGroupFilter();
  renderAssetList();
  renderRemoteLists();
  syncQuickEditor();
  syncTickerEditor();
  activateAsset(ticker);
  updateTickerLiveStatus("Ticker yayinda guncellendi.");
}

function clearLiveTicker() {
  document.getElementById("tickerLiveText").value = "";
  const activeTicker = getActiveTickerAsset();
  if (activeTicker) {
    clearOverlay();
  }
  updateTickerLiveStatus("Ticker temizlendi.");
}

function exportRundown() {
  const payload = {
    exportedAt: new Date().toISOString(),
    rundown: state.rundown,
    assets: state.assets.filter((asset) => state.rundown.includes(asset.id))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "stream-overlay-rundown.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function mergeImportedAssets(importedAssets = []) {
  const idMap = new Map();
  importedAssets.forEach((asset) => {
    const copy = cloneAsset(asset);
    idMap.set(asset.id, copy.id);
    state.assets.push(copy);
  });
  return idMap;
}

async function importRundownFromFile(file) {
  if (!file) {
    return;
  }
  const raw = await file.text();
  const payload = JSON.parse(raw);
  const importedAssets = Array.isArray(payload.assets) ? payload.assets : [];
  const importedRundown = Array.isArray(payload.rundown) ? payload.rundown : [];
  const idMap = mergeImportedAssets(importedAssets);
  const nextRundownIds = importedRundown
    .map((oldId) => idMap.get(oldId))
    .filter(Boolean);

  state.rundown = nextRundownIds;
  state.rundownIndex = -1;
  persistAssets();
  refreshGroupFilter();
  renderAssetList();
  renderRundown();
  renderRemoteLists();
  updateQuickEditStatus(`Rundown ice aktarıldi: ${nextRundownIds.length} oge`);
}

function saveSelectedAsTemplate() {
  const asset = getSelectedAsset();
  if (!asset) {
    updateQuickEditStatus("Sablon kaydetmek icin once bir kart secin.");
    return;
  }
  const template = {
    ...asset,
    id: crypto.randomUUID(),
    name: `${asset.title} Sablon`
  };
  state.templates.unshift(template);
  persistTemplates();
  renderTemplateList();
  updateQuickEditStatus(`Sablon kaydedildi: ${template.name}`);
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
  loadTemplates();
  refreshGroupFilter();
  refreshPresetSceneFilter();
  renderAssetList();
  renderRundown();
  renderPresetList();
  renderTemplateList();
  renderRemoteLists();
  updateRundownAutoplayStatus();
  syncObsIndicators();
  syncQuickEditor();
  syncTickerEditor();

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
  document.getElementById("presetSceneFilter")?.addEventListener("change", (event) => {
    state.activePresetScene = event.target.value;
    renderPresetList();
  });
  document.querySelectorAll("[data-lower-third-template]").forEach((button) => {
    button.addEventListener("click", () => {
      createLowerThirdFromTemplate(button.dataset.lowerThirdTemplate);
    });
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
  document.getElementById("exportRundown")?.addEventListener("click", exportRundown);
  document.getElementById("importRundownFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      await importRundownFromFile(file);
    } catch {
      updateQuickEditStatus("Rundown dosyasi okunamadi.");
    } finally {
      event.target.value = "";
    }
  });
  document.getElementById("rundownNext")?.addEventListener("click", () => nextRundown(1));
  document.getElementById("rundownPrev")?.addEventListener("click", () => nextRundown(-1));
  document.getElementById("rundownAutoToggle")?.addEventListener("click", () => toggleRundownAutoplay());
  document.getElementById("rundownGapSeconds")?.addEventListener("input", (event) => {
    state.rundownGapSeconds = Math.max(0, Number(event.target.value || 0));
    updateRundownAutoplayStatus();
  });
  document.getElementById("savePreset")?.addEventListener("click", savePreset);
  document.getElementById("saveTemplate")?.addEventListener("click", saveSelectedAsTemplate);
  document.getElementById("quickEditApply")?.addEventListener("click", applyQuickEdit);
  document.getElementById("quickEditShow")?.addEventListener("click", () => {
    const asset = getSelectedAsset();
    if (asset) {
      activateAsset(asset);
    }
  });
  document.getElementById("quickEditClear")?.addEventListener("click", clearQuickEditSelection);
  document.getElementById("tickerLiveApply")?.addEventListener("click", applyLiveTickerUpdate);
  document.getElementById("tickerLiveClear")?.addEventListener("click", clearLiveTicker);

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
