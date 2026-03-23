import fs from "node:fs/promises";
import path from "node:path";

import { embedCoverInAudioIfPossible, embedMetadataInAudioIfPossible, writeCoverImage } from "./cover.js";
import { ApplyManualReviewResult, BookMetadata, ManualReviewDecision, ManualReviewItem, OrganizeAction } from "./types.js";

interface ReviewDocument {
  generatedAt: string;
  items: ManualReviewItem[];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function moveFile(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch {
    await fs.copyFile(source, destination);
    await fs.unlink(source);
  }
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

export async function applyManualReview(
  reviewFilePath: string,
  decisions: ManualReviewDecision[],
  dryRun = false,
  embedCoverInAudio = false,
  embedMetadataInAudio = true,
): Promise<ApplyManualReviewResult> {
  const raw = await fs.readFile(reviewFilePath, "utf-8");
  const reviewDoc = JSON.parse(raw) as ReviewDocument;

  const moved: OrganizeAction[] = [];
  const skipped: OrganizeAction[] = [];
  const warnings: string[] = [];

  const decisionMap = new Map(decisions.map((decision) => [decision.source, decision]));

  for (const item of reviewDoc.items) {
    const decision = decisionMap.get(item.source);
    if (!decision || decision.action === "skip") {
      skipped.push({
        source: item.source,
        destination: item.proposedDestination,
        metadata: item.metadata,
        status: "skipped",
        reason: "No approval decision provided.",
      });
      continue;
    }

    const destination = decision.action === "custom_destination" ? decision.destination : item.proposedDestination;
    if (!destination) {
      skipped.push({
        source: item.source,
        destination: item.proposedDestination,
        metadata: item.metadata,
        status: "skipped",
        reason: "custom_destination decision missing destination.",
      });
      continue;
    }

    if (await pathExists(destination)) {
      warnings.push(`Skipping ${item.source} because destination already exists: ${destination}`);
      skipped.push({
        source: item.source,
        destination,
        metadata: item.metadata,
        status: "skipped",
        reason: "Destination already exists.",
      });
      continue;
    }

    const action: OrganizeAction = {
      source: item.source,
      destination,
      metadata: decision.metadataOverride ?? item.metadata,
      status: "moved",
    };

    moved.push(action);

    if (dryRun) {
      continue;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await moveFile(item.source, destination);

    const effectiveMetadata = decision.metadataOverride ?? item.metadata;
    if (effectiveMetadata) {
      const metadataPath = await writeAudiobookshelfMetadata(path.dirname(destination), effectiveMetadata);
      const coverPath = await writeCoverImage(path.dirname(destination), effectiveMetadata);
      if (embedCoverInAudio && coverPath) {
        await embedCoverInAudioIfPossible(destination, coverPath);
      }
      if (embedMetadataInAudio) {
        await embedMetadataInAudioIfPossible(destination, effectiveMetadata);
      }
      action.metadataPath = metadataPath;
    }
  }

  return { moved, skipped, warnings };
}
