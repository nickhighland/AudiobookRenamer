import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_BOOK_FOLDER_TEMPLATE, DEFAULT_NAMING_TEMPLATE } from "./defaults.js";
import { embedCoverInAudioIfPossible, embedMetadataInAudioIfPossible, writeCoverImage } from "./cover.js";
import { createProviders } from "./metadata/providers.js";
import { buildFolderRelativePath, buildOutputRelativePath } from "./naming.js";
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

function isSuspiciousIdentity(identity: { title: string; authors: string[]; part?: string }): boolean {
  const title = identity.title?.trim() ?? "";
  const author = (identity.authors?.[0] ?? "").trim();
  if (!title) return true;
  if (/\b\d{1,3}\s*of\s*\d{1,3}\b/i.test(title)) return true;
  if (/(?:\s*-\s*|\s+)\d{1,3}$/.test(title) && !identity.part) return true;
  if (/\d{2,}/.test(author)) return true;
  return false;
}

export interface OrganizeProgressEvent {
  type:
    | "started"
    | "scan_complete"
    | "item_started"
    | "metadata_resolved"
    | "item_completed"
    | "warning"
    | "complete";
  index?: number;
  total?: number;
  source?: string;
  destination?: string;
  status?: "moved" | "skipped" | "manual_review";
  message?: string;
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch {
    await fs.copyFile(source, destination);
    await fs.unlink(source);
  }
}

function romanToNumber(token: string): number | null {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const input = token.toLowerCase();
  let total = 0;
  let prev = 0;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const value = map[input[i]];
    if (!value) return null;
    if (value < prev) total -= value;
    else total += value;
    prev = value;
  }
  return total > 0 ? total : null;
}

function normalizeNumericToken(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const digitMatch = trimmed.match(/\d+(?:\.\d+)?/);
  if (digitMatch) {
    return digitMatch[0];
  }

  const romanMatch = trimmed.match(/\b[ivxlcdm]+\b/i);
  if (romanMatch) {
    const romanValue = romanToNumber(romanMatch[0]);
    if (romanValue != null) {
      return String(romanValue);
    }
  }

  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
  };

  const wordMatch = trimmed.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/);
  if (wordMatch) {
    return String(words[wordMatch[1]]);
  }

  return undefined;
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
    publishedDate: metadata.publishedDate,
    publisher: metadata.publisher,
    description: metadata.description,
    genres: metadata.genres,
    language: metadata.language,
    isbn: metadata.isbn,
    asin: metadata.asin,
  };

  await fs.writeFile(outPath, JSON.stringify(absMetadata, null, 2), "utf-8");
  return outPath;
}

