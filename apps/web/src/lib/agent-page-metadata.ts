import type { Metadata } from 'next';
import { SITE_DESCRIPTION, SITE_URL } from './site';
import { publicRouteDescriptor } from '../../public-route-registry.mjs';
import { markdownPathFor } from '../../agent-surfaces/http.mjs';
export function isIndexableMetadata(metadata: Metadata) {
  const robots = metadata.robots;
  return typeof robots === 'string'
    ? !/(?:noindex|\bnone\b)/i.test(robots)
    : robots?.index !== false;
}
export function withAgentMetadata(metadata: Metadata, path: string): Metadata {
  if (!isIndexableMetadata(metadata)) return metadata;
  const declared = metadata.alternates?.canonical;
  const canonicalValue =
    typeof declared === 'string' || declared instanceof URL ? declared : declared?.url;
  const canonical = new URL(canonicalValue ?? path, SITE_URL);
  const description =
    metadata.description ?? publicRouteDescriptor(path)?.route.description ?? SITE_DESCRIPTION;
  return {
    ...metadata,
    description,
    other: { ...metadata.other, 'ai-summary': description },
    alternates: {
      ...metadata.alternates,
      canonical: declared ?? canonical.href,
      types: {
        ...metadata.alternates?.types,
        'text/markdown': new URL(markdownPathFor(canonical.pathname), SITE_URL).href,
      },
    },
  };
}
