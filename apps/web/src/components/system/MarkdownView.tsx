import type { ReactNode } from 'react';

type Block =
  | { type: 'heading'; level: 2 | 3 | 4; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'code'; code: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' };

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function safeHref(href: string) {
  const trimmed = href.trim();
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:')
  ) {
    return trimmed;
  }
  return '#';
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({ type: 'code', code: code.join('\n') });
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(Math.max(heading[1].length + 1, 2), 4) as 2 | 3 | 4,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quote });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = (lines[index] ?? '').trim();
        const match = ordered ? itemLine.match(/^\d+\.\s+(.+)$/) : itemLine.match(/^[-*]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (trimmed.includes('|') && isTableSeparator(lines[index + 1] ?? '')) {
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').trim().includes('|')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        nextTrimmed.startsWith('```') ||
        nextTrimmed.startsWith('>') ||
        /^#{1,4}\s+/.test(nextTrimmed) ||
        /^[-*]\s+/.test(nextTrimmed) ||
        /^\d+\.\s+/.test(nextTrimmed) ||
        /^---+$/.test(nextTrimmed)
      ) {
        break;
      }
      paragraph.push(nextTrimmed);
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
  }

  return blocks;
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard RegExp.exec iteration loop
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      const external = href.startsWith('http://') || href.startsWith('https://');
      nodes.push(
        <a
          className="text-[var(--color-accent)] underline-offset-4 hover:underline"
          href={href}
          key={key}
          rel={external ? 'noreferrer' : undefined}
          target={external ? '_blank' : undefined}
        >
          {link[1]}
        </a>
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          className="border border-zinc-800 bg-zinc-950 px-1 py-0.5 font-mono text-[0.9em] text-zinc-200"
          key={key}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong className="font-medium text-zinc-100" key={key}>
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <em className="text-zinc-300" key={key}>
          {token.slice(1, -1)}
        </em>
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="space-y-5 text-sm leading-7 text-zinc-400">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level}` as 'h2' | 'h3' | 'h4';
          return (
            <Tag
              className="pt-2 text-lg font-medium leading-snug tracking-tight text-zinc-100"
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
              key={index}
            >
              {inline(block.text)}
            </Tag>
          );
        }
        if (block.type === 'paragraph') {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
            <p className="max-w-3xl" key={index}>
              {inline(block.lines.join(' '))}
            </p>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              className="border-l border-[var(--color-accent)] pl-4 text-zinc-300"
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
              key={index}
            >
              {block.lines.map((line, lineIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
                <p className="mt-2 first:mt-0" key={lineIndex}>
                  {inline(line)}
                </p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag
              className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-2 pl-5`}
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
              key={index}
            >
              {block.items.map((item, itemIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'code') {
          return (
            <pre
              className="overflow-x-auto border border-zinc-800 bg-black p-4 font-mono text-xs leading-6 text-zinc-300"
              // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
              key={index}
            >
              <code>{block.code}</code>
            </pre>
          );
        }
        if (block.type === 'table') {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
            <div className="overflow-x-auto border border-zinc-800" key={index}>
              <table className="w-full min-w-[36rem] text-left text-xs">
                <thead className="font-mono uppercase tracking-[0.16em] text-zinc-500">
                  <tr>
                    {block.headers.map((header) => (
                      <th className="border-b border-zinc-800 px-3 py-2" key={header}>
                        {inline(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td
                          className="border-b border-zinc-900 px-3 py-2 align-top"
                          // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
                          key={cellIndex}
                        >
                          {inline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: parsed markdown blocks are positionally stable and never reordered (the list is fully rebuilt when the markdown prop changes)
        return <hr className="border-zinc-800" key={index} />;
      })}
    </div>
  );
}
