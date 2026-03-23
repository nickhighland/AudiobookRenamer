import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

import { AUDIO_EXTENSIONS } from "./defaults.js";
import { AudioFileCandidate } from "./types.js";

const PART_REGEX = /(part|pt|disc|cd)\s*([0-9ivx]+)/i;
const CHAPTER_REGEX = /(chapter|ch)\s*([0-9]+)/i;
const OF_TOTAL_REGEX = /\b([0-9]+)\s*of\s*([0-9]+)\b/i;
const TRAILING_PART_REGEX = /^(.*?)(?:\s*-\s*|\s+)([0-9]{1,3})$/;

function toTitleCase(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function guessFromFileName(fileName: string): Pick<AudioFileCandidate, "guessedAuthor" | "guessedTitle" | "guessedPart" | "guessedChapter"> {
  const base = fileName.replace(/\.[^.]+$/, "");
  const normalized = base.replace(/[._]/g, " ").replace(/\s+-\s+/g, " - ");
  const parts = normalized.split(" - ").map((s) => s.trim()).filter(Boolean);
  const left = parts[0];
  const right = parts.length > 1 ? parts.slice(1).join(" - ") : "";

  const partMatch = normalized.match(PART_REGEX);
  const chapterMatch = normalized.match(CHAPTER_REGEX);
  const ofTotalMatch = normalized.match(OF_TOTAL_REGEX);

  // Common audiobook convention: "Author - Title 1 of 9"
  // Treat left side as author and right side as title/details.
  let guessedAuthor = left ? toTitleCase(left) : undefined;
  let guessedTitle = right ? toTitleCase(right) : toTitleCase(normalized);
  let guessedPart = partMatch ? String(partMatch[2]).toUpperCase() : undefined;

  if (right) {
    const rightOfTotal = right.match(OF_TOTAL_REGEX);
    if (rightOfTotal) {
      guessedPart = rightOfTotal[1];
      guessedTitle = toTitleCase(right.replace(rightOfTotal[0], "").replace(/[-_]+$/g, "").trim());
    }

    // Common split-audiobook pattern: "Author - Title - 08"
    if (!guessedPart) {
      const trailingPart = right.match(TRAILING_PART_REGEX);
      if (trailingPart) {
        const maybeTitle = trailingPart[1].trim();
        const maybePart = trailingPart[2];
        // Ignore likely year-like suffixes when deciding parts.
        const n = Number(maybePart);
        if (n > 0 && n < 1000) {
          guessedPart = maybePart;
          guessedTitle = toTitleCase(maybeTitle);
        }
      }
    }
  }

  // Single segment fallback, e.g. "The Bottoms 2 of 9 - Joe R Lansdale" or no separator.
  if (!right && ofTotalMatch) {
    guessedPart = ofTotalMatch[1];
    guessedTitle = toTitleCase(normalized.replace(ofTotalMatch[0], "").trim());
  }

  if (guessedTitle && guessedAuthor && guessedTitle.toLowerCase() === guessedAuthor.toLowerCase()) {
    guessedAuthor = undefined;
  }

  if (!guessedTitle) {
    guessedTitle = toTitleCase(normalized);
  }

  return {
    guessedAuthor,
    guessedTitle,
    guessedPart,
    guessedChapter: chapterMatch ? `Chapter ${chapterMatch[2]}` : undefined,
  };
}

export async function scanAudiobookFiles(rootDir: string, recursive = true): Promise<AudioFileCandidate[]> {
  const globs = recursive ? ["**/*"] : ["*"];
  const entries = await fg(globs, {
    cwd: rootDir,
    onlyFiles: true,
    dot: false,
    absolute: false,
    suppressErrors: true,
  });

  const lowerExts = new Set(AUDIO_EXTENSIONS);
  const candidates: AudioFileCandidate[] = [];

  for (const relativePath of entries) {
    const extension = path.extname(relativePath).toLowerCase() as AudioFileCandidate["extension"];
    if (!lowerExts.has(extension)) {
      continue;
    }

    const absolutePath = path.resolve(rootDir, relativePath);
    const stat = await fs.stat(absolutePath);
    const fileName = path.basename(relativePath);
    const guessed = guessFromFileName(fileName);

    candidates.push({
      absolutePath,
      relativePath,
      fileName,
      extension,
      sizeBytes: stat.size,
      ...guessed,
    });
  }

  return candidates;
}
