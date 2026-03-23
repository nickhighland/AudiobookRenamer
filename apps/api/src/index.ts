import "dotenv/config";

import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";

import { applyManualReview, applyManualReviewItems, listOpenAiModels, organizeAudiobooks, scanAudiobookFiles, searchMetadata } from "@aon/core";
import type { ManualReviewItem } from "@aon/core";

const app = express();
const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const publicDir = resolve(currentDir, "../public");
const settingsPath = resolve(process.env.APP_DATA_DIR ?? "/app/data", "web-settings.json");

interface LiveManualReviewQueue {
  runId: string | null;
  generatedAt: string | null;
  reviewFilePath: string | null;
  isRunning: boolean;
  items: ManualReviewItem[];
}

const liveManualReviewQueue: LiveManualReviewQueue = {
  runId: null,
  generatedAt: null,
  reviewFilePath: null,
  isRunning: false,
  items: [],
};

const apiPackageVersion = (() => {
  try {
    const packagePath = resolve(currentDir, "../package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf-8")) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

async function loadStoredSettings(): Promise<Record<string, unknown>> {
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(content);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

async function saveStoredSettings(settings: Record<string, unknown>): Promise<void> {
  await fs.mkdir(resolve(settingsPath, ".."), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

const organizeSchema = z.object({
  inputDir: z.string().min(1),
  outputDir: z.string().min(1),
  fileOperation: z.enum(["move", "copy"]).optional(),
  recursive: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  overwrite: z.boolean().optional(),
  metadataProviderOrder: z.array(z.enum(["librivox", "openlibrary", "googlebooks"])).default(["librivox", "openlibrary"]),
  providerApiKeys: z
    .object({
      googleBooksApiKey: z.string().optional(),
    })
    .optional(),
  openAiModel: z.string().optional(),
  folderTemplate: z.string().optional(),
  namingTemplate: z.string().optional(),
  createBookFolder: z.boolean().optional(),
  conflictPolicy: z.enum(["skip", "rename", "merge", "manual_review", "rename_if_high_reliability"]).optional(),
  highReliabilityThreshold: z.number().min(0).max(1).optional(),
  manualReviewDir: z.string().optional(),
  embedCoverInAudio: z.boolean().optional(),
  embedMetadataInAudio: z.boolean().optional(),
  openAiApiKey: z.string().optional(),
});

const applyManualReviewSchema = z.object({
  reviewFilePath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  embedCoverInAudio: z.boolean().optional(),
  embedMetadataInAudio: z.boolean().optional(),
  decisions: z.array(
    z.object({
      source: z.string().min(1),
      action: z.enum(["approve", "skip", "custom_destination"]),
      destination: z.string().optional(),
      metadataOverride: z
        .object({
          title: z.string().min(1),
          subtitle: z.string().optional(),
          authors: z.array(z.string()).min(1),
          narrators: z.array(z.string()).optional(),
          series: z.string().optional(),
          seriesSequence: z.string().optional(),
          description: z.string().optional(),
          publishedYear: z.string().optional(),
          language: z.string().optional(),
          isbn: z.string().optional(),
          asin: z.string().optional(),
          coverUrl: z.string().optional(),
          source: z.string().min(1),
        })
        .optional(),
    }),
  ),
});

const loadManualReviewSchema = z.object({
  reviewFilePath: z.string().min(1).optional(),
});

const metadataSearchSchema = z.object({
  query: z.string().min(1),
  providers: z.array(z.enum(["librivox", "openlibrary", "googlebooks"])).optional(),
});

const modelListSchema = z.object({
  openAiApiKey: z.string().optional(),
});

const settingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()),
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "audiobook-organizer-api" });
});

app.get("/api", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "audiobook-organizer-api",
    build: {
      version: apiPackageVersion,
      number: process.env.APP_BUILD ?? apiPackageVersion,
    },
    endpoints: [
      "/api",
      "/health",
      "/settings",
      "/scan",
      "/organize",
      "/organize/stream",
      "/manual-review/load",
      "/manual-review/apply",
      "/metadata/search",
      "/openai/models",
    ],
  });
});

app.get("/settings", async (_req: Request, res: Response) => {
  const settings = await loadStoredSettings();
  return res.json({ settings });
});

