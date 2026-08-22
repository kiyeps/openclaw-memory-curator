// Markdown parser: turns memory/*.md files into quads.
// Quad shape: { subject, predicate, object } — NO graph field.
// Subjects use urn:openclaw:memory:<slug>:<idx> for entries and
// urn:openclaw:memory:<slug> for file provenance.

import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

export function slugify(filePath) {
  return basename(filePath).replace(/\.md$/i, '');
}

// Parse a single memory file into quads.
// - Detects entry lines (e.g. "[HH:MM WIB] [type] context | decision | next")
// - Falls back to paragraph splitting
// - Returns { quads, redactables } where redactables is list of literal strings
export function parseFile(filePath, content, mtimeMs, size) {
  const slug = slugify(filePath);
  const quads = [];
  const lines = content.split(/\r?\n/);

  // Frontmatter
  let shareTag = null;
  let bodyStart = 0;
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') { bodyStart = i + 1; break; }
      const m = /^share:\s*(.+)$/.exec(lines[i]);
      if (m) shareTag = m[1].trim();
    }
  }

  // Entry regex: [HH:MM ...] [type] ...
  const entryRe = /^\[(\d{1,2}:\d{2}(?:\s+[A-Z]+)?)\]\s*\[([^\]]+)\]\s*(.*)$/;

  let entryIdx = 0;
  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (!text) { buffer = []; return; }
    const subj = `urn:openclaw:memory:${slug}:${entryIdx++}`;
    quads.push({ subject: subj, predicate: 'urn:openclaw:pred:content', object: text });
    quads.push({ subject: subj, predicate: 'urn:openclaw:pred:entryType', object: 'entry' });
    buffer = [];
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (entryRe.test(line)) {
      flush();
      const m = entryRe.exec(line);
      const subj = `urn:openclaw:memory:${slug}:${entryIdx++}`;
      quads.push({ subject: subj, predicate: 'urn:openclaw:pred:content', object: m[3].trim() });
      quads.push({ subject: subj, predicate: 'urn:openclaw:pred:entryType', object: m[2].trim() });
      quads.push({ subject: subj, predicate: 'urn:openclaw:pred:ts', object: m[1].trim() });
    } else if (/^#{1,3}\s/.test(line) || line.trim() === '') {
      flush();
    } else {
      buffer.push(line);
    }
  }
  flush();

  // If no entries parsed, treat whole body as single entry
  if (entryIdx === 0) {
    const body = lines.slice(bodyStart).join('\n').trim();
    if (body) {
      const subj = `urn:openclaw:memory:${slug}:0`;
      quads.push({ subject: subj, predicate: 'urn:openclaw:pred:content', object: body });
      quads.push({ subject: subj, predicate: 'urn:openclaw:pred:entryType', object: 'note' });
    }
  }

  // File provenance
  const fileSubj = `urn:openclaw:memory:${slug}`;
  quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:sourceFile', object: filePath });
  quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:ingestedAt', object: new Date().toISOString() });
  quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:sourceMtime', object: String(mtimeMs) });
  quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:sourceSize', object: String(size) });
  quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:statusTag', object: 'wm' });
  quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:referenceCount', object: '0' });
  if (shareTag) {
    quads.push({ subject: fileSubj, predicate: 'urn:openclaw:pred:shareTag', object: shareTag });
  }

  return { quads, shareTag: !!shareTag, entryCount: entryIdx };
}

export function parseFileFromDisk(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const st = statSync(filePath);
  return parseFile(filePath, content, st.mtimeMs, st.size);
}
