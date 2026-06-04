import fs from 'node:fs';
import path from 'node:path';

type Bucket = 'complaint' | 'praise' | 'pricing' | 'feature_request' | 'positioning';

interface Mention {
  id: string;
  brand: string;
  competitor: boolean;
  source: string;
  url: string;
  author: string;
  publishedAt: string;
  text: string;
}

interface Cluster {
  bucket: Bucket;
  headline: string;
  mentions: Mention[];
  recommendation: string;
}

const BUCKET_RULES: Array<[Bucket, RegExp]> = [
  ['pricing', /price|pricing|pay|paid|packag/i],
  ['feature_request', /want|wish|should|need|missing|before I/i],
  ['complaint', /cannot|can't|confusing|hard|does not|doesn't|but/i],
  ['praise', /useful|strong|polished|easy/i],
  ['positioning', /enterprise|team|competitor|monthly|report/i],
];

export function buildCompetitorPerceptionInbox(mentions: Mention[]) {
  const clusters = clusterMentions(mentions);
  const ownedMentions = mentions.filter((mention) => !mention.competitor).length;
  const competitorMentions = mentions.length - ownedMentions;
  const topRecommendation = clusters
    .filter((cluster) => cluster.bucket !== 'praise')
    .sort((a, b) => b.mentions.length - a.mentions.length)[0]?.recommendation
    ?? 'Keep collecting evidence before changing positioning.';

  return {
    generatedAt: '2026-06-04T00:00:00.000Z',
    summary: {
      mentionCount: mentions.length,
      ownedMentions,
      competitorMentions,
      buckets: clusters.map((cluster) => ({
        bucket: cluster.bucket,
        count: cluster.mentions.length,
        headline: cluster.headline,
      })),
    },
    clusters,
    monthlyReportReadyRecommendation: topRecommendation,
  };
}

export function renderCompetitorPerceptionMarkdown(report: ReturnType<typeof buildCompetitorPerceptionInbox>) {
  return [
    '# Competitor Perception Signal Inbox',
    '',
    `Mentions: ${report.summary.mentionCount} (${report.summary.ownedMentions} owned, ${report.summary.competitorMentions} competitor)`,
    '',
    `Monthly-report recommendation: ${report.monthlyReportReadyRecommendation}`,
    '',
    ...report.clusters.flatMap((cluster) => [
      `## ${cluster.headline}`,
      '',
      `Bucket: ${cluster.bucket}`,
      `Recommendation: ${cluster.recommendation}`,
      '',
      ...cluster.mentions.map((mention) => `- [${mention.source}] ${mention.brand}: ${mention.text} (${mention.url})`),
      '',
    ]),
  ].join('\n');
}

function clusterMentions(mentions: Mention[]): Cluster[] {
  const groups = new Map<Bucket, Mention[]>();
  for (const mention of mentions) {
    const bucket = BUCKET_RULES.find(([, rule]) => rule.test(mention.text))?.[0] ?? 'positioning';
    groups.set(bucket, [...(groups.get(bucket) ?? []), mention]);
  }

  return Array.from(groups.entries()).map(([bucket, bucketMentions]) => ({
    bucket,
    headline: headlineFor(bucket, bucketMentions),
    mentions: bucketMentions,
    recommendation: recommendationFor(bucket, bucketMentions),
  }));
}

function headlineFor(bucket: Bucket, mentions: Mention[]) {
  const brands = Array.from(new Set(mentions.map((mention) => mention.brand))).join(' vs ');
  const label = bucket.replace('_', ' ');
  return `${titleCase(label)} signals across ${brands}`;
}

function recommendationFor(bucket: Bucket, mentions: Mention[]) {
  const evidenceCount = mentions.length;
  if (bucket === 'complaint') return `Add source-trail and confidence copy beside each daily brief claim; cited by ${evidenceCount} signal${evidenceCount === 1 ? '' : 's'}.`;
  if (bucket === 'pricing') return 'Frame the monthly report as an operator add-on, not an enterprise research suite.';
  if (bucket === 'feature_request') return 'Prototype a report-ready source/evidence strip before expanding ingestion volume.';
  if (bucket === 'positioning') return 'Position against broad research tools by owning complaint-to-roadmap conversion.';
  return 'Keep the cited praise as proof copy, but do not let praise clusters create roadmap tasks.';
}

function titleCase(input: string) {
  return input.replace(/\b\w/g, (char) => char.toUpperCase());
}

function main() {
  const fixturePath = process.argv[2] ?? 'fixtures/competitor-perception-mentions.json';
  const outPath = process.argv[3] ?? 'reports/prototypes/competitor-perception-inbox.md';
  const mentions = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Mention[];
  const report = buildCompetitorPerceptionInbox(mentions);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderCompetitorPerceptionMarkdown(report));
  console.log(JSON.stringify({
    outPath,
    mentionCount: report.summary.mentionCount,
    buckets: report.summary.buckets.length,
    recommendation: report.monthlyReportReadyRecommendation,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
