// Precalc auto-pull for the Notes app. Runs in your PERSONAL Google account as a web app.
// It finds Precalc slides and PDFs under "Shared with me" in Drive and hands them to the app.
// The secret key is NOT in this code: set it in Project Settings > Script Properties as KEY.

// Teacher emails whose files always count as Precalc, even without "precalc" in the name.
// Example: const OWNERS = ['teacher@school.org'];
const OWNERS = [];

const NAME_MATCH = /pre[\s-]?calc/i;          // "precalc", "pre-calc", "pre calc", any case
const MAX_FILES = 10;                         // PDFs per call
const MAX_BYTES = 20 * 1024 * 1024;           // stop adding PDFs after about 20 MB (the iPad has to read it)
const FIRST_DAYS = 14;                        // first run: look back this many days

function doGet(e) {
  const p = (e && e.parameter) || {};
  const secret = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!secret || !p.key || p.key !== secret) return json_({ error: 'bad key' });

  const since = Number(p.since) > 0 ? Number(p.since) : Date.now() - FIRST_DAYS * 86400000;
  const skip = {};
  String(p.skip || '').split(',').forEach(function (id) { if (id) skip[id] = true; });
  const owners = OWNERS.map(function (o) { return String(o).toLowerCase().trim(); });

  const types = [MimeType.GOOGLE_SLIDES, MimeType.GOOGLE_DOCS, MimeType.PDF];
  const q = 'sharedWithMe and trashed = false and modifiedDate > \'' + new Date(since).toISOString() + '\' and (' +
    types.map(function (t) { return 'mimeType = \'' + t + '\''; }).join(' or ') + ')';

  const found = [], others = [];
  const it = DriveApp.searchFiles(q);
  while (it.hasNext()) {
    const f = it.next();
    let owner = '';
    try { const o = f.getOwner(); owner = o ? o.getEmail() : ''; } catch (err) { owner = ''; }
    const item = { id: f.getId(), name: f.getName(), owner: owner, modified: f.getLastUpdated().getTime(), type: f.getMimeType(), file: f };
    if (NAME_MATCH.test(item.name) || owners.indexOf(owner.toLowerCase()) >= 0) found.push(item);
    else others.push(item);
  }
  found.sort(function (a, b) { return b.modified - a.modified; }); // newest first
  const plain = function (x) { return { id: x.id, name: x.name, owner: x.owner, modified: x.modified, type: x.type }; };

  // ?list=1: what it sees, without the PDFs (to check the setup)
  if (p.list) {
    others.sort(function (a, b) { return b.modified - a.modified; });
    return json_({ files: found.map(plain), since: since, others: others.slice(0, 15).map(plain), othersCount: others.length });
  }

  const files = [];
  let bytes = 0, more = false;
  for (let i = 0; i < found.length; i++) {
    const x = found[i];
    if (skip[x.id]) continue;
    if (files.length >= MAX_FILES || bytes >= MAX_BYTES) { more = true; break; }
    const out = plain(x);
    try {
      const blob = x.type === MimeType.PDF ? x.file.getBlob() : x.file.getAs('application/pdf');
      const data = blob.getBytes();
      bytes += data.length;
      out.pdf_base64 = Utilities.base64Encode(data);
    } catch (err) {
      out.error = String(err && err.message || err);
    }
    files.push(out);
  }
  return json_({ files: files, more: more });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