function templateContextFrom(metadata: BookMetadata, extension: string, part?: string, chapter?: string): NameTemplateContext {
  return {
    author: metadata.authors[0] ?? "Unknown Author",
    title: metadata.title,
    part: normalizeNumericToken(part),
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
  onProgress?: (event: OrganizeProgressEvent) => void,
  shouldStop?: () => boolean,
): Promise<OrganizeResult> {
  const warnings: string[] = [];
  const actions: OrganizeAction[] = [];
  const manualReviewItems: ManualReviewItem[] = [];
  const plannedDestinations = new Set<string>();

  const conflictPolicy = config.conflictPolicy ?? "manual_review";
  const fileOperation = config.fileOperation ?? "move";
  const highReliabilityThreshold = config.highReliabilityThreshold ?? 0.88;
  const manualReviewDir = config.manualReviewDir ?? path.resolve(config.outputDir, "manual-review");
  onProgress?.({ type: "started", message: "Scanning audiobook files..." });
  const candidates = await scanAudiobookFiles(config.inputDir, config.recursive ?? true);
  onProgress?.({ type: "scan_complete", total: candidates.length, message: `Found ${candidates.length} audio files.` });

  const identifier = new OpenAiIdentifier(openAiApiKey, config.openAiModel);
  const providers = createProviders(config.metadataProviderOrder, {
    googleBooksApiKey: config.providerApiKeys?.googleBooksApiKey,
  });

  for (const [idx, candidate] of candidates.entries()) {
    if (shouldStop?.()) {
      onProgress?.({
        type: "complete",
        total: candidates.length,
        message: "Stopped by user. Returning partial results.",
      });
      break;
    }

    onProgress?.({
      type: "item_started",
      index: idx + 1,
      total: candidates.length,
      source: candidate.relativePath,
      message: `Identifying ${candidate.relativePath}`,
    });
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
        onProgress?.({
          type: "warning",
          index: idx + 1,
          total: candidates.length,
          source: candidate.relativePath,
          message: `Metadata lookup failed: ${provider.name}`,
        });
      }
    }

    if (!metadata || metadata.source === "openai" || isSuspiciousIdentity(identity)) {
      const providerCandidates: Array<{ provider: string; title: string; authors: string[]; publishedYear?: string }> = [];
      const candidateQuery = [candidate.guessedAuthor, candidate.guessedTitle, candidate.fileName.replace(/\.[^.]+$/, "")]
        .filter(Boolean)
        .join(" ")
        .trim();

      for (const provider of providers) {
        try {
          const found = await provider.search(candidateQuery || identity.title);
          for (const item of found.slice(0, 3)) {
            providerCandidates.push({
              provider: provider.name,
              title: item.title,
              authors: item.authors,
              publishedYear: item.publishedYear,
            });
          }
        } catch {
          // ignore provider candidate collection failures
        }
      }

      const reconciled = await identifier.reconcileIdentity(candidate, identity, providerCandidates);
      identity.title = reconciled.title;
      identity.authors = reconciled.authors;
      identity.part = reconciled.part;
      identity.chapter = reconciled.chapter;
      identity.series = reconciled.series;
      identity.volumeNumber = reconciled.volumeNumber;
      identity.confidence = reconciled.confidence;

      if (providerCandidates.length > 0) {
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
            // ignore in second lookup pass
          }
        }
      }
    }

    onProgress?.({
      type: "metadata_resolved",
      index: idx + 1,
      total: candidates.length,
      source: candidate.relativePath,
      message: `Metadata selected for ${candidate.relativePath}`,
    });

    const ctx = templateContextFrom(metadata, candidate.extension, identity.part, identity.chapter);
    const folderTemplate = config.createBookFolder === false
      ? ""
      : (config.folderTemplate ?? DEFAULT_BOOK_FOLDER_TEMPLATE);
    const relativeBookFolder = folderTemplate ? buildFolderRelativePath(folderTemplate, ctx) : "";
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
        onProgress?.({
          type: "item_completed",
          index: idx + 1,
          total: candidates.length,
          source: candidate.relativePath,
          destination,
          status: "skipped",
          message: reason,
        });
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
        onProgress?.({
          type: "item_completed",
          index: idx + 1,
          total: candidates.length,
          source: candidate.relativePath,
          destination,
          status: "manual_review",
          message: reason,
        });
        continue;
      }

      if (conflictPolicy === "rename_if_high_reliability") {
        if (identity.confidence >= highReliabilityThreshold) {
          destination = await findAvailablePath(destination);
        } else {
          actions.push({
            source: candidate.absolutePath,
            destination,
            metadata,
            status: "manual_review",
            reason: `${reason} Confidence ${identity.confidence.toFixed(2)} below threshold ${highReliabilityThreshold.toFixed(2)}.`,
            confidence: identity.confidence,
          });
          manualReviewItems.push({
            source: candidate.absolutePath,
            proposedDestination: destination,
            reason: `${reason} Low confidence match requires review.`,
            metadata,
          });
          onProgress?.({
            type: "item_completed",
            index: idx + 1,
            total: candidates.length,
            source: candidate.relativePath,
            destination,
            status: "manual_review",
            message: `Low confidence (${identity.confidence.toFixed(2)}). Sent to manual review.`,
          });
          continue;
        }
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
      confidence: identity.confidence,
    });

    if (config.dryRun) {
      onProgress?.({
        type: "item_completed",
        index: idx + 1,
        total: candidates.length,
        source: candidate.relativePath,
        destination,
        status: "moved",
        message: `Dry run: planned ${fileOperation} action recorded.`,
      });
      continue;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });

    const tempDestination = path.join(
      path.dirname(destination),
      `${path.basename(destination)}.processing-${Date.now()}-${idx + 1}`,
    );

    let metadataPath: string | undefined;
    try {
      // Work on a temporary output copy and only finalize to destination when all processing succeeds.
      await fs.copyFile(candidate.absolutePath, tempDestination);

      const bookFolder = path.dirname(tempDestination);
      metadataPath = await writeAudiobookshelfMetadata(bookFolder, metadata);
      const coverPath = await writeCoverImage(bookFolder, metadata);
      if (config.embedCoverInAudio && coverPath) {
        await embedCoverInAudioIfPossible(tempDestination, coverPath);
      }
      if (config.embedMetadataInAudio !== false) {
        await embedMetadataInAudioIfPossible(tempDestination, metadata);
      }

      await moveFile(tempDestination, destination);

      if (fileOperation === "move") {
        await fs.unlink(candidate.absolutePath);
      }
    } catch (error) {
      if (await pathExists(tempDestination)) {
        await fs.unlink(tempDestination);
      }
      throw error;
    }

    actions[actions.length - 1].metadataPath = metadataPath;
    onProgress?.({
      type: "item_completed",
      index: idx + 1,
      total: candidates.length,
      source: candidate.relativePath,
      destination,
      status: "moved",
      message: `${fileOperation === "copy" ? "Copied" : "Moved"} and wrote metadata for ${candidate.relativePath}`,
    });
  }

  let manualReviewPath: string | undefined;
  if (manualReviewItems.length > 0) {
    manualReviewPath = await writeManualReviewFile(manualReviewDir, manualReviewItems);
  }

  onProgress?.({
    type: "complete",
    total: candidates.length,
    message: `Completed. ${actions.length} actions, ${warnings.length} warnings, ${manualReviewItems.length} manual review item(s).`,
  });

  return { actions, warnings, manualReviewPath, manualReviewCount: manualReviewItems.length };
}
