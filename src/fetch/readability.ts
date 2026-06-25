import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { config } from '../utils/config.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});

turndown.use(gfm);

export interface ReadabilityResult {
  title: string;
  content: string;
  excerpt: string;
  textContent: string;
  contentLength: number;
}

export function extractContent(html: string, _sourceUrl?: string): ReadabilityResult | null {
  try {
    const { document } = parseHTML(html);

    const reader = new Readability(document, {
      charThreshold: 100,
      keepClasses: false,
    });

    const article = reader.parse();

    if (!article) {
      return null;
    }

    const markdown = postProcess(
      turndown.turndown(article.content),
    );

    return {
      title: article.title ?? '',
      content: markdown,
      excerpt: article.excerpt ?? '',
      textContent: article.textContent ?? '',
      contentLength: markdown.length,
    };
  } catch {
    return null;
  }
}

export function truncateContent(content: string, maxLength: number = config.CONTENT_MAX_LENGTH): string {
  if (content.length <= maxLength) return content;

  const truncated = content.slice(0, maxLength);
  const lastParagraph = truncated.lastIndexOf('\n\n');

  if (lastParagraph > maxLength * 0.5) {
    return truncated.slice(0, lastParagraph) + '\n\n[... truncated]';
  }

  return truncated + '\n\n[... truncated]';
}

function postProcess(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^#{1,6}\s*$/gm, '')
    .replace(/\{[^}]*style[^}]*\}/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
