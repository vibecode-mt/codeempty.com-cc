import type { ContentElement, Env } from '../types';
import { escHtml } from './layout';
import { renderMarkdown } from './markdown';
import { renderWidgets } from './widgets';

function youtubeId(urlOrId: string): string {
  const m = urlOrId.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : urlOrId;
}

// Render the inner body of a description element honoring render_style.
// 'markdown' parses the (already plain-text) content as markdown.
// 'ai_response' / 'thoughts' parse as markdown too — they only differ in CSS.
// The default style assumes content is already HTML (legacy HtmlEditor output).
function renderDescriptionBody(content: string, style: string | null): { html: string; cls: string } {
  switch (style) {
    case 'markdown':
      return { html: renderMarkdown(content), cls: 'content-el-desc render-markdown' };
    case 'ai_response':
      return { html: renderMarkdown(content), cls: 'content-el-desc render-ai-response' };
    case 'thoughts':
      return { html: renderMarkdown(content), cls: 'content-el-desc render-thoughts' };
    default:
      return { html: content, cls: 'content-el-desc' };
  }
}

export function renderContentElement(el: ContentElement, widgets?: Map<string, string>): string {
  switch (el.type) {
    case 'title':
      return `<div class="content-el content-el-title">${escHtml(el.content)}</div>`;
    case 'description': {
      const { html, cls } = renderDescriptionBody(el.content, el.render_style);
      return `<div class="content-el ${cls}">${html}</div>`;
    }
    case 'prompt_code':
      return `<div class="content-el content-el-code">${escHtml(el.content)}</div>`;
    case 'image': {
      let imgUrl = el.content;
      let caption = '';
      try {
        const parsed = JSON.parse(el.content) as { url?: string; caption?: string };
        if (parsed.url !== undefined) { imgUrl = parsed.url; caption = parsed.caption ?? ''; }
      } catch { /* plain URL */ }
      return `<div class="content-el content-el-img"><img src="${escHtml(imgUrl)}" alt="" loading="lazy" decoding="async">${caption ? `<div class="content-el-img-caption">${caption}</div>` : ''}</div>`;
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
    case 'user_comment': {
      let text = '';
      let username = '';
      let profileUrl = '';
      let commentUrl = '';
      try {
        const parsed = JSON.parse(el.content) as {
          text?: string;
          username?: string;
          profile_url?: string;
          comment_url?: string;
        };
        text = parsed.text ?? '';
        username = parsed.username ?? '';
        profileUrl = parsed.profile_url ?? '';
        commentUrl = parsed.comment_url ?? '';
      } catch {
        text = el.content;
      }
      const userHtml = username
        ? profileUrl
          ? `<a class="content-el-comment-user" href="${escHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(username)}</a>`
          : `<span class="content-el-comment-user">${escHtml(username)}</span>`
        : '';
      const linkHtml = commentUrl
        ? ` <a class="content-el-comment-link" href="${escHtml(commentUrl)}" target="_blank" rel="noopener noreferrer">↗ view</a>`
        : '';
      return `<div class="content-el content-el-comment">
        <div class="content-el-comment-header">${userHtml}${linkHtml}</div>
        <div class="content-el-comment-body">${renderMarkdown(text)}</div>
      </div>`;
    }
    case 'widget':
      // Widgets need DB access; rendered in a pre-pass and looked up here.
      return widgets?.get(el.id) ?? '';
    default:
      return '';
  }
}

export function renderContentElements(elements: ContentElement[], widgets?: Map<string, string>): string {
  return elements.map((el) => renderContentElement(el, widgets)).join('');
}

// Async helper used by page/blog/project renderers: pre-renders any widget
// elements (which need D1) and returns the final HTML for the whole list.
export async function renderContentElementsWithWidgets(
  elements: ContentElement[],
  env: Env,
): Promise<string> {
  const widgets = await renderWidgets(elements, env);
  return renderContentElements(elements, widgets);
}
