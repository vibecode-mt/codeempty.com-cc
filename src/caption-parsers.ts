/**
 * Caption parsing utilities for CapCut JSON and SRT formats
 */

export interface ParsedCaption {
  text: string;
  timestampMs: number;
  type?: 'step' | 'element'; // type is optional before user marks in UI
}

/**
 * Parse CapCut native draft_content.json format
 * Follows the logic from ref/capsrt/index.html
 */
export function parseCapCutJson(jsonData: unknown, mode: 'subs' | 'all' = 'all'): ParsedCaption[] {
  const data = jsonData as any;
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid CapCut JSON: must be an object');
  }

  const texts = data.materials?.texts ?? [];
  const textById = new Map<string, any>(texts.filter((t: any) => t && t.id).map((t: any) => [t.id, t]));

  const entries: Array<{ timestampMs: number; text: string }> = [];
  const tracks = data.tracks ?? [];

  for (const tr of tracks) {
    if (tr?.type !== 'text') continue;
    for (const seg of tr.segments ?? []) {
      const mid = seg?.material_id;
      const mat = textById.get(mid);
      if (!mat) continue;

      // Mode filtering: 'subs' = only auto-captions (type === 'subtitle'), 'all' = everything
      if (mode === 'subs' && mat?.type !== 'subtitle') continue;

      const tt = seg?.target_timerange ?? {};
      const startUs = tt.start;
      const durUs = tt.duration;
      if (typeof startUs !== 'number' || typeof durUs !== 'number') continue;

      const txt = extractCapCutText(mat).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (!txt) continue;

      entries.push({
        timestampMs: Math.round(startUs / 1000),
        text: txt,
      });
    }
  }

  // Sort by timestamp
  entries.sort((a, b) => a.timestampMs - b.timestampMs);

  return entries.map((e) => ({
    text: e.text,
    timestampMs: e.timestampMs,
  }));
}

/**
 * Extract text from CapCut material (checks content and base_content fields)
 */
function extractCapCutText(material: any): string {
  for (const key of ['content', 'base_content']) {
    const v = material?.[key];
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(v);
        if (obj && typeof obj.text === 'string' && obj.text.trim()) {
          return obj.text;
        }
      } catch {
        // Continue to next key
      }
    }
  }
  return '';
}

/**
 * Parse SRT subtitle format
 * Format: index\nHH:MM:SS,mmm --> HH:MM:SS,mmm\ntext\n\n
 */
export function parseSRT(srtText: string): ParsedCaption[] {
  const entries: ParsedCaption[] = [];

  // Split by double newlines to get subtitle blocks
  const blocks = srtText.split(/\n\s*\n/).filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l);
    if (lines.length < 3) continue;

    // First line is index, second is timecode, rest is text
    const timecodeLineIndex = lines.findIndex((l) => l.includes('-->'));
    if (timecodeLineIndex === -1) continue;

    const timecodeStr = lines[timecodeLineIndex];
    const match = timecodeStr.match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);

    if (!match) continue;

    const startMs =
      parseInt(match[1], 10) * 3600000 +
      parseInt(match[2], 10) * 60000 +
      parseInt(match[3], 10) * 1000 +
      parseInt(match[4], 10);

    const textLines = lines.slice(timecodeLineIndex + 1).join(' ');
    if (!textLines.trim()) continue;

    entries.push({
      text: textLines.trim(),
      timestampMs: startMs,
    });
  }

  return entries;
}

/**
 * Parse VTT subtitle format (similar to SRT but with WEBVTT header)
 */
export function parseVTT(vttText: string): ParsedCaption[] {
  // Remove WEBVTT header if present
  const content = vttText.replace(/^WEBVTT\s*\n/i, '');
  // VTT uses the same format as SRT after the header
  return parseSRT(content);
}

/**
 * Auto-detect and parse caption format
 */
export function parseCaption(data: string, fileName?: string): ParsedCaption[] {
  // Try to detect format
  const trimmed = data.trim();

  // Check for CapCut JSON
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (json.materials && json.tracks) {
        return parseCapCutJson(json, 'all');
      }
    } catch {
      // Not valid JSON or not CapCut format
    }
  }

  // Check for VTT
  if (trimmed.toUpperCase().startsWith('WEBVTT')) {
    return parseVTT(trimmed);
  }

  // Check file extension hint
  if (fileName?.toLowerCase().endsWith('.vtt')) {
    return parseVTT(trimmed);
  }

  // Assume SRT format (most common subtitle format)
  try {
    const srtResult = parseSRT(trimmed);
    if (srtResult.length > 0) {
      return srtResult;
    }
  } catch {
    // Fall through
  }

  throw new Error('Unable to detect caption format. Supported formats: CapCut JSON, SRT, VTT');
}
