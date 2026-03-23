import OpenAI from "openai";
import { z } from "zod";

import { AudioFileCandidate, BookIdentity } from "./types.js";

const IdentitySchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  part: z.string().optional(),
  chapter: z.string().optional(),
  series: z.string().optional(),
  volumeNumber: z.string().optional(),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
});

export class OpenAiIdentifier {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = "gpt-5-mini") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async identify(candidate: AudioFileCandidate): Promise<BookIdentity> {
    const prompt = [
      "Infer audiobook identity details from poor filename data.",
      "Return strict JSON with keys: title, authors, part, chapter, series, volumeNumber, confidence, notes.",
      "Do not hallucinate if unknown; prefer conservative values and confidence.",
      "Important extraction rules:",
      "- In patterns like 'Author - Title 2 of 9', author is left side, title is right side without '2 of 9'.",
      "- If text contains 'N of M', set part to N.",
      "- If a guessed field looks obviously wrong (e.g. guessedAuthor contains 'of'), correct it.",
      `relativePath: ${candidate.relativePath}`,
      `fileName: ${candidate.fileName}`,
      `guessedTitle: ${candidate.guessedTitle ?? ""}`,
      `guessedAuthor: ${candidate.guessedAuthor ?? ""}`,
      `guessedPart: ${candidate.guessedPart ?? ""}`,
      `guessedChapter: ${candidate.guessedChapter ?? ""}`,
    ].join("\n");

    const messages = [
      {
        role: "system" as const,
        content:
          "You normalize bad audiobook file names. Extract only what can be inferred from text. Confidence must be 0..1. Prefer correcting obvious author/title swaps.",
      },
      {
        role: "user" as const,
        content: prompt,
      },
    ];

    let content: string | null | undefined;
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages,
      });
      content = completion.choices[0]?.message?.content;
    } catch {
      // Some models reject response_format json mode; retry with plain text JSON instructions.
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Return only a valid JSON object and no other text. Use keys: title, authors, part, chapter, series, volumeNumber, confidence, notes.",
          },
        ],
      });
      content = completion.choices[0]?.message?.content;
    }

    if (!content) {
      return {
        title: candidate.guessedTitle ?? "Unknown Title",
        authors: [candidate.guessedAuthor ?? "Unknown Author"],
        part: candidate.guessedPart,
        chapter: candidate.guessedChapter,
        confidence: 0.3,
        notes: "OpenAI returned empty response; fallback used.",
      };
    }

    const normalized = extractJsonObject(content);
    if (!normalized) {
      return {
        title: candidate.guessedTitle ?? "Unknown Title",
        authors: [candidate.guessedAuthor ?? "Unknown Author"],
        part: candidate.guessedPart,
        chapter: candidate.guessedChapter,
        confidence: 0.25,
        notes: "OpenAI response was not valid JSON; fallback used.",
      };
    }

    const parsed = IdentitySchema.safeParse(JSON.parse(normalized));
    if (!parsed.success) {
      return {
        title: candidate.guessedTitle ?? "Unknown Title",
        authors: [candidate.guessedAuthor ?? "Unknown Author"],
        part: candidate.guessedPart,
        chapter: candidate.guessedChapter,
        confidence: 0.25,
        notes: "OpenAI response schema mismatch; fallback used.",
      };
    }

    return parsed.data;
  }
}

function extractJsonObject(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return trimmed.slice(start, end + 1);
}

export async function listOpenAiModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey });
  const response = await client.models.list();

  const preferred = [
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
  ];

  const fetched = response.data
    .map((model) => model.id)
    .filter((id) => id.startsWith("gpt-4") || id.startsWith("gpt-5"))
    .sort((a, b) => a.localeCompare(b));

  const merged = [...new Set([...preferred, ...fetched])];
  return merged;
}
