# Audiobook Namer and Organizer

Cross-platform audiobook organizer with:
- OpenAI-assisted filename understanding for messy source files
- Free metadata lookup with LibriVox (audiobook-focused) plus OpenLibrary/Google Books fallback
- Rename/move rules using customizable naming templates
- Audiobookshelf-compatible metadata output (`metadata.abs` + optional `cover.jpg`)
- Desktop app (macOS/Windows via Electron), REST API, and Docker deployment

## Recommended Default for Audiobookshelf

Use one folder per book under author:
- Book folder template: `{author}/{title}`
- File template: `{part} - {title} - {author}{ext}`

This keeps each book self-contained for Audiobookshelf scans and metadata imports.

## Template Tokens

Available tokens in naming templates:
- `{author}`
- `{title}`
- `{part}`
- `{chapter}`
- `{series}`
- `{seriesNumber}`
- `{ext}` (file extension, including leading dot)

Example custom template:
- `author/title/part - Title - Author` equivalent:
  - `{author}/{title}/{part} - {title} - {author}{ext}`

## 1) Install

```bash
npm install
```

## 2) Desktop App (macOS/Windows)

```bash
npm run dev:desktop
```

In the UI, provide:
- Input folder (messy audiobook files)
- Output folder (organized library)
- OpenAI API key
- Naming template
- Conflict policy (`manual_review` recommended)

The desktop app now includes a guided Manual Review panel:
- Paste the generated review JSON path
- Load items
- If a match is wrong, use per-item metadata search and select a corrected match
- Set decision per item (`approve`, `skip`, or `custom_destination`)
- Apply decisions in dry-run or live mode

### Build Installers

```bash
# current OS desktop package
npm run dist:desktop

# explicit targets
npm run dist:desktop:mac
npm run dist:desktop:win
```

Artifacts are written to `apps/desktop/release`.

## 3) API Server

```bash
cp .env.example .env
npm run dev:api
```

Health endpoint:
- `GET http://localhost:4033/health`

Scan endpoint:

```bash
curl -X POST http://localhost:4033/scan \
  -H "Content-Type: application/json" \
  -d '{"inputDir":"/path/to/input","recursive":true}'
```

Organize endpoint:

```bash
curl -X POST http://localhost:4033/organize \
  -H "Content-Type: application/json" \
  -d '{
    "inputDir":"/path/to/input",
    "outputDir":"/path/to/output",
    "dryRun":true,
    "metadataProviderOrder":["librivox","openlibrary"],
    "namingTemplate":"{part} - {title} - {author}{ext}",
    "conflictPolicy":"manual_review",
    "openAiModel":"gpt-4.1-mini"
  }'
```

Apply manual review decisions endpoint:

```bash
curl -X POST http://localhost:4033/manual-review/apply \
  -H "Content-Type: application/json" \
  -d '{
    "reviewFilePath":"/path/to/output/manual-review/manual-review-2026-03-22T20-30-00-000Z.json",
    "dryRun":true,
    "decisions":[
      {
        "source":"/path/to/input/file1.m4b",
        "action":"approve"
      },
      {
        "source":"/path/to/input/file2.m4b",
        "action":"custom_destination",
        "destination":"/path/to/output/Author/Title/Part 2 - Title - Author.m4b"
      }
    ]
  }'
```

Metadata search endpoint (for corrected manual-review matches):

```bash
curl -X POST http://localhost:4033/metadata/search \
  -H "Content-Type: application/json" \
  -d '{
    "query":"The Hobbit J. R. R. Tolkien",
    "providers":["librivox","openlibrary"]
  }'
```

## 4) Docker

```bash
cp .env.example .env
docker compose up --build
```

Then call API at `http://localhost:4033`.

Mounted folders:
- `./data/input` -> `/data/input`
- `./data/output` -> `/data/output`

## Notes

- `dryRun: true` is recommended for first pass.
- Free audiobook metadata default is LibriVox (`librivox`), which is audiobook-specific and does not require paid credentials.
- Conflict handling policies:
  - `manual_review`: write conflicts to a JSON review file and do not move those files.
  - `skip`: ignore conflicts.
  - `rename`: auto-add suffix (`(2)`, `(3)`, ...).
  - `merge`: keep same destination stem with source-stem suffix.
- Manual review process:
  1. Run organize with `conflictPolicy: manual_review`.
  2. Open generated file in output `manual-review` folder.
  3. Create decisions (`approve`, `skip`, or `custom_destination`) and call `/manual-review/apply`.
