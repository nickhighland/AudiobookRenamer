import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import axios from "axios";

import { BookMetadata } from "./types.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? -1}`));
      }
    });
  });
}

export async function writeCoverImage(folder: string, metadata: BookMetadata): Promise<string | undefined> {
  const sourcePath = metadata.coverPath;
  const sourceUrl = metadata.coverUrl;
  const outPath = path.join(folder, "cover.jpg");

  if (sourcePath) {
    const exists = await pathExists(sourcePath);
    if (exists) {
      await fs.copyFile(sourcePath, outPath);
      return outPath;
    }
  }

  if (!sourceUrl) {
    return undefined;
  }

  try {
    const response = await axios.get<ArrayBuffer>(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
    });
    await fs.writeFile(outPath, Buffer.from(response.data));
    return outPath;
  } catch {
    return undefined;
  }
}

export async function embedCoverInAudioIfPossible(audioPath: string, coverPath: string): Promise<boolean> {
  const ext = path.extname(audioPath).toLowerCase();
  if (![".mp3", ".m4a", ".m4b"].includes(ext)) {
    return false;
  }

  const outputPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, ext)}.cover-temp${ext}`);

  const args = [
    "-y",
    "-i",
    audioPath,
    "-i",
    coverPath,
    "-map",
    "0",
    "-map",
    "1",
    "-c",
    "copy",
    "-disposition:v:0",
    "attached_pic",
    outputPath,
  ];

  try {
    await runCommand("ffmpeg", args);
    await fs.rename(outputPath, audioPath);
    return true;
  } catch {
    try {
      await fs.unlink(outputPath);
    } catch {
      // Ignore temp cleanup errors.
    }
    return false;
  }
}

function metadataToFfmpegPairs(metadata: BookMetadata): string[] {
  const year = metadata.publishedYear ?? metadata.publishedDate?.slice(0, 4);
  const date = metadata.publishedDate ?? metadata.publishedYear;
  const artist = metadata.authors.join(", ");
  const album = metadata.series ? `${metadata.series}${metadata.seriesSequence ? ` #${metadata.seriesSequence}` : ""}` : metadata.title;
  const genre = metadata.genres?.join("; ");

  const pairs: Array<[string, string | undefined]> = [
    ["title", metadata.title],
    ["album", album],
    ["artist", artist],
    ["album_artist", artist],
    ["comment", metadata.description],
    ["description", metadata.description],
    ["publisher", metadata.publisher],
    ["date", date],
    ["year", year],
    ["genre", genre],
    ["language", metadata.language],
    ["isbn", metadata.isbn],
  ];

  return pairs
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);
}

export async function embedMetadataInAudioIfPossible(audioPath: string, metadata: BookMetadata): Promise<boolean> {
  const ext = path.extname(audioPath).toLowerCase();
  if (![".mp3", ".m4a", ".m4b"].includes(ext)) {
    return false;
  }

  const outputPath = path.join(path.dirname(audioPath), `${path.basename(audioPath, ext)}.meta-temp${ext}`);
  const metadataPairs = metadataToFfmpegPairs(metadata);

  if (metadataPairs.length === 0) {
    return false;
  }

  const args = [
    "-y",
    "-i",
    audioPath,
    "-map",
    "0",
    "-c",
    "copy",
    ...metadataPairs,
    outputPath,
  ];

  try {
    await runCommand("ffmpeg", args);
    await fs.rename(outputPath, audioPath);
    return true;
  } catch {
    try {
      await fs.unlink(outputPath);
    } catch {
      // Ignore temp cleanup errors.
    }
    return false;
  }
}
