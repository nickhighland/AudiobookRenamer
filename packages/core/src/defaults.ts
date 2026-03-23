export const DEFAULT_NAMING_TEMPLATE = "{part} - {title} - {author}{ext}";

// Recommended for Audiobookshelf: one folder per book under author, metadata.abs in book folder.
export const DEFAULT_BOOK_FOLDER_TEMPLATE = "{author}/{title}";

export const AUDIO_EXTENSIONS = [
  ".m4b",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
] as const;
