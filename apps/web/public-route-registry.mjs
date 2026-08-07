export const PUBLIC_STATIC_ROUTES = [
  {
    path: '/',
    title: 'Daily Brief',
    description: 'The current five-section High Signal brief.',
    changeFrequency: 'hourly',
    priority: 1,
  },
  {
    path: '/brief',
    title: 'Daily Brief',
    description: 'The current synthesized brief with cited evidence.',
    changeFrequency: 'hourly',
    priority: 0.95,
  },
  {
    path: '/brief/archive',
    title: 'Brief archive',
    description: 'Permanent dated Daily Brief snapshots.',
    changeFrequency: 'daily',
    priority: 0.85,
  },
  {
    path: '/daily-intelligence-brief',
    title: 'Daily intelligence brief',
    description:
      'How High Signal builds one evidence-first brief across technology, startups, and finance.',
    changeFrequency: 'monthly',
    priority: 0.85,
  },
  {
    path: '/compared',
    title: 'Daily briefs compared',
    description:
      'Compare daily technology, startup, and finance briefs by sourcing contract and auditability.',
    changeFrequency: 'monthly',
    priority: 0.85,
  },
  {
    path: '/startup-intelligence-platform',
    title: 'Startup intelligence platform',
    description:
      'The qualified company universe, product facets, provenance, and links to current signals.',
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/market-intelligence-for-founders',
    title: 'Market intelligence for founders',
    description:
      'A source-backed workflow from the Daily Brief to companies, opportunities, and outcomes.',
    changeFrequency: 'monthly',
    priority: 0.8,
  },
  {
    path: '/technology-trend-intelligence',
    title: 'Technology trend intelligence',
    description:
      'A research path through cited signals, convergence, entities, sectors, and history.',
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/track-record',
    title: 'Track record',
    description: 'The public hit-rate ledger for matured calls.',
    changeFrequency: 'daily',
    priority: 0.9,
  },
  {
    path: '/signals',
    title: 'Signals',
    description: 'Published evidence-backed signals.',
    changeFrequency: 'hourly',
    priority: 0.9,
  },
  {
    path: '/digest',
    title: 'Digest',
    description: 'The current public weekly digest.',
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/markets',
    title: 'Markets',
    description: 'Market intelligence and cited probability context.',
    changeFrequency: 'daily',
    priority: 0.8,
  },
  {
    path: '/communities',
    title: 'Communities',
    description: 'Community evidence feeding the Daily Brief.',
    changeFrequency: 'daily',
    priority: 0.75,
  },
  {
    path: '/agent-eval',
    title: 'Agent Eval',
    description: 'Evidence-based agent-readiness evaluations.',
    changeFrequency: 'weekly',
    priority: 0.7,
  },
  {
    path: '/lab',
    title: 'Lab',
    description: 'Experimental intelligence helper surface.',
    changeFrequency: 'daily',
    priority: 0.65,
  },
  {
    path: '/entities',
    title: 'Entities',
    description: 'Companies, products, sectors, and their published signals.',
    changeFrequency: 'weekly',
    priority: 0.65,
  },
  {
    path: '/sectors',
    title: 'Sectors',
    description: 'Sector-level signal aggregation and hit rates.',
    changeFrequency: 'weekly',
    priority: 0.6,
  },
  {
    path: '/opportunities',
    title: 'Opportunities',
    description: 'Evidence-backed product and market opportunities.',
    changeFrequency: 'weekly',
    priority: 0.6,
  },
  {
    path: '/ideas',
    title: 'Ideas',
    description: 'Business ideas derived from public changes and complaints.',
    changeFrequency: 'weekly',
    priority: 0.55,
  },
  {
    path: '/methodology',
    title: 'Methodology',
    description: 'How High Signal sources, scores, publishes, and corrects evidence.',
    changeFrequency: 'monthly',
    priority: 0.85,
  },
  {
    path: '/data',
    title: 'Data sources',
    description: 'Public source coverage and freshness evidence.',
    changeFrequency: 'daily',
    priority: 0.85,
  },
  {
    path: '/signals/types',
    title: 'Signal types',
    description: 'Taxonomy of published signal categories.',
    changeFrequency: 'daily',
    priority: 0.75,
  },
  {
    path: '/agent-eval/seo',
    title: 'SEO and GEO audit',
    description: 'Technical SEO and agent-readiness audit surface.',
    changeFrequency: 'monthly',
    priority: 0.7,
  },
  {
    path: '/agent-eval/sample',
    title: 'Agent Eval sample',
    description: 'A public sample agent evaluation.',
    changeFrequency: 'monthly',
    priority: 0.65,
  },
  {
    path: '/case-studies',
    title: 'Company universe',
    description: 'Evidence-backed company and product case studies.',
    changeFrequency: 'weekly',
    priority: 0.85,
  },
  {
    path: '/teardowns',
    title: 'Teardowns',
    description: 'Product teardowns grounded in public evidence.',
    changeFrequency: 'weekly',
    priority: 0.8,
  },
  {
    path: '/domains',
    title: 'Domains',
    description: 'Domain authority evidence from DRank.',
    changeFrequency: 'weekly',
    priority: 0.75,
  },
  {
    path: '/explore',
    title: 'Explore',
    description: 'Directory of reachable High Signal product surfaces.',
    changeFrequency: 'daily',
    priority: 0.75,
  },
  {
    path: '/convergence',
    title: 'Convergence',
    description: 'Signals that converge across independent source classes.',
    changeFrequency: 'weekly',
    priority: 0.7,
  },
  {
    path: '/markets/history',
    title: 'Market history',
    description: 'Historical market intelligence snapshots.',
    changeFrequency: 'daily',
    priority: 0.65,
  },
  {
    path: '/featured',
    title: 'Featured',
    description: 'Curated high-confidence public evidence.',
    changeFrequency: 'weekly',
    priority: 0.7,
  },
  {
    path: '/api-docs',
    title: 'API documentation',
    description: 'Public High Signal API contracts and examples.',
    changeFrequency: 'monthly',
    priority: 0.65,
  },
  {
    path: '/about',
    title: 'About High Signal',
    description: 'Product purpose, scope, and evidence standard.',
    changeFrequency: 'monthly',
    priority: 0.5,
  },
  {
    path: '/changelog',
    title: 'Changelog',
    description: 'Verified shipped High Signal outcomes.',
    changeFrequency: 'monthly',
    priority: 0.5,
  },
  {
    path: '/privacy',
    title: 'Privacy',
    description: 'High Signal privacy policy.',
    changeFrequency: 'yearly',
    priority: 0.3,
  },
  {
    path: '/terms',
    title: 'Terms',
    description: 'High Signal terms.',
    changeFrequency: 'yearly',
    priority: 0.3,
  },
];

