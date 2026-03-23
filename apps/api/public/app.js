const $ = (id) => document.getElementById(id);

const outputEl = $("output");
const namingTemplateInput = $("namingTemplate");
const folderTemplateInput = $("folderTemplate");
const openAiModelSelect = $("openAiModel");
const refreshModelsBtn = $("refreshModelsBtn");
const saveSettingsBtn = $("saveSettingsBtn");
const organizeBtn = $("organizeBtn");
const runStatusEl = $("runStatus");

const SETTINGS_KEY = "aon.web.settings.v1";

let activeTemplateInput = namingTemplateInput;

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

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSnapshot()));
  appendOutput("Settings", "Saved settings to browser storage.");
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    applySettings(parsed);
    appendOutput("Settings", "Loaded saved settings.");
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

async function organizeWithRealtime(payload) {
  const response = await fetch("/organize/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
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
          } else if (event.type === "error") {
            appendOutput("Organize Error", event.message ?? event);
            setRunStatus("Error.");
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
    setRunStatus("Starting organizer...");
    saveSettings();
    await organizeWithRealtime(payload);
  } catch (error) {
    appendOutput("Organize Error", String(error));
    setRunStatus("Error.");
  } finally {
    organizeBtn.disabled = false;
    organizeBtn.textContent = "Run Organize";
  }
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
  saveSettings();
});

fetch("/api")
  .then((res) => res.json())
  .then((info) => {
    appendOutput("Service", info);
    loadSettings();
    return loadOpenAiModels();
  })
  .catch(() => appendOutput("Service", "Unable to load /api status"));
