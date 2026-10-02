import { marked } from "marked";
import { color } from "./colors.js";

interface MarkdownToken {
  type: string;
  text?: string;
  href?: string;
  depth?: number;
  lang?: string;
  ordered?: boolean;
  start?: number | string;
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: MarkdownToken[];
  rows?: MarkdownToken[][];
}

export function renderTerminalMarkdown(markdown: string): string {
  return renderBlocks(marked.lexer(markdown) as unknown as MarkdownToken[]).trimEnd();
}

function renderBlocks(tokens: MarkdownToken[], quotePrefix = ""): string {
  const lines: string[] = [];
  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "heading") {
      const content = renderInline(token.tokens ?? []);
      lines.push(color.bold(token.depth === 1 ? color.magenta(content) : color.cyan(content)));
    } else if (token.type === "paragraph" || token.type === "text") {
      lines.push(`${quotePrefix}${renderInline(token.tokens ?? [token])}`);
    } else if (token.type === "list") {
      for (const [index, item] of (token.items ?? []).entries()) {
        const marker = token.ordered ? `${Number(token.start ?? 1) + index}.` : "-";
        lines.push(`${quotePrefix}${marker} ${renderBlocks(item.tokens ?? [], "").trim()}`);
      }
    } else if (token.type === "code") {
      if (token.lang) lines.push(color.muted(`  ${token.lang}`));
      for (const codeLine of (token.text ?? "").split("\n")) lines.push(color.yellow(`  ${codeLine}`));
    } else if (token.type === "blockquote") {
      lines.push(...renderBlocks(token.tokens ?? [], `${color.muted("| ")}`).split("\n"));
    } else if (token.type === "hr") {
      lines.push(color.muted("-".repeat(48)));
    } else if (token.type === "table") {
      const rows = [token.header ?? [], ...(token.rows ?? [])];
      lines.push(...rows.map((row) => row.map((cell) => renderInline(cell.tokens ?? [cell])).join(color.muted(" | "))));
    } else if (token.text) {
      lines.push(`${quotePrefix}${renderInline(token.tokens ?? [token])}`);
    }
  }
  return lines.join("\n");
}

function renderInline(tokens: MarkdownToken[]): string {
  return tokens.map((token) => {
    const content = token.tokens ? renderInline(token.tokens) : token.text ?? "";
    if (token.type === "strong") return color.bold(content);
    if (token.type === "codespan") return color.cyan(content);
    if (token.type === "link") return `${color.blue(content)} ${color.muted(`(${token.href ?? ""})`)}`;
    if (token.type === "del") return color.muted(content);
    if (token.type === "br") return "\n";
    return content;
  }).join("");
}
