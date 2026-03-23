const $ = (id) => document.getElementById(id);

const outputEl = $("output");
const namingTemplateInput = $("namingTemplate");
const folderTemplateInput = $("folderTemplate");
const openAiModelSelect = $("openAiModel");
const refreshModelsBtn = $("refreshModelsBtn");
const saveSettingsBtn = $("saveSettingsBtn");
const organizeBtn = $("organizeBtn");
const stopOrganizeBtn = $("stopOrganizeBtn");
const stopOrganizeTopBtn = $("stopOrganizeTopBtn");
const runStatusEl = $("runStatus");
const buildInfoEl = $("buildInfo");
const reviewFilePathEl = $("reviewFilePath");
const loadReviewBtn = $("loadReviewBtn");
const applyReviewBtn = $("applyReviewBtn");
const reviewStatusEl = $("reviewStatus");
const reviewSourceEl = $("reviewSource");
const reviewDestinationEl = $("reviewDestination");
const reviewReasonEl = $("reviewReason");
const reviewDecisionActionEl = $("reviewDecisionAction");
const reviewCustomDestinationEl = $("reviewCustomDestination");
const reviewPositionEl = $("reviewPosition");
const prevReviewBtn = $("prevReviewBtn");
const nextReviewBtn = $("nextReviewBtn");
const saveReviewDecisionBtn = $("saveReviewDecisionBtn");

// Modal elements
const settingsBtn = $("settingsBtn");
const settingsModal = $("settingsModal");
const manualReviewModal = $("manualReviewModal");
const workspaceEl = $("workspace");
const leftColumnResizer = $("leftColumnResizer");
const rightColumnResizer = $("rightColumnResizer");

const SETTINGS_KEY = "aon.web.settings.v1";

// Modal and Tab Management
function showModal(modal) {
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function hideModal(modal) {
  modal.classList.remove("active");
  document.body.style.overflow = "";
}

function setupModalHandlers(modal) {
  const closeButtons = modal.querySelectorAll(".close-btn, .close-btn-alt");
  const overlay = modal.querySelector(".modal-overlay");
  
  closeButtons.forEach(btn => {
    btn.addEventListener("click", () => hideModal(modal));
  });
  
  if (overlay) {
    overlay.addEventListener("click", () => hideModal(modal));
  }
}

function setStopButtonsDisabled(disabled) {
  stopOrganizeBtn.disabled = disabled;
  if (stopOrganizeTopBtn) {
    stopOrganizeTopBtn.disabled = disabled;
  }
}

function setupColumnResizers() {
  if (!workspaceEl || !leftColumnResizer || !rightColumnResizer) return;

  const minSide = 180;
  const minCenter = 420;

  const clampWidths = (left, right) => {
    const available = workspaceEl.clientWidth - 16;
    const maxSidesTotal = Math.max(minSide * 2, available - minCenter);
    let safeLeft = Math.max(minSide, left);
    let safeRight = Math.max(minSide, right);
    const total = safeLeft + safeRight;
    if (total > maxSidesTotal) {
      const overflow = total - maxSidesTotal;
      if (safeLeft >= safeRight) {
        safeLeft = Math.max(minSide, safeLeft - overflow);
      } else {
        safeRight = Math.max(minSide, safeRight - overflow);
      }
    }
    return { left: safeLeft, right: safeRight };
  };

  const applyWidths = (left, right) => {
    const safe = clampWidths(left, right);
    workspaceEl.style.setProperty("--left-panel-width", `${safe.left}px`);
    workspaceEl.style.setProperty("--right-panel-width", `${safe.right}px`);
  };

  const getCurrentWidths = () => {
    const styles = getComputedStyle(workspaceEl);
    return {
      left: Number.parseFloat(styles.getPropertyValue("--left-panel-width")) || 280,
      right: Number.parseFloat(styles.getPropertyValue("--right-panel-width")) || 280,
    };
  };

  const startDrag = (side, event) => {
    if (window.matchMedia("(max-width: 1100px)").matches) return;

    const startX = event.clientX;
    const startWidths = getCurrentWidths();
    const target = side === "left" ? leftColumnResizer : rightColumnResizer;
    target.classList.add("is-dragging");
    document.body.style.userSelect = "none";

    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (side === "left") {
        applyWidths(startWidths.left + delta, startWidths.right);
      } else {
        applyWidths(startWidths.left, startWidths.right - delta);
      }
    };

    const onUp = () => {
      target.classList.remove("is-dragging");
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  leftColumnResizer.addEventListener("pointerdown", (event) => startDrag("left", event));
  rightColumnResizer.addEventListener("pointerdown", (event) => startDrag("right", event));

  window.addEventListener("resize", () => {
    const current = getCurrentWidths();
    applyWidths(current.left, current.right);
  });
}

setupModalHandlers(settingsModal);
setupModalHandlers(manualReviewModal);
setupColumnResizers();

settingsBtn.addEventListener("click", () => showModal(settingsModal));

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    
    // Remove active class from all tabs and contents
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    
    // Add active class to clicked tab and corresponding content
    btn.classList.add("active");
    const content = $(`tab-${tabName}`);
    if (content) {
      content.classList.add("active");
    }
  });
});

