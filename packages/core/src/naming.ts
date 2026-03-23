import path from "node:path";

import sanitize from "sanitize-filename";

import { DEFAULT_BOOK_FOLDER_TEMPLATE, DEFAULT_NAMING_TEMPLATE } from "./defaults.js";
import { NameTemplateContext } from "./types.js";

const TOKEN_REGEX = /\{([a-zA-Z0-9_]+)\}/g;

function sanitizeSegment(segment: string): string {
  return sanitize(segment).trim() || "Unknown";
}

function sanitizeSegmentAllowEmpty(segment: string): string {
  return sanitize(segment).trim();
}

export function renderTemplate(template: string, ctx: NameTemplateContext): string {
  return template.replace(TOKEN_REGEX, (_, token: keyof NameTemplateContext) => {
    const value = ctx[token] ?? "";
    return String(value);
  });
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
