import path from "node:path";

import sanitize from "sanitize-filename";

import { DEFAULT_BOOK_FOLDER_TEMPLATE, DEFAULT_NAMING_TEMPLATE } from "./defaults.js";
import { NameTemplateContext } from "./types.js";

const TOKEN_REGEX = /\{([a-zA-Z0-9_]+)\}/g;

const TRIM_SEPARATOR_REGEX = /^\s*[-_.|:]+\s*|\s*[-_.|:]+\s*$/g;
const SEPARATOR_LITERAL_REGEX = /^[\s\-_.|:]+$/;

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
  const parts: Array<{ type: "literal" | "value"; text: string }> = [];
  let cursor = 0;

  for (const match of segment.matchAll(TOKEN_REGEX)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push({ type: "literal", text: segment.slice(cursor, start) });
    }

    const token = match[1] as keyof NameTemplateContext;
    parts.push({ type: "value", text: tokenValue(ctx, token) });
    cursor = start + match[0].length;
  }

  if (cursor < segment.length) {
    parts.push({ type: "literal", text: segment.slice(cursor) });
  }

  if (parts.length === 0) {
    return segment;
  }

  const hasValueBefore = (index: number): boolean => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (parts[i].type === "value") {
        return parts[i].text.trim().length > 0;
      }
    }
    return false;
  };

  const hasValueAfter = (index: number): boolean => {
    for (let i = index + 1; i < parts.length; i += 1) {
      if (parts[i].type === "value") {
        return parts[i].text.trim().length > 0;
      }
    }
    return false;
  };

  const rendered = parts
    .flatMap((part, index) => {
      if (part.type === "value") {
        return part.text.trim().length > 0 ? [part.text] : [];
      }

      if (SEPARATOR_LITERAL_REGEX.test(part.text) && (!hasValueBefore(index) || !hasValueAfter(index))) {
        return [];
      }

      return [part.text];
    })
    .join("");

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
