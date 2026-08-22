// Maturity tracker. JSON state file in .state/.
// Tracks per-KA: status (wm|swm|vm), referenceCount, shareTag, lastIngested.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export class MaturityTracker {
  constructor(statePath) {
    this.path = statePath;
    mkdirSync(dirname(this.path), { recursive: true });
    this.state = this._load();
  }
  _load() {
    if (!existsSync(this.path)) return { kas: {}, lastTick: null };
    try { return JSON.parse(readFileSync(this.path, 'utf8')); }
    catch { return { kas: {}, lastTick: null }; }
  }
  save() { writeFileSync(this.path, JSON.stringify(this.state, null, 2)); }

  upsert(kaName, { entryCount, shareTag, mtimeMs, size, sourceFile }) {
    const cur = this.state.kas[kaName] || {
      name: kaName, status: 'wm', referenceCount: 0,
      shareTag: false, entryCount: 0, lastIngested: null,
    };
    cur.entryCount = entryCount;
    cur.shareTag = shareTag || cur.shareTag;
    cur.mtimeMs = mtimeMs;
    cur.size = size;
    cur.sourceFile = sourceFile;
    cur.lastIngested = new Date().toISOString();
    this.state.kas[kaName] = cur;
  }

  get(kaName) { return this.state.kas[kaName]; }
  list() { return Object.values(this.state.kas); }

  setStatus(kaName, status) {
    if (!this.state.kas[kaName]) throw new Error('unknown KA: ' + kaName);
    this.state.kas[kaName].status = status;
  }

  // Count how many LATER memory files reference this KA's filename or top decision.
  // `allFilenames` = array of slugs sorted by mtime ascending.
  // `fileContents` = map slug -> text
  updateReferenceCounts(allFilenames, fileContents) {
    for (let i = 0; i < allFilenames.length; i++) {
      const target = allFilenames[i];
      let refs = 0;
      for (let j = i + 1; j < allFilenames.length; j++) {
        const later = fileContents[allFilenames[j]] || '';
        if (later.includes(target.replace(/-/g, ' ')) || later.includes(target)) refs++;
      }
      if (this.state.kas[target]) {
        this.state.kas[target].referenceCount = refs;
      }
    }
  }

  // SWM-eligible: shareTag OR referenceCount >= N OR forced
  swmEligible(kaName, { threshold = 3 } = {}) {
    const k = this.state.kas[kaName];
    if (!k) return false;
    if (k.status !== 'wm') return false;
    return k.shareTag || k.referenceCount >= threshold;
  }
}
