import type { ContentElement } from '../types';
import { escHtml } from './layout';

function youtubeId(urlOrId: string): string {
  const m = urlOrId.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : urlOrId;
}

export function renderContentElement(el: ContentElement): string {
  switch (el.type) {
    case 'title':
      return `<div class="content-el content-el-title">${escHtml(el.content)}</div>`;
    case 'description':
      return `<div class="content-el content-el-desc">${el.content}</div>`;
    case 'prompt_code':
      return `<div class="content-el content-el-code">${escHtml(el.content)}</div>`;
    case 'image': {
      let imgUrl = el.content;
      let caption = '';
      try {
        const parsed = JSON.parse(el.content) as { url?: string; caption?: string };
        if (parsed.url !== undefined) { imgUrl = parsed.url; caption = parsed.caption ?? ''; }
      } catch { /* plain URL */ }
      return `<div class="content-el content-el-img"><img src="${escHtml(imgUrl)}" alt="" loading="lazy">${caption ? `<div class="content-el-img-caption">${caption}</div>` : ''}</div>`;
    }
    case 'youtube': {
      const id = youtubeId(el.content);
      return `<div class="content-el"><div class="youtube-wrapper">
        <iframe src="https://www.youtube-nocookie.com/embed/${escHtml(id)}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe>
      </div></div>`;
    }
    case 'url': {
      let href = el.content;
      let label = el.content;
      try {
        const parsed = JSON.parse(el.content) as { href: string; label: string };
        href = parsed.href;
        label = parsed.label ?? parsed.href;
      } catch {
        // raw URL
      }
      return `<div class="content-el content-el-url"><a href="${escHtml(href)}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a></div>`;
    }
    default:
      return '';
  }
}

export function renderContentElements(elements: ContentElement[]): string {
  return elements.map(renderContentElement).join('');
}
