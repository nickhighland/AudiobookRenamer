import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

import { AUDIO_EXTENSIONS } from "./defaults.js";
import { AudioFileCandidate } from "./types.js";

const PART_REGEX = /(part|pt|disc|cd)\s*([0-9ivx]+)/i;
const CHAPTER_REGEX = /(chapter|ch)\s*([0-9]+)/i;

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
  const [left, right] = normalized.split(" - ").map((s) => s.trim());

  const partMatch = normalized.match(PART_REGEX);
  const chapterMatch = normalized.match(CHAPTER_REGEX);

  const guessedAuthor = right ? toTitleCase(right) : undefined;
  const guessedTitle = left ? toTitleCase(left) : toTitleCase(normalized);

  return {
    guessedAuthor,
    guessedTitle,
    guessedPart: partMatch ? `Part ${partMatch[2].toUpperCase()}` : undefined,
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
