// DKG HTTP client — minimal, zero deps.
// Token = line 2 of ~/.dkg/auth.token (strip comment lines starting with #).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function loadToken(tokenPath) {
  const p = tokenPath || join(homedir(), '.dkg', 'auth.token');
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  const nonComment = lines.filter(l => !/^\s*#/.test(l) && l.trim().length > 0);
  if (nonComment.length < 1) throw new Error('no token found in ' + p);
  return nonComment[0].trim();
}

// The DKG node's internal SPARQL serializer treats bare strings as IRIs.
// To force literal treatment, wrap the object in double quotes: "value".
// Inside, escape backslashes, embedded quotes, newlines, tabs, and
// strip control chars / emoji that break the SPARQL parser.
export function escapeLiteral(str) {
  if (typeof str !== 'string') return str;
  let s = str
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    // strip control chars
    .replace(/[\x00-\x1F\x7F]/g, '')
    // strip emoji / non-BMP
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '');
  return '"' + s + '"';
}

export class DkgClient {
  constructor({ baseUrl = 'http://127.0.0.1:9200', token, contextGraphId = 'openclaw-curator' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token || loadToken();
    this.cg = contextGraphId;
  }

  async _req(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        'Authorization': 'Bearer ' + this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) {
      const err = new Error(`DKG ${method} ${path} -> ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
      err.status = res.status; err.body = json;
      throw err;
    }
    return json;
  }

  _esc(quads) {
    return quads.map(q => ({
      subject: q.subject,
      predicate: q.predicate,
      object: escapeLiteral(q.object),
    }));
  }

  async ensureContextGraph() {
    try {
      await this._req('POST', '/api/context-graphs', { name: this.cg });
    } catch (e) {
      if (!e.message.includes('already exists')) throw e;
    }
  }

  async createKA(kaName, quads) {
    return this._req('POST', '/api/knowledge-assets', {
      name: kaName,
      contextGraphId: this.cg,
      quads: this._esc(quads),
    });
  }

  async wmWrite(kaName, quads) {
    return this._req('POST', `/api/knowledge-assets/${encodeURIComponent(kaName)}/wm/write`, {
      contextGraphId: this.cg,
      quads: this._esc(quads),
    });
  }

  async wmFinalize(kaName) {
    return this._req('POST', `/api/knowledge-assets/${encodeURIComponent(kaName)}/wm/finalize`, {
      contextGraphId: this.cg,
    });
  }

  async swmShare(kaName, { entities = 'all' } = {}) {
    return this._req('POST', `/api/knowledge-assets/${encodeURIComponent(kaName)}/swm/share`, {
      contextGraphId: this.cg,
      entities,
    });
  }

  async vmPublish(kaName) {
    return this._req('POST', `/api/knowledge-assets/${encodeURIComponent(kaName)}/vm/publish`, {
      contextGraphId: this.cg,
    });
  }

  async sparql(query, { agentAddress, view } = {}) {
    const body = {
      sparql: query,
      contextGraphId: this.cg,
    };
    if (agentAddress) body.agentAddress = agentAddress;
    if (view) body.view = view;
    return this._req('POST', '/api/query', body);
  }

  async info() {
    return this._req('GET', '/api/info').catch(e => ({ error: e.message }));
  }
}
