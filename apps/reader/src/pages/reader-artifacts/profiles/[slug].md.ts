import { createElement } from 'react';
import { CASE_STUDIES } from '@/app/case-studies/data';
import { CompanyProfileContent } from '@/app/case-studies/[slug]/CompanyProfileContent';
import { evaluateCompany } from '@web-root/public-corpus-policy.mjs';
import { publicSourceTree } from '@/lib/public-source-tree';
import { absoluteMarkdownLinks } from '@web-root/agent-surfaces/format.mjs';
import { SITE_URL } from '@/lib/site';
export function getStaticPaths() {
  if (process.env['READER_BUILD_MODE'] === 'brief') return [];
  return CASE_STUDIES.filter((study) => evaluateCompany(study).eligible).map((study) => ({
    params: { slug: study.slug },
    props: { study },
  }));
}
export async function GET({ props }: { props: { study: (typeof CASE_STUDIES)[number] } }) {
  const { study } = props;
  const canonical = `${SITE_URL}/case-studies/${study.slug}`;
  const category = study.category === 'Other' ? 'company' : study.category;
  const title = `${study.name}: ${category}, provenance, and similar companies`;
  const description = (
    study.description
      ? `${study.description} Explore official provenance and meaningfully similar companies.`
      : `${study.name} company profile with official-source provenance and similar companies.`
  )
    .slice(0, 160)
    .replace(/\s+\S*$/, '');
  const content = await publicSourceTree(createElement(CompanyProfileContent, { study }), {
    canonical,
  });
  return new Response(
    absoluteMarkdownLinks(
      `# ${title}\n\n> ${description}\n\nCanonical: ${canonical}\n\n${content.replace(/^# [^\n]*\n/m, '').trim()}\n`,
      canonical
    ),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }
  );
}
