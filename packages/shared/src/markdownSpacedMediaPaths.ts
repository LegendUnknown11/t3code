import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Plugin } from "unified";
import { mediaKindFromPath } from "./mediaPreview.ts";

const MEDIA_EMBED =
  /!\[(?:\\[^\r\n]|[^[\]\\\r\n])*\]\(((?:\/(?![/\\])|[A-Za-z]:[/\\])(?:\\[^\r\n]|[^\\<>[\]`\r\n()]|\([^\\<>[\]`\r\n()]*\))+)\)/g;
const mediaPathParser = unified().use(remarkParse).use(remarkGfm);

function isEscaped(source: string, offset: number): boolean {
  let start = offset;
  while (source[start - 1] === "\\") start--;
  return (offset - start) % 2 !== 0;
}

function* spacedMediaPaths(source: string) {
  if (!/\]\((?:\/|[A-Za-z]:[/\\])/.test(source)) return;
  for (const match of source.matchAll(MEDIA_EMBED)) {
    const path = match[1]!;
    if (!/[ \t]/.test(path) || !mediaKindFromPath(path) || isEscaped(source, match.index)) {
      continue;
    }
    const end = match.index + match[0].length - 1;
    yield { opener: match.index, start: end - path.length, end };
  }
}

export function wrapSpacedMediaPaths(
  source: string,
  readTree = () => mediaPathParser.parse(source),
) {
  const candidates = [...spacedMediaPaths(source)];
  if (candidates.length === 0) return undefined;

  const textRanges: Array<[number, number]> = [];
  const literalRanges: Array<[number, number]> = [];
  const visit = (node: Root | RootContent) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if ("children" in node) node.children.forEach(visit);
    else if (start !== undefined && end !== undefined) {
      (node.type === "text" ? textRanges : literalRanges).push([start, end]);
    }
  };
  visit(readTree());

  const parts: string[] = [];
  const insertions: number[] = [];
  let writtenTo = 0;
  for (const { opener, start, end } of candidates) {
    // Only repair embeds the parser left as text: skip valid images, and code or HTML anywhere inside.
    if (
      opener < writtenTo ||
      !textRanges.some(([from, to]) => opener >= from && opener < to) ||
      literalRanges.some(([from, to]) => from < end && to > start)
    ) {
      continue;
    }
    parts.push(source.slice(writtenTo, start), "<", source.slice(start, end), ">");
    insertions.push(start + insertions.length, end + insertions.length + 1);
    writtenTo = end;
  }
  if (insertions.length === 0) return undefined;
  parts.push(source.slice(writtenTo));
  return {
    markdown: parts.join(""),
    toOriginal: (offset: number) => offset - countInsertionsBefore(insertions, offset),
  };
}

function countInsertionsBefore(insertions: number[], offset: number): number {
  let low = 0;
  let high = insertions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (insertions[middle]! < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Reparse only when a bare local media path needs brackets, keeping authored source positions. */
export const remarkSpacedMediaPaths: Plugin<[], Root> = function () {
  const parse = this.parser;
  if (!parse) return;
  this.parser = (source, file) => {
    const tree = parse(source, file) as Root;
    const repaired = wrapSpacedMediaPaths(source, () => tree);
    if (!repaired) return tree;
    const { markdown, toOriginal } = repaired;
    const parsed = parse(markdown, file) as Root;
    const restorePositions = (node: Root | RootContent) => {
      if (node.position) {
        for (const point of [node.position.start, node.position.end]) {
          if (point.offset === undefined) continue;
          const lineStart = point.offset - point.column + 1;
          point.offset = toOriginal(point.offset);
          point.column = point.offset - toOriginal(lineStart) + 1;
        }
      }
      if ("children" in node) node.children.forEach(restorePositions);
    };
    restorePositions(parsed);
    return parsed;
  };
};
