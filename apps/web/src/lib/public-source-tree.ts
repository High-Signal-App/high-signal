import type { ReactNode } from 'react';

/** Project the authored React content tree directly; never serialize or scrape HTML. */
export interface SourceTreeOptions {
  canonical: string;
  adapters?: Map<unknown, (props: Record<string, unknown>) => string | Promise<string>>;
}

type Element = { type: unknown; props: Record<string, unknown> };
const block = new Set([
  'article',
  'section',
  'main',
  'header',
  'footer',
  'div',
  'figure',
  'figcaption',
  'address',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
]);
const ignored = new Set([
  'script',
  'style',
  'svg',
  'canvas',
  'iframe',
  'noscript',
  'input',
  'textarea',
]);

function formatBlock(
  type: string,
  body: string,
  preserve: (text: string) => string
): string | undefined {
  if (/^h[1-6]$/.test(type)) return `\n\n${'#'.repeat(Number(type[1]))} ${body.trim()}\n\n`;
  if (type === 'p' || block.has(type)) return `\n\n${body.trim()}\n\n`;
  if (type === 'br') return '\n';
  if (type === 'hr') return '\n\n---\n\n';
  if (type === 'strong' || type === 'b') return `**${body}**`;
  if (type === 'em' || type === 'i') return `*${body}*`;
  if (type === 'code') return '`' + body + '`';
  if (type === 'pre') return preserve('\n\n```\n' + body.replace(/^`|`$/g, '') + '\n```\n\n');
  if (type === 'blockquote')
    return (
      '\n\n' +
      body
        .trim()
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n') +
      '\n\n'
    );
}

function formatInline(
  type: string,
  props: Record<string, unknown>,
  body: string,
  href: (value: unknown) => string
): string | undefined {
  if (type === 'a') {
    const target = href(props['href']);
    return target ? `[${body.trim() || target}](${target})` : body;
  }
  if (type === 'img')
    return props['alt'] && props['src'] ? `![${String(props['alt'])}](${href(props['src'])})` : '';
  if (
    type === 'span' ||
    type === 'small' ||
    type === 'time' ||
    type === 'label' ||
    type === 'button'
  )
    return body + ' ';
}

function formatTable(type: string, body: string): string | undefined {
  if (type === 'li') return `\n- ${body.trim().replaceAll('\n', '\n  ')}\n`;
  if (type === 'ul' || type === 'ol') return `\n\n${body.trim()}\n\n`;
  if (type === 'td' || type === 'th')
    return ` ${body.trim().replaceAll('|', '\\|').replaceAll('\n', ' ')} |`;
  if (type === 'tr') return `|${body}\n`;
  if (type === 'thead') {
    const lines = body.trim().split('\n');
    const columns = (lines[0]?.match(/\|/g)?.length ?? 1) - 1;
    return body + '|' + ' --- |'.repeat(columns) + '\n';
  }
  if (type === 'table') return `\n\n${body.trim()}\n\n`;
}

function hiddenElement(type: string, props: Record<string, unknown>) {
  return (
    ignored.has(type) ||
    props['hidden'] ||
    props['aria-hidden'] === true ||
    props['aria-hidden'] === 'true' ||
    (type === 'nav' && props['aria-label'] === 'Breadcrumb')
  );
}

function selectedOption(props: Record<string, unknown>) {
  const options = Array.isArray(props['children']) ? props['children'] : [props['children']];
  const active = props['value'] ?? props['defaultValue'];
  return options.find(
    (option) =>
      option &&
      typeof option === 'object' &&
      'props' in option &&
      (option as Element).props['value'] === active
  );
}

export async function publicSourceTree(
  node: ReactNode | unknown,
  options: SourceTreeOptions
): Promise<string> {
  const protectedContent: string[] = [];
  const preserve = (text: string) => {
    const key = `\u001eSOURCE_${protectedContent.length}\u001e`;
    protectedContent.push(text);
    return key;
  };
  const href = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Source link requires a string href');
    const url = new URL(value, options.canonical);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return '';
    return url.href.replaceAll(' ', '%20');
  };
  async function visit(input: unknown, depth = 0): Promise<string> {
    if (depth > 100) throw new Error('Public source component nesting limit');
    const value = await input;
    if (value == null || typeof value === 'boolean') return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value))
      return (await Promise.all(value.map((child) => visit(child, depth + 1)))).join('');
    if (typeof value !== 'object' || !('type' in value) || !('props' in value))
      throw new Error('Unsupported public source node');
    const { type, props } = value as Element;
    const adapter = options.adapters?.get(type);
    if (adapter) return preserve(await adapter(props));
    if (typeof type === 'function') return visit(await type(props), depth + 1);
    if (type === Symbol.for('react.fragment') || type === Symbol.for('react.suspense'))
      return visit(props['children'], depth + 1);
    if (typeof type !== 'string')
      throw new Error('Public component requires an explicit source adapter');
    if (hiddenElement(type, props)) return '';
    if (props['dangerouslySetInnerHTML'])
      throw new Error('Public source must use authored Markdown, not serialized HTML');
    if (type === 'select') {
      const selected = selectedOption(props);
      return selected ? visit(selected, depth + 1) : '';
    }
    const body = await visit(props['children'], depth + 1);
    const formatted =
      formatBlock(type, body, preserve) ??
      formatInline(type, props, body, href) ??
      formatTable(type, body);
    if (formatted !== undefined) return formatted;
    return body;
  }
  let rendered =
    (await visit(node))
      .replace(/\n[ \t]+\n/g, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n';
  for (let i = protectedContent.length - 1; i >= 0; i--)
    rendered = rendered.replaceAll(`\u001eSOURCE_${i}\u001e`, protectedContent[i]!);
  return rendered;
}
