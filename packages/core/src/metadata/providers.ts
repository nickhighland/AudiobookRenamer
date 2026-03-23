import axios from "axios";

import { BookIdentity, BookMetadata, MetadataProviderName, MetadataSearchResult } from "../types.js";

export interface MetadataProvider {
  readonly name: MetadataProviderName;
  lookup(identity: BookIdentity): Promise<BookMetadata | null>;
  search(query: string): Promise<BookMetadata[]>;
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
    const response = await axios.get(url, { timeout: 12000 });
    const books = Array.isArray(response.data?.books) ? response.data.books : [];

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
    const response = await axios.get(url, { timeout: 12000 });
    const docs = Array.isArray(response.data?.docs) ? response.data.docs : [];

    return docs.slice(0, 5).map((best: any) => {
      const year = best.first_publish_year ? String(best.first_publish_year) : undefined;
      const coverUrl = best.cover_i
        ? `https://covers.openlibrary.org/b/id/${best.cover_i}-L.jpg`
        : undefined;

      return {
        title: best.title ?? query,
        subtitle: undefined,
        authors: Array.isArray(best.author_name) && best.author_name.length > 0 ? best.author_name : ["Unknown Author"],
        publishedYear: year,
        language: Array.isArray(best.language) ? best.language[0] : undefined,
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

  async search(query: string): Promise<BookMetadata[]> {
    const encoded = encodeURIComponent(query.trim());
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=5`;
    const response = await axios.get(url, { timeout: 12000 });
    const items = Array.isArray(response.data?.items) ? response.data.items : [];

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
          publishedYear: volumeInfo.publishedDate?.slice(0, 4),
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

export function createProviders(order: MetadataProviderName[]): MetadataProvider[] {
  const map: Record<string, MetadataProvider> = {
    librivox: new LibriVoxProvider(),
    openlibrary: new OpenLibraryProvider(),
    googlebooks: new GoogleBooksProvider(),
  };

  return order.map((name) => map[name]).filter(Boolean);
}

export async function searchMetadata(
  query: string,
  providerOrder: MetadataProviderName[],
): Promise<MetadataSearchResult[]> {
  const providers = createProviders(providerOrder);
  const output: MetadataSearchResult[] = [];

  for (const provider of providers) {
    try {
      const results = await provider.search(query);
      for (const metadata of results) {
        output.push({ provider: provider.name, metadata });
      }
    } catch {
      // Individual provider failures should not break search.
    }
  }

  return output;
}