let activeOrganizeController = null;
let organizeActions = [];

let activeTemplateInput = namingTemplateInput;
const reviewState = {
  reviewFilePath: "",
  items: [],
  index: 0,
  decisions: new Map(),
};

function setActiveTemplateInput(inputEl) {
  activeTemplateInput = inputEl;
}

function insertTokenIntoInput(inputEl, token) {
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  inputEl.value = `${inputEl.value.slice(0, start)}${token}${inputEl.value.slice(end)}`;
  const nextPos = start + token.length;
  inputEl.setSelectionRange(nextPos, nextPos);
  inputEl.focus();
}

namingTemplateInput.addEventListener("focus", () => setActiveTemplateInput(namingTemplateInput));
folderTemplateInput.addEventListener("focus", () => setActiveTemplateInput(folderTemplateInput));

document.querySelectorAll(".token-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const token = button.dataset.token;
    if (!token) return;
    insertTokenIntoInput(activeTemplateInput || namingTemplateInput, token);
  });
});

function selectedProviders() {
  return Array.from(document.querySelectorAll(".provider"))
    .filter((el) => el.checked)
    .map((el) => el.value);
}

function appendOutput(title, data) {
  const stamp = new Date().toLocaleTimeString();
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  outputEl.textContent = `[${stamp}] ${title}\n${payload}\n\n${outputEl.textContent}`;
}

function setRunStatus(text) {
  runStatusEl.textContent = text;
}

function setReviewStatus(text) {
  reviewStatusEl.textContent = text;
}

function currentReviewItem() {
  if (!reviewState.items.length) return null;
  return reviewState.items[reviewState.index] || null;
}

