export type AudioExtension =
  | ".m4b"
  | ".mp3"
  | ".m4a"
  | ".aac"
  | ".flac"
  | ".ogg"
  | ".opus";

export interface AudioFileCandidate {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: AudioExtension;
  sizeBytes: number;
  guessedAuthor?: string;
  guessedTitle?: string;
  guessedPart?: string;
  guessedChapter?: string;
}

export interface BookIdentity {
  title: string;
  authors: string[];
  part?: string;
  chapter?: string;
  series?: string;
  volumeNumber?: string;
  confidence: number;
  notes?: string;
}

export interface BookMetadata {
  title: string;
  subtitle?: string;
  authors: string[];
  narrators?: string[];
  series?: string;
  seriesSequence?: string;
  description?: string;
  publishedYear?: string;
  language?: string;
  isbn?: string;
  asin?: string;
  coverUrl?: string;
  source: string;
}

export type MetadataProviderName = "librivox" | "openlibrary" | "googlebooks";

export interface MetadataSearchResult {
  provider: MetadataProviderName;
  metadata: BookMetadata;
}

export interface NameTemplateContext {
  author: string;
  title: string;
  part?: string;
  chapter?: string;
  series?: string;
  seriesNumber?: string;
  ext: string;
}

export interface OrganizerConfig {
  inputDir: string;
  outputDir: string;
  recursive?: boolean;
  dryRun?: boolean;
  overwrite?: boolean;
  metadataProviderOrder: MetadataProviderName[];
  openAiModel?: string;
  namingTemplate?: string;
  createBookFolder?: boolean;
  conflictPolicy?: "skip" | "rename" | "merge" | "manual_review";
  manualReviewDir?: string;
}

export interface OrganizeAction {
  source: string;
  destination: string;
  metadataPath?: string;
  metadata?: BookMetadata;
  status?: "moved" | "skipped" | "manual_review";
  reason?: string;
}

export interface ManualReviewItem {
  source: string;
  proposedDestination: string;
  reason: string;
  metadata?: BookMetadata;
}

export interface ManualReviewDecision {
  source: string;
  action: "approve" | "skip" | "custom_destination";
  destination?: string;
  metadataOverride?: BookMetadata;
}

export interface ApplyManualReviewResult {
  moved: OrganizeAction[];
  skipped: OrganizeAction[];
  warnings: string[];
}

export interface OrganizeResult {
  actions: OrganizeAction[];
  warnings: string[];
  manualReviewPath?: string;
  manualReviewCount: number;
}