export const PUBLIC_DYNAMIC_ROUTE_TEMPLATES = [
  {
    id: 'brief-date',
    html: '/brief/{date}',
    markdown: '/brief/{date}.md',
    description: 'Permanent dated Daily Brief snapshot.',
    pattern: /^\/brief\/\d{4}-\d{2}-\d{2}$/,
  },
  {
    id: 'signal-type',
    html: '/signals/types/{type}',
    markdown: '/signals/types/{type}.md',
    description: 'Published signals in one taxonomy.',
    pattern: /^\/signals\/types\/[^/]+$/,
  },
  {
    id: 'signal',
    html: '/signals/{slug}',
    markdown: '/signals/{slug}.md',
    description: 'One published signal with its cited evidence.',
    pattern: /^\/signals\/(?!rss$|atom$|random$|today$|types(?:\/|$))[^/]+$/,
  },
  {
    id: 'entity-month',
    html: '/entities/{id}/{yyyy-mm}',
    markdown: '/entities/{id}/{yyyy-mm}.md',
    description: 'One entity monthly signal archive.',
    pattern: /^\/entities\/[^/]+\/\d{4}-(0[1-9]|1[0-2])$/,
  },
  {
    id: 'entity',
    html: '/entities/{id}',
    markdown: '/entities/{id}.md',
    description: 'One entity and its relationships and signals.',
    pattern: /^\/entities\/(?!random$)[^/]+$/,
  },
  {
    id: 'case-study-page',
    html: '/case-studies/page/{page}',
    markdown: '/case-studies/page/{page}.md',
    description: 'One page of the company universe.',
    pattern: /^\/case-studies\/page\/[1-9]\d*$/,
  },
  {
    id: 'case-study',
    html: '/case-studies/{slug}',
    markdown: '/case-studies/{slug}.md',
    description: 'One evidence-backed company profile.',
    pattern: /^\/case-studies\/(?!search$|page(?:\/|$))[^/]+$/,
  },
];

const PUBLIC_STATIC_PATHS = new Set(PUBLIC_STATIC_ROUTES.map((route) => route.path));

export function normalizePublicPath(pathname) {
  if (!pathname || pathname === '/') return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export function publicRouteDescriptor(pathname) {
  const path = normalizePublicPath(pathname);
  const exact = PUBLIC_STATIC_ROUTES.find((route) => route.path === path);
  if (exact) return { type: 'static', route: exact };
  const template = PUBLIC_DYNAMIC_ROUTE_TEMPLATES.find((entry) => entry.pattern.test(path));
  if (template) return { type: 'dynamic', route: template };
  return null;
}

export function isPublicHtmlPath(pathname) {
  const path = normalizePublicPath(pathname);
  if (PUBLIC_STATIC_PATHS.has(path)) return true;
  return PUBLIC_DYNAMIC_ROUTE_TEMPLATES.some((entry) => entry.pattern.test(path));
}
