import { absoluteMarkdownLinks } from './agent-surfaces/format.mjs';
import { publicSourceTree } from './src/lib/public-source-tree.ts';
import { SITE_URL } from './src/lib/site.ts';
import {
  recordDateTime,
  recordMetadata,
  retainedTextExplanation,
} from './src/lib/retained-record.ts';

const SourceLink = Symbol('public-record-link');
const element = (type, children, props = {}) => ({ type, props: { ...props, children } });
const link = (href, children) => element(SourceLink, children, { href });

export function publicRecordId(path) {
  const match = path.match(/^\/data\/records\/([^/]+)$/);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id && !/[\\/?#]/.test(id) && id !== '.' && id !== '..' ? id : null;
  } catch {
    return null;
  }
}

export function validateRecord(record, id) {
  if (!record || record.available !== true || record.id !== id)
    throw new Error('Public record unavailable');
  for (const key of ['source', 'family', 'url'])
    if (typeof record[key] !== 'string') throw new Error(`Invalid public record ${key}`);
  for (const key of ['canonicalUrl', 'title', 'content', 'retainedText', 'entity', 'entityName'])
    if (record[key] !== null && typeof record[key] !== 'string')
      throw new Error(`Invalid public record ${key}`);
  for (const key of ['publishedAt', 'ingestedAt', 'documentFetchedAt'])
    if (record[key] !== null && (typeof record[key] !== 'number' || !Number.isFinite(record[key])))
      throw new Error(`Invalid public record ${key}`);
  if (typeof record.retainedTextTruncated !== 'boolean')
    throw new Error('Invalid public record truncation');
}

/** Framework-free projection checked against the authored page by the parity test. */
export async function publicRecordDocument(path, record) {
  const id = publicRecordId(path);
  if (!id) throw new Error('Invalid public record path');
  validateRecord(record, id);
  const publicPath = `/data/records/${encodeURIComponent(id)}`;
  const canonical = new URL(publicPath, SITE_URL).href;
  const { title, description } = recordMetadata(record, id);
  const header = element('header', [
    element('h1', record.title ?? record.url),
    element('div', [
      element('span', [
        'source:',
        ' ',
        link(`/data/${encodeURIComponent(record.family)}`, record.family),
        record.source !== record.family && element('span', [' (', record.source, ')']),
      ]),
      element('span', ['published ', recordDateTime(record.publishedAt)]),
      element('span', ['ingested ', recordDateTime(record.ingestedAt)]),
    ]),
    element('div', [
      record.entity &&
        link(`/entities/${encodeURIComponent(record.entity)}`, record.entityName ?? record.entity),
      element('a', 'original source ↗', { href: record.url }),
    ]),
  ]);
  const text = [
    record.content &&
      record.content !== record.retainedText &&
      element('section', [element('h2', 'extract'), element('p', record.content)]),
    element('section', [
      element('h2', ['retained text', record.retainedTextTruncated ? ' (truncated)' : '']),
      record.retainedText
        ? element('pre', record.retainedText)
        : element('p', retainedTextExplanation(record.retainedTextUnavailableReason)),
      record.documentFetchedAt
        ? element('p', [
            'document fetched ',
            recordDateTime(record.documentFetchedAt),
            record.canonicalUrl && record.canonicalUrl !== record.url
              ? ` · canonical ${record.canonicalUrl}`
              : '',
          ])
        : null,
    ]),
  ];
  const body = await publicSourceTree(element('main', [link('/data', '← sources'), header, text]), {
    canonical,
    adapters: new Map([
      [
        SourceLink,
        async (props) =>
          `[${(await publicSourceTree(props.children, { canonical })).trim()}](${new URL(props.href, canonical).href})`,
      ],
    ]),
  });
  return {
    path: publicPath,
    url: canonical,
    title,
    description,
    markdown: absoluteMarkdownLinks(
      `# ${title}\n\n> ${description}\n\nCanonical: ${canonical}\n\n${body.replace(/^# [^\n]*\n/m, '').trim()}\n`,
      canonical
    ),
  };
}
