export interface BibEntry {
  key: string;
  type: string;
  title: string;
  author: string;
  year: string;
  journal: string;
  booktitle: string;
  abstract: string;
  doi: string;
  raw: string;
  sourcePath?: string;
}

function extractField(body: string, field: string): string {
  const re = new RegExp(`${field}\\s*=\\s*[{"]`, 'i');
  const m = re.exec(body);
  if (!m) return '';
  const start = m.index + m[0].length;
  const opener = body[start - 1];
  if (opener === '{') {
    let depth = 1;
    let i = start;
    while (i < body.length && depth > 0) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') depth--;
      i++;
    }
    return body.slice(start, i - 1).trim();
  }
  const end = body.indexOf('"', start);
  return end >= 0 ? body.slice(start, end).trim() : '';
}

export function parseBibFile(content: string, sourcePath?: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const entryRe = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    if (type === 'string' || type === 'comment' || type === 'preamble') continue;
    const key = match[2];
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    const body = content.slice(bodyStart, i - 1);
    const raw = content.slice(match.index, i);
    entries.push({
      key,
      type,
      title: extractField(body, 'title'),
      author: extractField(body, 'author'),
      year: extractField(body, 'year'),
      journal: extractField(body, 'journal'),
      booktitle: extractField(body, 'booktitle'),
      abstract: extractField(body, 'abstract'),
      doi: extractField(body, 'doi'),
      raw,
      sourcePath,
    });
  }
  return entries;
}

export function parseBibEntries(files: Record<string, string>): BibEntry[] {
  const entries: BibEntry[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.bib')) {
      entries.push(...parseBibFile(content, path));
    }
  }
  return entries;
}
