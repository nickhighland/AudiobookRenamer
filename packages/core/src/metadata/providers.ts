import axios from "axios";

import { BookIdentity, BookMetadata, MetadataProviderName, MetadataSearchResult } from "../types.js";

interface ProviderOptions {
  googleBooksApiKey?: string;
}

export interface MetadataProviderFailure {
  provider: MetadataProviderName;
  query: string;
  message: string;
  status?: number;
  code?: string;
  retryable: boolean;
}

export interface MetadataSearchDiagnostics {
  query: string;
  providerFailures: MetadataProviderFailure[];
}

export interface MetadataSearchWithDiagnosticsResult {
  results: MetadataSearchResult[];
  diagnostics: MetadataSearchDiagnostics;
}

export interface MetadataProvider {
  readonly name: MetadataProviderName;
  lookup(identity: BookIdentity): Promise<BookMetadata | null>;
  search(query: string): Promise<BookMetadata[]>;
}

const REQUEST_HEADERS = {
  "User-Agent": "AudiobookRenamer/0.1 (+https://github.com/nickhighland/AudiobookRenamer)",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryProviderError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;

  const code = error.code ?? "";
  if (code === "ECONNABORTED" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return true;
  }

  const status = error.response?.status;
  if (!status) return false;
  return status === 429 || status >= 500;
}

export function toProviderFailure(provider: MetadataProviderName, query: string, error: unknown): MetadataProviderFailure {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const code = error.code;
    const apiMessage =
      typeof error.response?.data?.error === "string"
        ? error.response.data.error
        : typeof error.response?.data?.error?.message === "string"
          ? error.response.data.error.message
          : undefined;
    const reason = apiMessage ?? error.message ?? "Unknown provider error";

    return {
      provider,
      query,
      message: status ? `HTTP ${status}: ${reason}` : reason,
      status,
      code,
      retryable: shouldRetryProviderError(error),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    provider,
    query,
    message,
    retryable: false,
  };
}

async function getJsonWithRetry(
  url: string,
  options?: { timeoutMs?: number; maxRetries?: number; acceptedStatuses?: number[] },
): Promise<{ data: unknown; status: number }> {
  const timeoutMs = options?.timeoutMs ?? 12000;
  const maxRetries = options?.maxRetries ?? 2;
  const acceptedStatuses = options?.acceptedStatuses ?? [];

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await axios.get(url, {
        timeout: timeoutMs,
        headers: REQUEST_HEADERS,
        validateStatus: (status) => (status >= 200 && status < 300) || acceptedStatuses.includes(status),
      });
      return { data: response.data, status: response.status };
    } catch (error) {
      if (attempt < maxRetries && shouldRetryProviderError(error)) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Provider request failed after retries");
}

export class LibriVoxProvider implements MetadataProvider {
  readonly name = "librivox";

  async search(query: string): Promise<BookMetadata[]> {
    const params = new URLSearchParams({
      title: query,
      format: "json",
      limit: "10",
      extended: "1",
    });

    const url = `https://librivox.org/api/feed/audiobooks/?${params.toString()}`;
    const response = await getJsonWithRetry(url, { acceptedStatuses: [404] });
    if (response.status === 404) {
      // LibriVox returns 404 for no matches on some title queries.
      return [];
    }

    const books = Array.isArray((response.data as any)?.books) ? (response.data as any).books : [];

    return books.slice(0, 5).map((best: any) => {
      const authors = Array.isArray(best.authors)
        ? best.authors
            .map((a: { first_name?: string; last_name?: string }) =>
              [a.first_name, a.last_name].filter(Boolean).join(" ").trim(),
            )
            .filter(Boolean)
        : [];

      const language =
        Array.isArray(best.language) && best.language.length > 0
          ? best.language[0]?.name ?? best.language[0]
          : typeof best.language === "string"
            ? best.language
            : undefined;

      return {
        title: best.title ?? query,
        authors: authors.length > 0 ? authors : ["Unknown Author"],
        description: best.description,
        language,
        coverUrl: best.url_image,
        source: this.name,
      } as BookMetadata;
    });
  }

  async lookup(identity: BookIdentity): Promise<BookMetadata | null> {
    const results = await this.search(identity.title);
    return results[0] ?? null;
  }
}

export class OpenLibraryProvider implements MetadataProvider {
  readonly name = "openlibrary";

