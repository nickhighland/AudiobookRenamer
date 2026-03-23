import fs from "node:fs/promises";
import path from "node:path";

import axios from "axios";

import { DEFAULT_BOOK_FOLDER_TEMPLATE, DEFAULT_NAMING_TEMPLATE } from "./defaults.js";
import { createProviders } from "./metadata/providers.js";
import { buildOutputRelativePath, renderTemplate } from "./naming.js";
import { OpenAiIdentifier } from "./openaiIdentifier.js";
import { scanAudiobookFiles } from "./scanner.js";
import {
  BookMetadata,
  ManualReviewItem,
  NameTemplateContext,
  OrganizeAction,
  OrganizerConfig,
  OrganizeResult,
} from "./types.js";

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch {
    await fs.copyFile(source, destination);
    await fs.unlink(source);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findAvailablePath(initialPath: string): Promise<string> {
  let current = initialPath;
  let counter = 2;
  const dir = path.dirname(initialPath);
  const ext = path.extname(initialPath);
  const stem = path.basename(initialPath, ext);

  while (await pathExists(current)) {
    current = path.join(dir, `${stem} (${counter})${ext}`);
    counter += 1;
  }

  return current;
}

async function writeAudiobookshelfMetadata(folder: string, metadata: BookMetadata): Promise<string> {
  const outPath = path.join(folder, "metadata.abs");
  const absMetadata = {
    title: metadata.title,
    subtitle: metadata.subtitle,
    authors: metadata.authors,
    narrators: metadata.narrators ?? [],
    series: metadata.series
      ? [
          {
            name: metadata.series,
            sequence: metadata.seriesSequence,
          },
        ]
      : [],
    publishedYear: metadata.publishedYear,
    description: metadata.description,
    language: metadata.language,
    isbn: metadata.isbn,
    asin: metadata.asin,
  };

  await fs.writeFile(outPath, JSON.stringify(absMetadata, null, 2), "utf-8");
  return outPath;
}

async function maybeDownloadCover(folder: string, coverUrl?: string): Promise<void> {
  if (!coverUrl) {
    return;
  }

  try {
    const response = await axios.get<ArrayBuffer>(coverUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
    });
    await fs.writeFile(path.join(folder, "cover.jpg"), Buffer.from(response.data));
  } catch {
    // Cover download failures should not block organization.
  }
}

function templateContextFrom(metadata: BookMetadata, extension: string, part?: string, chapter?: string): NameTemplateContext {
  return {
    author: metadata.authors[0] ?? "Unknown Author",
    title: metadata.title,
    part,
    chapter,
    series: metadata.series,
    seriesNumber: metadata.seriesSequence,
    ext: extension,
  };
}

function mergeDestinationFromSource(destination: string, sourceFileName: string): string {
  const ext = path.extname(destination);
  const sourceStem = path.basename(sourceFileName, path.extname(sourceFileName)).replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
  const safeStem = sourceStem || "track";
  const destinationStem = path.basename(destination, ext);
  return path.join(path.dirname(destination), `${destinationStem} - ${safeStem}${ext}`);
}

async function writeManualReviewFile(manualReviewDir: string, items: ManualReviewItem[]): Promise<string> {
  await fs.mkdir(manualReviewDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(manualReviewDir, `manual-review-${stamp}.json`);
  await fs.writeFile(filePath, JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2), "utf-8");
  return filePath;
}

export async function organizeAudiobooks(
  config: OrganizerConfig,
  openAiApiKey: string,
): Promise<OrganizeResult> {
  const warnings: string[] = [];
  const actions: OrganizeAction[] = [];
  const manualReviewItems: ManualReviewItem[] = [];
  const plannedDestinations = new Set<string>();

  const conflictPolicy = config.conflictPolicy ?? "manual_review";
  const manualReviewDir = config.manualReviewDir ?? path.resolve(config.outputDir, "manual-review");
  const candidates = await scanAudiobookFiles(config.inputDir, config.recursive ?? true);

  const identifier = new OpenAiIdentifier(openAiApiKey, config.openAiModel);
  const providers = createProviders(config.metadataProviderOrder);

  for (const candidate of candidates) {
    const identity = await identifier.identify(candidate);
    let metadata: BookMetadata = {
      title: identity.title,
      authors: identity.authors,
      source: "openai",
    };

    for (const provider of providers) {
      try {
        const found = await provider.lookup(identity);
        if (found) {
          metadata = {
            ...metadata,
            ...found,
          };
          break;
        }
      } catch {
        warnings.push(`Metadata lookup failed for provider ${provider.name} on ${candidate.relativePath}`);
      }
    }

    const ctx = templateContextFrom(metadata, candidate.extension, identity.part, identity.chapter);
    const folderTemplate = config.createBookFolder === false ? "" : DEFAULT_BOOK_FOLDER_TEMPLATE;
    const relativeBookFolder = folderTemplate ? renderTemplate(folderTemplate, ctx) : "";
    const relativeFile = buildOutputRelativePath(config.namingTemplate ?? DEFAULT_NAMING_TEMPLATE, ctx);
    let destination = path.resolve(config.outputDir, relativeBookFolder, relativeFile);

    const destinationAlreadyPlanned = plannedDestinations.has(destination);
    const destinationExists = config.overwrite ? false : await pathExists(destination);
    const hasConflict = destinationAlreadyPlanned || destinationExists;

    if (hasConflict) {
      const reason = destinationAlreadyPlanned
        ? "Conflict: another source file maps to the same output path."
        : "Conflict: destination file already exists.";

      if (conflictPolicy === "skip") {
        actions.push({
          source: candidate.absolutePath,
          destination,
          metadata,
          status: "skipped",
          reason,
        });
        warnings.push(`${reason} Skipped ${candidate.relativePath}`);
        continue;
      }

      if (conflictPolicy === "manual_review") {
        actions.push({
          source: candidate.absolutePath,
          destination,
          metadata,
          status: "manual_review",
          reason,
        });
        manualReviewItems.push({
          source: candidate.absolutePath,
          proposedDestination: destination,
          reason,
          metadata,
        });
        continue;
      }

      if (conflictPolicy === "merge") {
        destination = mergeDestinationFromSource(destination, candidate.fileName);
      }

      if (conflictPolicy === "rename" || conflictPolicy === "merge") {
        destination = await findAvailablePath(destination);
      }
    }

    plannedDestinations.add(destination);

    actions.push({
      source: candidate.absolutePath,
      destination,
      metadata,
      status: "moved",
    });

    if (config.dryRun) {
      continue;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await moveFile(candidate.absolutePath, destination);

    const bookFolder = path.dirname(destination);
    const metadataPath = await writeAudiobookshelfMetadata(bookFolder, metadata);
    await maybeDownloadCover(bookFolder, metadata.coverUrl);

    actions[actions.length - 1].metadataPath = metadataPath;
  }

  let manualReviewPath: string | undefined;
  if (manualReviewItems.length > 0) {
    manualReviewPath = await writeManualReviewFile(manualReviewDir, manualReviewItems);
  }

  return { actions, warnings, manualReviewPath, manualReviewCount: manualReviewItems.length };
}
