import OpenAI from "openai";
import { z } from "zod";

import { AudioFileCandidate, BookIdentity } from "./types.js";

const IDENTITY_FIELDS_GUIDE = [
  "Field definitions:",
  "- title: Canonical book title only; do not include part/chapter suffixes.",
  "- authors: Array of author names. Keep best-known author only if uncertain, never fabricate.",
  "- part: Split-file/disc/book part indicator (e.g. 08, 2, Part 3).",
  "- chapter: Chapter indicator only (e.g. 14, Chapter 14).",
  "- series: Series name when clearly indicated or strongly supported by candidates.",
  "- volumeNumber: Volume/book number inside a series (e.g. 2).",
  "- confidence: Decimal between 0 and 1 inclusive.",
  "- notes: Short explanation of ambiguity or correction applied.",
].join("\n");

const IDENTITY_DECISION_RULES = [
  "Decision priorities:",
  "1) Get author/title split correct.",
  "2) Extract part/chapter/volume markers from suffixes and tokens.",
  "3) Keep title clean and canonical.",
  "4) Prefer provider-backed candidate titles over malformed filename fragments.",
  "Hard rules:",
  "- In 'Author - Title - 08', set authors=['Author'], title='Title', part='08'.",
  "- In 'Author - Title 2 of 9', set part='2' and remove '2 of 9' from title.",
  "- Never leave trailing standalone numeric suffix in title when it clearly marks a part.",
  "- Do not invent unknown metadata.",
].join("\n");

const IDENTITY_EXAMPLES = [
  "Examples:",
  "Input: Michael Crichton - Rising Sun - 08.mp3",
  'Output: {"title":"Rising Sun","authors":["Michael Crichton"],"part":"08","confidence":0.95}',
  "Input: Brandon Sanderson - Mistborn 3 of 12.m4b",
  'Output: {"title":"Mistborn","authors":["Brandon Sanderson"],"part":"3","confidence":0.92}',
  "Input: The Expanse - Book 2 - Chapter 14.mp3",
  'Output: {"title":"The Expanse","authors":["Unknown Author"],"volumeNumber":"2","chapter":"14","confidence":0.62}',
  "Input: 01 - Dune - Frank Herbert.mp3",
  'Output: {"title":"Dune","authors":["Frank Herbert"],"part":"01","confidence":0.88}',
].join("\n");

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
      IDENTITY_FIELDS_GUIDE,
      IDENTITY_DECISION_RULES,
      IDENTITY_EXAMPLES,
      "If a guessed field looks obviously wrong (e.g. guessedAuthor contains 'of'), correct it.",
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
          "You normalize bad audiobook file names into structured metadata. Extract only what can be inferred from text. Confidence must be 0..1. Prefer correcting obvious author/title swaps and removing part suffixes from titles.",
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
      return normalizeIdentity(candidate, {
        title: candidate.guessedTitle ?? "Unknown Title",
        authors: [candidate.guessedAuthor ?? "Unknown Author"],
        part: candidate.guessedPart,
        chapter: candidate.guessedChapter,
        confidence: 0.3,
        notes: "OpenAI returned empty response; fallback used.",
      });
    }

    const normalized = extractJsonObject(content);
    if (!normalized) {
      return normalizeIdentity(candidate, {
        title: candidate.guessedTitle ?? "Unknown Title",
        authors: [candidate.guessedAuthor ?? "Unknown Author"],
        part: candidate.guessedPart,
        chapter: candidate.guessedChapter,
        confidence: 0.25,
        notes: "OpenAI response was not valid JSON; fallback used.",
      });
    }

    const parsed = IdentitySchema.safeParse(JSON.parse(normalized));
    if (!parsed.success) {
      return normalizeIdentity(candidate, {
        title: candidate.guessedTitle ?? "Unknown Title",
        authors: [candidate.guessedAuthor ?? "Unknown Author"],
        part: candidate.guessedPart,
        chapter: candidate.guessedChapter,
        confidence: 0.25,
        notes: "OpenAI response schema mismatch; fallback used.",
      });
    }

    return normalizeIdentity(candidate, parsed.data);
  }

  async reconcileIdentity(
    candidate: AudioFileCandidate,
    draft: BookIdentity,
    providerCandidates: Array<{ provider: string; title: string; authors: string[]; publishedYear?: string }>,
  ): Promise<BookIdentity> {
    const prompt = [
      "Reconcile audiobook identity from noisy filename data and candidate books.",
      "Return strict JSON with keys: title, authors, part, chapter, series, volumeNumber, confidence, notes.",
      IDENTITY_FIELDS_GUIDE,
      IDENTITY_DECISION_RULES,
      IDENTITY_EXAMPLES,
      "If a filename has a numeric suffix (like '- 08' or '8 of 9') and candidate titles match without it, treat that number as part.",
      "Prefer real candidate titles over malformed filename fragments when confidence supports it.",
      `relativePath: ${candidate.relativePath}`,
      `fileName: ${candidate.fileName}`,
      `draftIdentity: ${JSON.stringify(draft)}`,
      `providerCandidates: ${JSON.stringify(providerCandidates.slice(0, 12))}`,
    ].join("\n");

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You correct audiobook identity fields. Be conservative but fix obvious author/title swaps and split-part suffixes.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return draft;
      }

      const normalized = extractJsonObject(content);
      if (!normalized) {
        return draft;
      }

      const parsed = IdentitySchema.safeParse(JSON.parse(normalized));
      if (!parsed.success) {
        return draft;
      }

      return normalizeIdentity(candidate, parsed.data);
    } catch {
      return draft;
    }
  }
}

function normalizeIdentity(candidate: AudioFileCandidate, identity: BookIdentity): BookIdentity {
  const normalized: BookIdentity = { ...identity };

  // Trust deterministic scanner hints for obvious split-file parts.
  if ((!normalized.part || normalized.part.trim().length === 0) && candidate.guessedPart) {
    normalized.part = candidate.guessedPart;
  }

  const title = (normalized.title || "").trim();
  const ofTotal = title.match(/^(.*?)(?:\s*-\s*|\s+)([0-9]{1,3})\s*of\s*[0-9]{1,3}$/i);
  if (ofTotal) {
    normalized.title = ofTotal[1].trim();
    if (!normalized.part) {
      normalized.part = ofTotal[2];
    }
  }

  const trailingPart = normalized.title.match(/^(.*?)(?:\s*-\s*|\s+)([0-9]{1,3})$/);
  if (trailingPart && !normalized.part) {
    const n = Number(trailingPart[2]);
    if (n > 0 && n < 1000) {
      normalized.title = trailingPart[1].trim();
      normalized.part = trailingPart[2];
    }
  }

  if (!normalized.title || normalized.title.trim().length === 0) {
    normalized.title = candidate.guessedTitle ?? "Unknown Title";
  }

  return normalized;
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