app.post("/settings", async (req: Request, res: Response) => {
  try {
    const parsed = settingsSchema.parse(req.body ?? {});
    await saveStoredSettings(parsed.settings);
    return res.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/openai/models", async (req: Request, res: Response) => {
  try {
    const parsed = modelListSchema.parse(req.body ?? {});
    const apiKey = parsed.openAiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "OPENAI API key missing. Pass openAiApiKey or set OPENAI_API_KEY." });
    }

    const models = await listOpenAiModels(apiKey);
    return res.json({ count: models.length, models });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/scan", async (req: Request, res: Response) => {
  try {
    const inputDir = String(req.body?.inputDir ?? "");
    if (!inputDir) {
      return res.status(400).json({ error: "inputDir is required" });
    }

    const files = await scanAudiobookFiles(inputDir, req.body?.recursive ?? true);
    return res.json({ count: files.length, files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/organize", async (req: Request, res: Response) => {
  try {
    const parsed = organizeSchema.parse(req.body);
    const openAiApiKey = parsed.openAiApiKey || process.env.OPENAI_API_KEY;
    if (!openAiApiKey) {
      return res.status(400).json({ error: "OPENAI API key missing. Pass openAiApiKey or set OPENAI_API_KEY." });
    }

    const result = await organizeAudiobooks(
      {
        inputDir: parsed.inputDir,
        outputDir: parsed.outputDir,
        fileOperation: parsed.fileOperation,
        recursive: parsed.recursive,
        dryRun: parsed.dryRun,
        overwrite: parsed.overwrite,
        metadataProviderOrder: parsed.metadataProviderOrder,
        providerApiKeys: parsed.providerApiKeys,
        openAiModel: parsed.openAiModel,
        folderTemplate: parsed.folderTemplate,
        namingTemplate: parsed.namingTemplate,
        createBookFolder: parsed.createBookFolder,
        conflictPolicy: parsed.conflictPolicy,
        highReliabilityThreshold: parsed.highReliabilityThreshold,
        manualReviewDir: parsed.manualReviewDir,
        embedCoverInAudio: parsed.embedCoverInAudio,
        embedMetadataInAudio: parsed.embedMetadataInAudio,
      },
      openAiApiKey,
    );

    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/organize/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const send = (event: unknown) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  let cancelled = false;
  req.on("aborted", () => {
    cancelled = true;
  });
  res.on("close", () => {
    // Treat as cancellation only when the response did not finish normally.
    if (!res.writableEnded) {
      cancelled = true;
    }
  });

  try {
    const runId = `run-${Date.now()}`;
    liveManualReviewQueue.runId = runId;
    liveManualReviewQueue.generatedAt = new Date().toISOString();
    liveManualReviewQueue.reviewFilePath = null;
    liveManualReviewQueue.isRunning = true;
    liveManualReviewQueue.items = [];

    const parsed = organizeSchema.parse(req.body);
    const openAiApiKey = parsed.openAiApiKey || process.env.OPENAI_API_KEY;
    if (!openAiApiKey) {
      send({ type: "error", message: "OPENAI API key missing. Pass openAiApiKey or set OPENAI_API_KEY." });
      return res.end();
    }

    const result = await (organizeAudiobooks as unknown as (
      config: unknown,
      openAiApiKey: string,
      onProgress: (event: unknown) => void,
      shouldStop: () => boolean,
    ) => Promise<unknown>)(
      {
        inputDir: parsed.inputDir,
        outputDir: parsed.outputDir,
        fileOperation: parsed.fileOperation,
        recursive: parsed.recursive,
        dryRun: parsed.dryRun,
        overwrite: parsed.overwrite,
        metadataProviderOrder: parsed.metadataProviderOrder,
        providerApiKeys: parsed.providerApiKeys,
        openAiModel: parsed.openAiModel,
        folderTemplate: parsed.folderTemplate,
        namingTemplate: parsed.namingTemplate,
        createBookFolder: parsed.createBookFolder,
        conflictPolicy: parsed.conflictPolicy,
        highReliabilityThreshold: parsed.highReliabilityThreshold,
        manualReviewDir: parsed.manualReviewDir,
        embedCoverInAudio: parsed.embedCoverInAudio,
        embedMetadataInAudio: parsed.embedMetadataInAudio,
      },
      openAiApiKey,
      (event: unknown) => {
        const evt = event as {
          type?: string;
          manualReviewItem?: ManualReviewItem;
        };
        if (evt.type === "manual_review_item" && evt.manualReviewItem) {
          liveManualReviewQueue.items.push(evt.manualReviewItem);
        }
        if (evt.type === "complete") {
          liveManualReviewQueue.isRunning = false;
        }
        send(event);
      },
      () => cancelled,
    );

    const typedResult = result as { manualReviewPath?: string };
    if (typedResult?.manualReviewPath) {
      liveManualReviewQueue.reviewFilePath = typedResult.manualReviewPath;
    }
    liveManualReviewQueue.isRunning = false;

    send({ type: "result", result });
    return res.end();
  } catch (error: unknown) {
    liveManualReviewQueue.isRunning = false;
    if (error instanceof z.ZodError) {
      send({ type: "error", message: error.issues });
      return res.end();
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    send({ type: "error", message });
    return res.end();
  }
});

app.post("/manual-review/apply", async (req: Request, res: Response) => {
  try {
    const parsed = applyManualReviewSchema.parse(req.body);
    const result = parsed.reviewFilePath
      ? await applyManualReview(
          parsed.reviewFilePath,
          parsed.decisions,
          parsed.dryRun ?? false,
          parsed.embedCoverInAudio ?? false,
          parsed.embedMetadataInAudio ?? true,
        )
      : await applyManualReviewItems(
          liveManualReviewQueue.items,
          parsed.decisions,
          parsed.dryRun ?? false,
          parsed.embedCoverInAudio ?? false,
          parsed.embedMetadataInAudio ?? true,
        );

    if (!parsed.reviewFilePath) {
      liveManualReviewQueue.items = [];
    }
    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/manual-review/load", async (req: Request, res: Response) => {
  try {
    const parsed = loadManualReviewSchema.parse(req.body ?? {});
    if (!parsed.reviewFilePath) {
      return res.json({
        runId: liveManualReviewQueue.runId,
        reviewFilePath: liveManualReviewQueue.reviewFilePath,
        generatedAt: liveManualReviewQueue.generatedAt,
        isRunning: liveManualReviewQueue.isRunning,
        count: liveManualReviewQueue.items.length,
        items: liveManualReviewQueue.items,
      });
    }

    const raw = await fs.readFile(parsed.reviewFilePath, "utf-8");
    const doc = JSON.parse(raw) as { generatedAt?: string; items?: unknown[] };
    const items = Array.isArray(doc.items) ? doc.items : [];
    return res.json({
      reviewFilePath: parsed.reviewFilePath,
      generatedAt: doc.generatedAt ?? null,
      count: items.length,
      items,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/metadata/search", async (req: Request, res: Response) => {
  try {
    const parsed = metadataSearchSchema.parse(req.body);
    const providers = parsed.providers ?? ["librivox", "openlibrary"];
    const results = await searchMetadata(parsed.query, providers);
    return res.json({ count: results.length, results });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

const port = Number(process.env.PORT ?? 4033);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
