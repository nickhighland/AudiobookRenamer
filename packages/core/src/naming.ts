import path from "node:path";

import sanitize from "sanitize-filename";

import { DEFAULT_BOOK_FOLDER_TEMPLATE, DEFAULT_NAMING_TEMPLATE } from "./defaults.js";
import { NameTemplateContext } from "./types.js";

const TOKEN_REGEX = /\{([a-zA-Z0-9_]+)\}/g;

const TRIM_SEPARATOR_REGEX = /^\s*[-_.|:]+\s*|\s*[-_.|:]+\s*$/g;

function normalizeExt(value: string): string {
  if (!value) return value;
  return value.startsWith(".") ? value : `.${value}`;
}

function tokenValue(ctx: NameTemplateContext, token: keyof NameTemplateContext): string {
  const raw = ctx[token] ?? "";
  if (token === "ext") {
    return normalizeExt(String(raw));
  }
  return String(raw);
}

function renderSegmentWithOptionalSeparators(segment: string, ctx: NameTemplateContext): string {
  let rendered = segment;

  const tokens = [...segment.matchAll(TOKEN_REGEX)].map((m) => m[1] as keyof NameTemplateContext);

  for (const token of tokens) {
    const placeholder = `{${token}}`;
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = tokenValue(ctx, token);

    if (!value) {
      // Remove adjacent separators if this optional token is empty.
      rendered = rendered.replace(new RegExp(`\\s*[-_.|:]+\\s*${escaped}`, "g"), " ");
      rendered = rendered.replace(new RegExp(`${escaped}\\s*[-_.|:]+\\s*`, "g"), " ");
      rendered = rendered.replace(new RegExp(escaped, "g"), "");
      continue;
    }

    rendered = rendered.replace(new RegExp(escaped, "g"), value);
  }

  return rendered.replace(TRIM_SEPARATOR_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

function sanitizeSegment(segment: string): string {
  return sanitize(segment).trim() || "Unknown";
}

function sanitizeSegmentAllowEmpty(segment: string): string {
  return sanitize(segment).trim();
}

export function renderTemplate(template: string, ctx: NameTemplateContext): string {
  return template
    .split("/")
    .map((segment) => renderSegmentWithOptionalSeparators(segment, ctx))
    .join("/");
}

export function buildOutputRelativePath(
  template: string | undefined,
  ctx: NameTemplateContext,
): string {
  const effectiveTemplate = template ?? DEFAULT_NAMING_TEMPLATE;
  const rendered = renderTemplate(effectiveTemplate, ctx)
    .split("/")
    .map((segment) => sanitizeSegmentAllowEmpty(segment))
    .filter((segment) => segment.length > 0)
    .map((segment) => sanitizeSegment(segment))
    .join("/");

  return rendered.endsWith(ctx.ext) ? rendered : `${rendered}${ctx.ext}`;
}

export function buildFolderRelativePath(
  template: string | undefined,
  ctx: NameTemplateContext,
): string {
  const effectiveTemplate = template ?? DEFAULT_BOOK_FOLDER_TEMPLATE;
  return renderTemplate(effectiveTemplate, ctx)
    .split("/")
    .map((segment) => sanitizeSegmentAllowEmpty(segment))
    .filter((segment) => segment.length > 0)
    .map((segment) => sanitizeSegment(segment))
    .join("/");
}

export function toBookFolder(author: string, title: string): string {
  return [sanitizeSegment(author), sanitizeSegment(title)].join(path.sep);
}