function renderReviewItem() {
  const item = currentReviewItem();
  if (!item) {
    reviewSourceEl.textContent = "";
    reviewDestinationEl.textContent = "";
    reviewReasonEl.textContent = "";
    reviewPositionEl.textContent = "0/0";
    reviewCustomDestinationEl.value = "";
    $("reviewMetadata").innerHTML = "";
    return;
  }

  reviewSourceEl.textContent = item.source || "";
  reviewDestinationEl.textContent = item.proposedDestination || "";
  reviewReasonEl.textContent = item.reason || "";
  reviewPositionEl.textContent = `${reviewState.index + 1} of ${reviewState.items.length}`;

  // Render metadata beautifully
  const metadata = item.metadata;
  if (metadata) {
    const metadataHTML = `
      <div class="metadata-row">
        <span class="metadata-label">Title:</span>
        <span class="metadata-value">${escapeHtml(metadata.title || "—")}</span>
      </div>
      ${metadata.authors ? `<div class="metadata-row">
        <span class="metadata-label">Authors:</span>
        <span class="metadata-value">${escapeHtml(metadata.authors.join(", "))}</span>
      </div>` : ""}
      ${metadata.narrators ? `<div class="metadata-row">
        <span class="metadata-label">Narrators:</span>
        <span class="metadata-value">${escapeHtml(metadata.narrators.join(", "))}</span>
      </div>` : ""}
      ${metadata.series ? `<div class="metadata-row">
        <span class="metadata-label">Series:</span>
        <span class="metadata-value">${escapeHtml(metadata.series)}</span>
      </div>` : ""}
      ${metadata.publishedYear ? `<div class="metadata-row">
        <span class="metadata-label">Year:</span>
        <span class="metadata-value">${escapeHtml(metadata.publishedYear)}</span>
      </div>` : ""}
      ${metadata.genres ? `<div class="metadata-row">
        <span class="metadata-label">Genres:</span>
        <span class="metadata-value">${escapeHtml(metadata.genres.join(", "))}</span>
      </div>` : ""}
      ${metadata.isbn ? `<div class="metadata-row">
        <span class="metadata-label">ISBN:</span>
        <span class="metadata-value">${escapeHtml(metadata.isbn)}</span>
      </div>` : ""}
      ${metadata.description ? `<div class="metadata-row" style="grid-column: 1 / -1;">
        <span class="metadata-label">Description:</span>
        <span class="metadata-value">${escapeHtml(metadata.description)}</span>
      </div>` : ""}
    `;
    $("reviewMetadata").innerHTML = metadataHTML;
  }

  const saved = reviewState.decisions.get(item.source);
  reviewDecisionActionEl.value = saved?.action || "approve";
  reviewCustomDestinationEl.value = saved?.destination || "";
  
  // Show the modal when rendering an item
  if (reviewState.items.length > 0) {
    showModal(manualReviewModal);
  }
}

