import { contextBridge, ipcRenderer } from "electron";

import { ManualReviewDecision, OrganizerConfig } from "@aon/core";

contextBridge.exposeInMainWorld("organizerApi", {
  organize: (config: OrganizerConfig, openAiApiKey: string) =>
    ipcRenderer.invoke("organize:audiobooks", { config, openAiApiKey }),
  scan: (inputDir: string, recursive: boolean) =>
    ipcRenderer.invoke("scan:audiobooks", { inputDir, recursive }),
  loadManualReview: (reviewFilePath: string) =>
    ipcRenderer.invoke("manual-review:load", { reviewFilePath }),
  applyManualReview: (
    reviewFilePath: string,
    decisions: ManualReviewDecision[],
    dryRun: boolean,
    embedCoverInAudio: boolean,
    embedMetadataInAudio: boolean,
  ) => ipcRenderer.invoke("manual-review:apply", {
    reviewFilePath,
    decisions,
    dryRun,
    embedCoverInAudio,
    embedMetadataInAudio,
  }),
  searchMetadata: (
    query: string,
    providers: Array<"librivox" | "openlibrary" | "googlebooks">,
    providerApiKeys?: { googleBooksApiKey?: string },
  ) => ipcRenderer.invoke("metadata:search", { query, providers, providerApiKeys }),
  listOpenAiModels: (apiKey: string) =>
    ipcRenderer.invoke("openai:list-models", { apiKey }),
});

declare global {
  interface Window {
    organizerApi: {
      organize: (config: OrganizerConfig, openAiApiKey: string) => Promise<unknown>;
      scan: (inputDir: string, recursive: boolean) => Promise<unknown>;
      loadManualReview: (reviewFilePath: string) => Promise<unknown>;
      applyManualReview: (
        reviewFilePath: string,
        decisions: ManualReviewDecision[],
        dryRun: boolean,
        embedCoverInAudio: boolean,
        embedMetadataInAudio: boolean,
      ) => Promise<unknown>;
      searchMetadata: (
        query: string,
        providers: Array<"librivox" | "openlibrary" | "googlebooks">,
        providerApiKeys?: { googleBooksApiKey?: string },
      ) => Promise<unknown>;
      listOpenAiModels: (apiKey: string) => Promise<unknown>;
    };
  }
}
