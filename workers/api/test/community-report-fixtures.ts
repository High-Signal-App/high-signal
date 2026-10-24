import {
  communityPassages,
  type CommunityReport,
  type CommunityResearchDocument,
  type communityReportProof,
} from '../src/lib/community-report-proof';

const PRIMARY = [
  'The independent developer survey asked participants how they review generated code before shipping software.',
  'Respondents described spending additional time checking logic, dependencies, boundary conditions and test coverage.',
  'The questionnaire asked about experienced review effort rather than estimating a causal productivity effect.',
  'Participants came from an opt-in sample, so their answers should not be generalized to every development team.',
  'The authors published the question wording and cautioned that self-reported experience is not a controlled trial.',
  'The results identify a practical review problem without establishing customer demand or willingness to pay.',
].join(' ');
const CORROBORATION = [
  'A separately recruited group of software practitioners evaluated their experience validating machine-written changes.',
  'They reported difficulties catching plausible mistakes and deciding whether automated suggestions were trustworthy.',
  'This project collected its own responses and did not reuse the other survey population or aggregate their percentages.',
  'The investigators distinguish perceived checking effort from measured engineering throughput or organizational revenue.',
  'The convenience sample includes volunteers, which limits claims about the prevalence of these experiences.',
  'Further field observations would be needed to establish whether a new review service improves outcomes in practice.',
].join(' ');

export function researchDocument(
  id: 'primary' | 'corroboration',
  changes: Partial<CommunityResearchDocument> = {}
): CommunityResearchDocument {
  const text = changes.text ?? (id === 'primary' ? PRIMARY : CORROBORATION);
  return {
    id,
    recordId: `record-${id}`,
    source: `news:study-${id}`,
    url: `https://${id}.example/study`,
    title: id === 'primary' ? 'Marigold evaluation survey' : 'Marigold feedback study',
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    hash: (id === 'primary' ? 'a' : 'b').repeat(64),
    text,
    passages: communityPassages(text),
    metadata: { documentKind: 'independent_survey' },
    ...changes,
  };
}

export function reportFixture(changes: Partial<CommunityReport> = {}): CommunityReport {
  return {
    publish: true,
    section: 'trends',
    title: 'Separate developer studies identify a review burden',
    description:
      'Separate developer studies describe difficulties reviewing generated code, with each sample retaining its own limitations.',
    whyNow:
      'Teams could test review workflows as an untested hypothesis before making claims about productivity or demand.',
    uncertainty:
      'The volunteer samples do not establish prevalence, causality or willingness to pay across the developer population.',
    citations: [
      { documentId: 'primary', passageId: 'P0' },
      { documentId: 'corroboration', passageId: 'P0' },
    ],
    ...changes,
  };
}

export function verificationFixture(): Parameters<typeof communityReportProof>[1] {
  return {
    verified: true,
    copyAligned: true,
    evidence: ['primary', 'corroboration'].map((documentId, index) => ({
      documentId,
      aligned: true,
      role: index === 0 ? 'primary' : 'corroboration',
      origin: `independently-collected-${documentId}-study`,
      supports: ['description', 'whyNow'],
    })),
  };
}
