const $ = (id) => document.getElementById(id);

const outputEl = $("output");

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
    openAiModel: $("openAiModel").value.trim() || undefined,
    openAiApiKey: $("openAiApiKey").value.trim() || undefined,
    conflictPolicy: $("conflictPolicy").value,
    highReliabilityThreshold: Number($("highReliabilityThreshold").value || 0.8),
    embedCoverInAudio: $("embedCoverInAudio").checked,
    embedMetadataInAudio: $("embedMetadataInAudio").checked,
  };
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

fetch("/api")
  .then((res) => res.json())
  .then((info) => appendOutput("Service", info))
  .catch(() => appendOutput("Service", "Unable to load /api status"));