  async search(query: string): Promise<BookMetadata[]> {
    const encoded = encodeURIComponent(query.trim());
    const url = `https://openlibrary.org/search.json?q=${encoded}&limit=5`;
    const response = await getJsonWithRetry(url);
    const docs = Array.isArray((response.data as any)?.docs) ? (response.data as any).docs : [];

    return docs.slice(0, 5).map((best: any) => {
      const year = best.first_publish_year ? String(best.first_publish_year) : undefined;
      const coverUrl = best.cover_i
        ? `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`
        : undefined;

      return {
        title: best.title ?? query,
        subtitle: undefined,
        authors: Array.isArray(best.author_name) && best.author_name.length > 0 ? best.author_name : ["Unknown Author"],
        publisher: Array.isArray(best.publisher) ? best.publisher[0] : undefined,
        publishedDate: best.first_publish_year ? String(best.first_publish_year) : undefined,
        publishedYear: year,
        language: Array.isArray(best.language) ? best.language[0] : undefined,
        genres: Array.isArray(best.subject) ? best.subject.slice(0, 5) : undefined,
        isbn: Array.isArray(best.isbn) ? best.isbn[0] : undefined,
        coverUrl,
        source: this.name,
      } as BookMetadata;
    });
  }

  async lookup(identity: BookIdentity): Promise<BookMetadata | null> {
    const author = identity.authors[0] ?? "";
    const results = await this.search(`${identity.title} ${author}`.trim());
    return results[0] ?? null;
  }
}

export class GoogleBooksProvider implements MetadataProvider {
  readonly name = "googlebooks";
  private readonly apiKey?: string;

  constructor(options?: ProviderOptions) {
    this.apiKey = options?.googleBooksApiKey;
  }

  async search(query: string): Promise<BookMetadata[]> {
    const encoded = encodeURIComponent(query.trim());
    const keyParam = this.apiKey ? `&key=${encodeURIComponent(this.apiKey)}` : "";
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=5${keyParam}`;
    const response = await getJsonWithRetry(url);
    const items = Array.isArray((response.data as any)?.items) ? (response.data as any).items : [];

    return items
      .slice(0, 5)
      .map((item: any) => item?.volumeInfo)
      .filter(Boolean)
      .map((volumeInfo: any) => {
        const identifiers = Array.isArray(volumeInfo.industryIdentifiers)
          ? volumeInfo.industryIdentifiers
          : [];
        const isbn = identifiers.find((it: { type: string }) => it.type.includes("ISBN"))?.identifier;

        return {
          title: volumeInfo.title ?? query,
          subtitle: volumeInfo.subtitle,
          authors: Array.isArray(volumeInfo.authors) && volumeInfo.authors.length > 0 ? volumeInfo.authors : ["Unknown Author"],
          description: volumeInfo.description,
          publisher: volumeInfo.publisher,
          publishedDate: volumeInfo.publishedDate,
          publishedYear: volumeInfo.publishedDate?.slice(0, 4),
          genres: Array.isArray(volumeInfo.categories) ? volumeInfo.categories : undefined,
          language: volumeInfo.language,
          isbn,
          coverUrl: volumeInfo.imageLinks?.thumbnail,
          source: this.name,
        } as BookMetadata;
      });
  }

  async lookup(identity: BookIdentity): Promise<BookMetadata | null> {
    const author = identity.authors[0] ?? "";
    const results = await this.search(`intitle:${identity.title} inauthor:${author}`.trim());
    return results[0] ?? null;
  }
}

export function createProviders(order: MetadataProviderName[], options?: ProviderOptions): MetadataProvider[] {
  const map: Record<string, MetadataProvider> = {
    librivox: new LibriVoxProvider(),
    openlibrary: new OpenLibraryProvider(),
    googlebooks: new GoogleBooksProvider(options),
  };

  return order.map((name) => map[name]).filter(Boolean);
}

export async function searchMetadata(
  query: string,
  providerOrder: MetadataProviderName[],
  options?: ProviderOptions,
): Promise<MetadataSearchResult[]> {
  const detailed = await searchMetadataWithDiagnostics(query, providerOrder, options);
  return detailed.results;
}

export async function searchMetadataWithDiagnostics(
  query: string,
  providerOrder: MetadataProviderName[],
  options?: ProviderOptions,
): Promise<MetadataSearchWithDiagnosticsResult> {
  const providers = createProviders(providerOrder, options);
  const output: MetadataSearchResult[] = [];
  const providerFailures: MetadataProviderFailure[] = [];

  for (const provider of providers) {
    try {
      const results = await provider.search(query);
      for (const metadata of results) {
        output.push({ provider: provider.name, metadata });
      }
    } catch (error: unknown) {
      providerFailures.push(toProviderFailure(provider.name, query, error));
    }
  }

  return {
    results: output,
    diagnostics: {
      query,
      providerFailures,
    },
  };
}
