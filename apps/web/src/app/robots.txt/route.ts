import policy from '@/lib/robots-policy';
export const dynamic = 'force-static';
export function GET() {
  const value = policy();
  const groups = Array.isArray(value.rules) ? value.rules : [value.rules];
  const lines = [
    '# Keep in sync with /llms.txt and /ai.txt.',
    '# Protected history remains access-checked per entity and is excluded from Markdown.',
    '',
  ];
  for (const group of groups) {
    const agents = Array.isArray(group.userAgent) ? group.userAgent : [group.userAgent ?? '*'];
    for (const agent of agents) {
      lines.push(`User-agent: ${agent}`);
      for (const path of typeof group.allow === 'string' ? [group.allow] : (group.allow ?? []))
        lines.push(`Allow: ${path}`);
      for (const path of typeof group.disallow === 'string'
        ? [group.disallow]
        : (group.disallow ?? []))
        lines.push(`Disallow: ${path}`);
      lines.push('');
    }
  }
  lines.push(`Sitemap: ${value.sitemap}`, `Host: ${value.host}`, '');
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
