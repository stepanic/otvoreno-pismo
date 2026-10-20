import { Marked } from "marked";
import { esc } from "./html";

// Markdown bez sirovog HTML-a; linkovi samo http(s) i mailto.
const md = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return esc(text);
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:)/i.test(href)) return inner;
      const t = title ? ` title="${esc(title)}"` : "";
      return `<a href="${esc(href)}"${t} rel="nofollow noopener">${inner}</a>`;
    },
    image({ text }) {
      return esc(text);
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src, { async: false }) as string;
}
