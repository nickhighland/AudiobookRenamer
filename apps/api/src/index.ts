import "dotenv/config";

import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import { z } from "zod";

import { applyManualReview, organizeAudiobooks, scanAudiobookFiles, searchMetadata } from "@aon/core";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const organizeSchema = z.object({
  inputDir: z.string().min(1),
  outputDir: z.string().min(1),
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
  reviewFilePath: z.string().min(1),
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

const metadataSearchSchema = z.object({
  query: z.string().min(1),
  providers: z.array(z.enum(["librivox", "openlibrary", "googlebooks"])).optional(),
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "audiobook-organizer-api" });
});

app.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "audiobook-organizer-api",
    endpoints: ["/health", "/scan", "/organize", "/manual-review/apply", "/metadata/search"],
  });
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

app.post("/manual-review/apply", async (req: Request, res: Response) => {
  try {
    const parsed = applyManualReviewSchema.parse(req.body);
    const result = await applyManualReview(
      parsed.reviewFilePath,
      parsed.decisions,
      parsed.dryRun ?? false,
      parsed.embedCoverInAudio ?? false,
      parsed.embedMetadataInAudio ?? true,
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
