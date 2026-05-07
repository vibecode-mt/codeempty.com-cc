import { escHtml } from './layout';

// Tiny markdown → HTML for AI-response/thoughts content.
// Supports: fenced code blocks (```), headings (# ##), unordered lists (-/*),
// ordered lists (1.), inline code (`x`), bold (**x**), italic (*x*),
// links ([t](u)), paragraphs, hard line breaks.
//
// Deliberately limited — extend only when a concrete element needs it.
export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');

  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeLists();
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const cls = lang ? ` class="lang-${escHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      closeLists();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list item
    const ul = line.match(/^[\s]*[-*]\s+(.*)$/);
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      i++;
      continue;
    }

    // Ordered list item
    const ol = line.match(/^[\s]*\d+\.\s+(.*)$/);
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      i++;
      continue;
    }

    // Blank line — end paragraph / list
    if (line.trim() === '') {
      closeLists();
      i++;
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-special lines
    closeLists();
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[\s]*[-*]\s+/.test(lines[i]) &&
      !/^[\s]*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(buf.join('\n'))}</p>`);
  }

  closeLists();
  return out.join('\n');
}

function renderInline(text: string): string {
  // Tokenize inline code so later rules don't transform its contents.
  // Sentinel uses U+E000 (private-use); won't collide with escaped output.
  const codeTokens: string[] = [];
  const SENT = '';
  let s = escHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${code}</code>`);
    return `${SENT}${idx}${SENT}`;
  });

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
    `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`,
  );

  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/(^|[\s])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Hard line breaks for explicit \n inside paragraphs
  s = s.replace(/\n/g, '<br>');

  // Restore inline code tokens
  s = s.replace(new RegExp(`${SENT}(\\d+)${SENT}`, 'g'), (_, idx) => codeTokens[Number(idx)]);

  return s;
}
