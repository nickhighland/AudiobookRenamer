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

  constructor(apiKey: string, model = "gpt-4.1-mini") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async identify(candidate: AudioFileCandidate): Promise<BookIdentity> {
    const prompt = [
      "Infer audiobook identity details from poor filename data.",
      "Return strict JSON with keys: title, authors, part, chapter, series, volumeNumber, confidence, notes.",
      "Do not hallucinate if unknown; prefer conservative values and confidence.",
      `relativePath: ${candidate.relativePath}`,
      `fileName: ${candidate.fileName}`,
      `guessedTitle: ${candidate.guessedTitle ?? ""}`,
      `guessedAuthor: ${candidate.guessedAuthor ?? ""}`,
      `guessedPart: ${candidate.guessedPart ?? ""}`,
      `guessedChapter: ${candidate.guessedChapter ?? ""}`,
    ].join("\n");

    const completion = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You normalize bad audiobook file names. Extract only what can be inferred from text. Confidence must be 0..1.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
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

    const parsed = IdentitySchema.safeParse(JSON.parse(content));
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
