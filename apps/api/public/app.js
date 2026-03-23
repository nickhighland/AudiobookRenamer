const $ = (id) => document.getElementById(id);

const outputEl = $("output");
const namingTemplateInput = $("namingTemplate");
const folderTemplateInput = $("folderTemplate");
const openAiModelSelect = $("openAiModel");
const refreshModelsBtn = $("refreshModelsBtn");
const saveSettingsBtn = $("saveSettingsBtn");
const organizeBtn = $("organizeBtn");
const stopOrganizeBtn = $("stopOrganizeBtn");
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

const SETTINGS_KEY = "aon.web.settings.v1";

let activeOrganizeController = null;

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
    reviewSourceEl.value = "";
    reviewDestinationEl.value = "";
    reviewReasonEl.value = "";
    reviewPositionEl.value = "0/0";
    reviewCustomDestinationEl.value = "";
    return;
  }

  reviewSourceEl.value = item.source || "";
  reviewDestinationEl.value = item.proposedDestination || "";
  reviewReasonEl.value = item.reason || "";
  reviewPositionEl.value = `${reviewState.index + 1}/${reviewState.items.length}`;

  const saved = reviewState.decisions.get(item.source);
  reviewDecisionActionEl.value = saved?.action || "approve";
  reviewCustomDestinationEl.value = saved?.destination || "";
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
  const response = await fetch("/organize/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok || !response.body) {
    const fallback = await postJson("/organize", payload);
    appendOutput("Organize Result", fallback);
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
            setRunStatus("Completed.");
            loadReviewFile("")
              .then(() => appendOutput("Manual Review", "Loaded latest live queue"))
              .catch((error) => appendOutput("Manual Review Error", String(error)));
          } else if (event.type === "error") {
            appendOutput("Organize Error", event.message ?? event);
            setRunStatus("Error.");
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
                setReviewStatus(`Live queue updated: ${reviewState.items.length} item(s).`);
              }
            }
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
    stopOrganizeBtn.disabled = false;
    activeOrganizeController = new AbortController();
    reviewState.items = [];
    reviewState.index = 0;
    reviewState.decisions = new Map();
    reviewState.reviewFilePath = "";
    renderReviewItem();
    setReviewStatus("Live review queue waiting for low-certainty items...");
    setRunStatus("Starting organizer...");
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
    stopOrganizeBtn.disabled = true;
    activeOrganizeController = null;
  }
});

stopOrganizeBtn.addEventListener("click", () => {
  if (!activeOrganizeController) return;
  activeOrganizeController.abort();
});

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
    });
    appendOutput("Metadata Search Result", result);
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
  saveSettings().catch((error) => appendOutput("Settings Error", String(error)));
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
