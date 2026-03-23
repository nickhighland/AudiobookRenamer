const $ = (id) => document.getElementById(id);

const outputEl = $("output");
const namingTemplateInput = $("namingTemplate");
const folderTemplateInput = $("folderTemplate");
const openAiModelSelect = $("openAiModel");
const refreshModelsBtn = $("refreshModelsBtn");
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

$("organizeBtn").addEventListener("click", async () => {
  try {
    const payload = buildBasePayload();
    if (!payload.inputDir || !payload.outputDir) {
      appendOutput("Organize Error", "Input Directory and Output Directory are required.");
      return;
    }

    const result = await postJson("/organize", payload);
    appendOutput("Organize Result", result);
  } catch (error) {
    appendOutput("Organize Error", String(error));
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

fetch("/api")
  .then((res) => res.json())
  .then((info) => {
    appendOutput("Service", info);
    return loadOpenAiModels();
  })
  .catch(() => appendOutput("Service", "Unable to load /api status"));