function escapeHtml(text) {
  if (!text) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function saveCurrentDecision() {
  const item = currentReviewItem();
  if (!item) return;

  const action = reviewDecisionActionEl.value;
  const destination = reviewCustomDestinationEl.value.trim();

  const decision = {
    source: item.source,
    action,
  };

  if (action === "custom_destination" && destination) {
    decision.destination = destination;
  }

  reviewState.decisions.set(item.source, decision);
  setReviewStatus(`Saved decision for ${item.source}`);
}

async function loadReviewFile(path) {
  const payload = path ? { reviewFilePath: path } : {};
  const result = await postJson("/manual-review/load", payload);
  reviewState.reviewFilePath = result.reviewFilePath;
  reviewState.items = Array.isArray(result.items) ? result.items : [];
  reviewState.index = 0;
  reviewState.decisions = new Map();
  reviewFilePathEl.value = result.reviewFilePath || "";
  if (result.isRunning) {
    setReviewStatus(`Live queue: ${reviewState.items.length} item(s) and growing...`);
  } else {
    setReviewStatus(`Loaded ${reviewState.items.length} review item(s).`);
  }
  renderReviewItem();
}

// Folder hierarchy rendering
function buildScanTree(files) {
  const tree = {};
  
  if (!Array.isArray(files)) return tree;
  
  files.forEach(file => {
    const author = file.guessedAuthor || "Unknown Author";
    const title = file.guessedTitle || "Unknown Title";
    
    if (!tree[author]) tree[author] = {};
    if (!tree[author][title]) tree[author][title] = [];
    tree[author][title].push(file);
  });
  
  return tree;
}

function renderScanTree(files) {
  const container = $("scanTree");
  const tree = buildScanTree(files);
  
  if (!files || files.length === 0) {
    container.innerHTML = '<p class="placeholder">Run a scan to see files grouped by detected author/title</p>';
    $("scanCount").textContent = "0 files";
    return;
  }
  
  let html = '';
  for (const author in tree) {
    html += `<div class="tree-item"><div class="tree-item-name">📁 ${escapeHtml(author)}</div>`;
    for (const title in tree[author]) {
      const items = tree[author][title];
      html += `<div class="tree-item" style="margin-left: 24px"><div class="tree-item-name">📖 ${escapeHtml(title)} (${items.length})</div>`;
      for (const file of items) {
        html += `<div class="tree-item" style="margin-left: 40px"><span class="tree-item-name">📄 ${escapeHtml(file.fileName)}</span></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }
  
  container.innerHTML = html;
  $("scanCount").textContent = `${files.length} files`;
}

function buildOrganizeTree(actions) {
  const tree = {};
  
  if (!Array.isArray(actions)) return tree;
  
  actions.forEach(action => {
    const dest = action.destination || "Skipped";
    const source = action.source || "Unknown";
    
    if (!tree[dest]) tree[dest] = [];
    tree[dest].push({ source, status: action.status || 'pending', reason: action.reason });
  });
  
  return tree;
}

function renderOrganizeTree(actions) {
  const container = $("organizeTree");
  const tree = buildOrganizeTree(actions);
  
  if (!actions || actions.length === 0) {
    container.innerHTML = '<p class="placeholder">Organize results will appear here</p>';
    $("organizeCount").textContent = "0 actions";
    return;
  }
  
  let html = '';
  let count = 0;
  
  for (const dest in tree) {
    const items = tree[dest];
    const statusIcons = {
      "moved": "✓",
      "skipped": "◯",
      "manual_review": "❓",
      "pending": "⋯"
    };
    
    html += `<div class="tree-item"><div class="tree-item-name">📁 ${escapeHtml(dest.split("/").pop() || dest)}</div>`;
    for (const item of items) {
      const icon = statusIcons[item.status] || "•";
      html += `<div class="tree-item" style="margin-left: 24px"><span class="tree-item-name">${icon} ${escapeHtml(item.source.split("/").pop() || item.source)}</span></div>`;
      count++;
    }
    html += '</div>';
  }
  
  container.innerHTML = html;
  $("organizeCount").textContent = `${count} actions`;
}

async function applyReviewDecisions() {
  if (!reviewState.items.length) {
    setReviewStatus("No review items loaded.");
    return;
  }

  saveCurrentDecision();

  const decisions = reviewState.items.map((item) => {
    return reviewState.decisions.get(item.source) || {
      source: item.source,
      action: "skip",
    };
  });

  const body = {
    decisions,
    dryRun: $("dryRun").checked,
    embedCoverInAudio: $("embedCoverInAudio").checked,
    embedMetadataInAudio: $("embedMetadataInAudio").checked,
  };
  if (reviewState.reviewFilePath) {
    body.reviewFilePath = reviewState.reviewFilePath;
  }

  const result = await postJson("/manual-review/apply", body);

  appendOutput("Manual Review Apply Result", result);
  setReviewStatus(`Applied decisions. moved=${result.moved?.length || 0}, skipped=${result.skipped?.length || 0}`);
  reviewState.items = [];
  reviewState.index = 0;
  reviewState.decisions = new Map();
  renderReviewItem();
}

function settingsSnapshot() {
  return {
    inputDir: $("inputDir").value,
    outputDir: $("outputDir").value,
    namingTemplate: $("namingTemplate").value,
    folderTemplate: $("folderTemplate").value,
    openAiModel: openAiModelSelect.value,
    conflictPolicy: $("conflictPolicy").value,
    highReliabilityThreshold: $("highReliabilityThreshold").value,
    fileOperation: $("fileOperation").value,
    recursive: $("recursive").checked,
    createBookFolder: $("createBookFolder").checked,
    embedCoverInAudio: $("embedCoverInAudio").checked,
    embedMetadataInAudio: $("embedMetadataInAudio").checked,
    dryRun: $("dryRun").checked,
    overwrite: $("overwrite").checked,
    providers: selectedProviders(),
    googleBooksApiKey: $("googleBooksApiKey").value,
    openAiApiKey: $("openAiApiKey").value,
  };
}

function applySettings(settings) {
  if (!settings || typeof settings !== "object") return;

  const fields = [
    "inputDir",
    "outputDir",
    "namingTemplate",
    "folderTemplate",
    "highReliabilityThreshold",
    "googleBooksApiKey",
    "openAiApiKey",
  ];

  for (const id of fields) {
    if (typeof settings[id] === "string") {
      $(id).value = settings[id];
    }
  }

  if (typeof settings.openAiModel === "string" && settings.openAiModel) {
    const option = Array.from(openAiModelSelect.options).find((o) => o.value === settings.openAiModel);
    if (!option) {
      const dynamic = document.createElement("option");
      dynamic.value = settings.openAiModel;
      dynamic.textContent = settings.openAiModel;
      openAiModelSelect.appendChild(dynamic);
    }
    openAiModelSelect.value = settings.openAiModel;
  }

  if (typeof settings.conflictPolicy === "string") {
    $("conflictPolicy").value = settings.conflictPolicy;
  }
  if (typeof settings.fileOperation === "string") {
    $("fileOperation").value = settings.fileOperation;
  }

  const checkFields = [
    "recursive",
    "createBookFolder",
    "embedCoverInAudio",
    "embedMetadataInAudio",
    "dryRun",
    "overwrite",
  ];
  for (const id of checkFields) {
    if (typeof settings[id] === "boolean") {
      $(id).checked = settings[id];
    }
  }

  if (Array.isArray(settings.providers)) {
    document.querySelectorAll(".provider").forEach((el) => {
      el.checked = settings.providers.includes(el.value);
    });
  }
}

async function saveSettings() {
  const snapshot = settingsSnapshot();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(snapshot));
  await postJson("/settings", { settings: snapshot });
  appendOutput("Settings", "Saved settings and API keys to server storage.");
}

async function loadSettings() {
  try {
    const result = await fetch("/settings");
    if (result.ok) {
      const parsed = await result.json();
      if (parsed && parsed.settings) {
        applySettings(parsed.settings);
        appendOutput("Settings", "Loaded saved settings from server.");
        return;
      }
    }
  } catch {
    // fall through to browser fallback
  }

  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    applySettings(parsed);
    appendOutput("Settings", "Loaded saved settings from browser fallback.");
  } catch {
    appendOutput("Settings", "Saved settings were invalid and were ignored.");
  }
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({ error: "Invalid JSON response" }));
  if (!response.ok) {
    throw new Error(data?.error ? JSON.stringify(data.error) : `HTTP ${response.status}`);
  }
  return data;
}

function buildBasePayload() {
  const providerApiKeys = {};
  const googleBooksApiKey = $("googleBooksApiKey").value.trim();
  if (googleBooksApiKey) {
    providerApiKeys.googleBooksApiKey = googleBooksApiKey;
  }

  return {
    inputDir: $("inputDir").value.trim(),
    outputDir: $("outputDir").value.trim(),
    fileOperation: $("fileOperation").value || "move",
    recursive: $("recursive").checked,
    dryRun: $("dryRun").checked,
    overwrite: $("overwrite").checked,
    namingTemplate: $("namingTemplate").value.trim(),
    folderTemplate: $("folderTemplate").value.trim(),
    createBookFolder: $("createBookFolder").checked,
    metadataProviderOrder: selectedProviders(),
    providerApiKeys,
    openAiModel: openAiModelSelect.value || undefined,
    openAiApiKey: $("openAiApiKey").value.trim() || undefined,
    conflictPolicy: $("conflictPolicy").value,
    highReliabilityThreshold: Number($("highReliabilityThreshold").value || 0.8),
    embedCoverInAudio: $("embedCoverInAudio").checked,
    embedMetadataInAudio: $("embedMetadataInAudio").checked,
  };
}

async function organizeWithRealtime(payload, signal) {
  organizeActions = [];
  const response = await fetch("/organize/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const fallback = await postJson("/organize", payload);
    appendOutput("Organize Result", fallback);
    if (fallback.actions) {
      organizeActions = fallback.actions;
      renderOrganizeTree(organizeActions);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const event = JSON.parse(line);
          if (event.type === "result") {
            appendOutput("Organize Result", event.result);
            if (event.result && event.result.actions) {
              organizeActions = event.result.actions;
              renderOrganizeTree(organizeActions);
            }
            setRunStatus("Completed.");
            loadReviewFile("")
              .then(() => appendOutput("Manual Review", "Loaded latest live queue"))
              .catch((error) => appendOutput("Manual Review Error", String(error)));
          } else if (event.type === "error") {
            appendOutput("Organize Error", event.message ?? event);
            setRunStatus("Error.");
          } else if (event.type === "item_completed") {
            // Real-time update to right panel as items complete
            const action = {
              source: event.source || "",
              destination: event.destination || "",
              status: event.status || "pending",
              reason: event.message,
            };
            // Check if this action already exists and update it, or add it
            const existingIdx = organizeActions.findIndex(a => a.source === action.source);
            if (existingIdx >= 0) {
              organizeActions[existingIdx] = { ...organizeActions[existingIdx], ...action };
            } else {
              organizeActions.push(action);
            }
            renderOrganizeTree(organizeActions);
            const progress = event.total && event.index ? `(${event.index}/${event.total}) ` : "";
            const message = event.message || "Item processed.";
            appendOutput("Organize Progress", `${progress}${message}`);
            setRunStatus(`${progress}${message}`);
          } else if (event.type === "manual_review_item") {
            const incoming = event.manualReviewItem;
            if (incoming && incoming.source) {
              const exists = reviewState.items.some((item) => item.source === incoming.source);
              if (!exists) {
                reviewState.items.push(incoming);
                if (reviewState.items.length === 1) {
                  reviewState.index = 0;
                }
                renderReviewItem();
                setReviewStatus(`Live queue: ${reviewState.items.length} item(s)`);
              }
            }
            // Still add to organize actions tree
            const action = {
              source: event.source || "",
              destination: event.destination || "",
              status: event.status || "manual_review",
              reason: event.message,
            };
            const existingIdx = organizeActions.findIndex(a => a.source === action.source);
            if (existingIdx >= 0) {
              organizeActions[existingIdx] = { ...organizeActions[existingIdx], ...action };
            } else {
              organizeActions.push(action);
            }
            renderOrganizeTree(organizeActions);
            const progress = event.total && event.index ? `(${event.index}/${event.total}) ` : "";
            const message = event.message || "Manual review item queued.";
            appendOutput("Organize Progress", `${progress}${message}`);
            setRunStatus(`${progress}${message}`);
          } else {
            const progress = event.total && event.index ? `(${event.index}/${event.total}) ` : "";
            const message = event.message || JSON.stringify(event);
            appendOutput("Organize Progress", `${progress}${message}`);
            setRunStatus(`${progress}${message}`);
          }
        } catch {
          appendOutput("Organize Stream", line);
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }
}

function setModelOptions(models) {
  const current = openAiModelSelect.value || "gpt-5-mini";
  openAiModelSelect.innerHTML = "";

  const preferred = [
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
  ];

  const merged = Array.from(new Set([...preferred, ...models]))
    .filter((model) => model.startsWith("gpt-4") || model.startsWith("gpt-5"))
    .sort((a, b) => a.localeCompare(b));

  for (const model of merged) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    openAiModelSelect.appendChild(option);
  }

  openAiModelSelect.value = merged.includes(current) ? current : (merged.includes("gpt-5-mini") ? "gpt-5-mini" : merged[0]);
}

async function loadOpenAiModels() {
  try {
    refreshModelsBtn.disabled = true;
    refreshModelsBtn.textContent = "Loading...";

    const payload = {};
    const openAiApiKey = $("openAiApiKey").value.trim();
    if (openAiApiKey) {
      payload.openAiApiKey = openAiApiKey;
    }

    const result = await postJson("/openai/models", payload);
    const models = Array.isArray(result.models) ? result.models : [];
    setModelOptions(models);
    appendOutput("Models", { loaded: models.length, filter: "gpt-4/gpt-5" });
  } catch (error) {
    appendOutput("Models Error", String(error));
  } finally {
    refreshModelsBtn.disabled = false;
    refreshModelsBtn.textContent = "Refresh Models";
  }
}

$("scanBtn").addEventListener("click", async () => {
  try {
    const inputDir = $("inputDir").value.trim();
    if (!inputDir) {
      appendOutput("Scan Error", "Input Directory is required.");
      return;
    }

    const result = await postJson("/scan", {
      inputDir,
      recursive: $("recursive").checked,
    });
    appendOutput("Scan Result", result);
    renderScanTree(result.files || []);
  } catch (error) {
    appendOutput("Scan Error", String(error));
  }
});

organizeBtn.addEventListener("click", async () => {
  try {
    const payload = buildBasePayload();
    if (!payload.inputDir || !payload.outputDir) {
      appendOutput("Organize Error", "Input Directory and Output Directory are required.");
      return;
    }

    organizeBtn.disabled = true;
    organizeBtn.textContent = "Running...";
    setStopButtonsDisabled(false);
    activeOrganizeController = new AbortController();
    organizeActions = [];
    reviewState.items = [];
    reviewState.index = 0;
    reviewState.decisions = new Map();
    reviewState.reviewFilePath = "";
    renderReviewItem();
    setReviewStatus("Waiting for low-certainty items...");
    setRunStatus("Starting organizer...");
    $("tab-organize").textContent = "";
    renderOrganizeTree([]);
    await saveSettings();
    await organizeWithRealtime(payload, activeOrganizeController.signal);
  } catch (error) {
    if (error && error.name === "AbortError") {
      appendOutput("Organize", "Stopped by user.");
      setRunStatus("Stopped by user.");
    } else {
      appendOutput("Organize Error", String(error));
      setRunStatus("Error.");
    }
  } finally {
    organizeBtn.disabled = false;
    organizeBtn.textContent = "Run Organize";
    setStopButtonsDisabled(true);
    activeOrganizeController = null;
  }
});

stopOrganizeBtn.addEventListener("click", () => {
  if (!activeOrganizeController) return;
  activeOrganizeController.abort();
});

if (stopOrganizeTopBtn) {
  stopOrganizeTopBtn.addEventListener("click", () => {
    if (!activeOrganizeController) return;
    activeOrganizeController.abort();
  });
}

$("metadataSearchBtn").addEventListener("click", async () => {
  try {
    const query = $("metadataQuery").value.trim();
    if (!query) {
      appendOutput("Metadata Search Error", "Query is required.");
      return;
    }

    const result = await postJson("/metadata/search", {
      query,
      providers: selectedProviders(),
      providerApiKeys: {
        googleBooksApiKey: $("googleBooksApiKey").value.trim() || undefined,
      },
    });
    appendOutput("Metadata Search Result", result);
    if (result?.diagnostics?.failedProviders > 0) {
      appendOutput("Metadata Provider Diagnostics", result.diagnostics.providerFailures);
    }
  } catch (error) {
    appendOutput("Metadata Search Error", String(error));
  }
});

$("clearOutput").addEventListener("click", () => {
  outputEl.textContent = "Ready.";
});

refreshModelsBtn.addEventListener("click", () => {
  loadOpenAiModels();
});

saveSettingsBtn.addEventListener("click", () => {
  saveSettings()
    .then(() => {
      hideModal(settingsModal);
      appendOutput("Settings", "Settings saved successfully.");
    })
    .catch((error) => appendOutput("Settings Error", String(error)));
});

loadReviewBtn.addEventListener("click", async () => {
  try {
    const reviewFilePath = reviewFilePathEl.value.trim();
    await loadReviewFile(reviewFilePath);
  } catch (error) {
    setReviewStatus(`Failed to load review file: ${String(error)}`);
  }
});

saveReviewDecisionBtn.addEventListener("click", () => {
  saveCurrentDecision();
});

prevReviewBtn.addEventListener("click", () => {
  if (!reviewState.items.length) return;
  saveCurrentDecision();
  reviewState.index = Math.max(0, reviewState.index - 1);
  renderReviewItem();
});

nextReviewBtn.addEventListener("click", () => {
  if (!reviewState.items.length) return;
  saveCurrentDecision();
  reviewState.index = Math.min(reviewState.items.length - 1, reviewState.index + 1);
  renderReviewItem();
});

applyReviewBtn.addEventListener("click", async () => {
  try {
    await applyReviewDecisions();
  } catch (error) {
    setReviewStatus(`Failed to apply decisions: ${String(error)}`);
  }
});

fetch("/api")
  .then((res) => res.json())
  .then(async (info) => {
    appendOutput("Service", info);
    const buildNumber = info?.build?.number || info?.build?.version || "unknown";
    if (buildInfoEl) {
      buildInfoEl.textContent = `build ${buildNumber}`;
    }
    await loadSettings();
    return loadOpenAiModels();
  })
  .catch(() => appendOutput("Service", "Unable to load /api status"));
