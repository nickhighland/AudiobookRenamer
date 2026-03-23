import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain } from "electron";
import { applyManualReview, listOpenAiModels, organizeAudiobooks, scanAudiobookFiles, searchMetadata } from "@aon/core";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(runtimeDir, "..");

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1050,
    height: 780,
    webPreferences: {
      preload: path.join(runtimeDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(appRoot, "src", "renderer.html"));
}

ipcMain.handle("scan:audiobooks", async (_event, payload) => {
  const files = await scanAudiobookFiles(payload.inputDir, payload.recursive ?? true);
  return { count: files.length, files };
});

ipcMain.handle("organize:audiobooks", async (_event, payload) => {
  return organizeAudiobooks(payload.config, payload.openAiApiKey);
});

ipcMain.handle("manual-review:load", async (_event, payload) => {
  const raw = await fs.readFile(payload.reviewFilePath, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed;
});

ipcMain.handle("manual-review:apply", async (_event, payload) => {
  return applyManualReview(
    payload.reviewFilePath,
    payload.decisions,
    payload.dryRun ?? false,
    payload.embedCoverInAudio ?? false,
    payload.embedMetadataInAudio ?? true,
  );
});

ipcMain.handle("metadata:search", async (_event, payload) => {
  const providers = Array.isArray(payload.providers) && payload.providers.length > 0
    ? payload.providers
    : ["librivox", "openlibrary"];
  const results = await searchMetadata(payload.query, providers, payload.providerApiKeys);
  return { count: results.length, results };
});

ipcMain.handle("openai:list-models", async (_event, payload) => {
  const models = await listOpenAiModels(payload.apiKey);
  return { count: models.length, models };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
