import { contextBridge, ipcRenderer } from "electron";

import { ManualReviewDecision, OrganizerConfig } from "@aon/core";

contextBridge.exposeInMainWorld("organizerApi", {
  organize: (config: OrganizerConfig, openAiApiKey: string) =>
    ipcRenderer.invoke("organize:audiobooks", { config, openAiApiKey }),
  scan: (inputDir: string, recursive: boolean) =>
    ipcRenderer.invoke("scan:audiobooks", { inputDir, recursive }),
  loadManualReview: (reviewFilePath: string) =>
    ipcRenderer.invoke("manual-review:load", { reviewFilePath }),
  applyManualReview: (reviewFilePath: string, decisions: ManualReviewDecision[], dryRun: boolean) =>
    ipcRenderer.invoke("manual-review:apply", { reviewFilePath, decisions, dryRun }),
  searchMetadata: (query: string, providers: Array<"librivox" | "openlibrary" | "googlebooks">) =>
    ipcRenderer.invoke("metadata:search", { query, providers }),
});

declare global {
  interface Window {
    organizerApi: {
      organize: (config: OrganizerConfig, openAiApiKey: string) => Promise<unknown>;
      scan: (inputDir: string, recursive: boolean) => Promise<unknown>;
      loadManualReview: (reviewFilePath: string) => Promise<unknown>;
      applyManualReview: (reviewFilePath: string, decisions: ManualReviewDecision[], dryRun: boolean) => Promise<unknown>;
      searchMetadata: (query: string, providers: Array<"librivox" | "openlibrary" | "googlebooks">) => Promise<unknown>;
    };
  }
}
