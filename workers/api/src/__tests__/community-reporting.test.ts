import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateChatCompletion } from '../lib/ai-client';
import {
  assertCommunityResearchAvailable,
  communityResearchPlan,
  initializePublicCommunityReporting,
  researchPublicCommunity,
} from '../lib/community-reporting';
import { buildIdeas, buildTrends } from '../routes/brief/query';
import { db } from '../db';
import { applyMigrations, createSqliteD1, type TestD1 } from '../../test/sqlite-d1';
import {
  reportFixture,
  researchDocument,
  verificationFixture,
} from '../../test/community-report-fixtures';
import {
  communityVerificationSchema,
  communityPassages,
  type CommunityResearchDocument,
} from '../lib/community-report-proof';

vi.mock('../lib/ai-client', () => ({ generateChatCompletion: vi.fn() }));
const complete = vi.mocked(generateChatCompletion);
const freeGateway = { fetch: vi.fn() } as unknown as Fetcher;
let database: TestD1;
const communityId = 'retained-public-community';
const leadId = 'retained-investigation-lead';

async function seedCommunity(isPublic = true, subreddit = 'ExperiencedDevs') {
  const now = Math.floor(Date.now() / 1000);
  await database.binding
    .prepare(`INSERT INTO tracked_communities
    (id,owner_id,subreddit,prompt,period,is_public,created_at,updated_at)
    VALUES(?,'operator',?,?,'week',?,?,?)`)
    .bind(
      communityId,
      subreddit,
      'Developer workflows, code review, software quality, trust and AI adoption.',
      isPublic ? 1 : 0,
      now,
      now
    )
    .run();
}

async function seedLead() {
  const now = Math.floor(Date.now() / 1000);
  await database.binding
    .prepare(`INSERT INTO events
    (id,source,source_url,published_at,title,content,raw_hash,ingested_at)
    VALUES(?,'reddit:ExperiencedDevs',?,?,?,?,'lead-hash',?)`)
    .bind(
      leadId,
      'https://www.reddit.com/r/ExperiencedDevs/comments/lead',
      now - 600,
      'Marigold adoption study needs review',
      'A retained community observation is only an investigation lead.',
      now
    )
    .run();
}

async function seedDocument(document: CommunityResearchDocument) {
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = Math.floor(Date.parse(document.publishedAt) / 1000);
  await database.binding
    .prepare(`INSERT INTO source_documents
    (id,source,canonical_url,document_key,fetched_at,published_at,raw_hash,raw_text,parsed_fields,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      document.id,
      document.source,
      document.url,
      `${document.source}:${document.url}`,
      now,
      publishedAt,
      document.hash,
      document.text,
      JSON.stringify(document.metadata),
      now
    )
    .run();
  await database.binding
    .prepare(`INSERT INTO events
    (id,source,source_url,published_at,title,content,raw_hash,source_document_id,ingested_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(
      document.recordId,
      document.source,
      document.url,
      publishedAt,
      document.title,
      document.text,
      `event-${document.hash}`,
      document.id,
      now
    )
    .run();
}

async function seedResearch(documentCount = 2) {
  await seedCommunity();
  await seedLead();
  await seedDocument(researchDocument('primary'));
  if (documentCount > 1) await seedDocument(researchDocument('corroboration'));
}

async function count(table: string): Promise<number> {
  const row = await database.binding
    .prepare(`SELECT count(*) AS count FROM ${table}`)
    .first<{ count: number }>();
  return row!.count;
}

function mockSuccessfulResearch() {
  complete.mockImplementation(async (options) => {
    const verifying = options.messages[0].content.startsWith('Independently verify');
    return JSON.stringify(verifying ? verificationFixture() : { report: reportFixture() });
  });
}

beforeEach(() => {
  database = createSqliteD1();
  applyMigrations(database);
  complete.mockReset();
  mockSuccessfulResearch();
});
afterEach(() => database.close());

describe('public community retained source to reader', () => {
  it('keeps community question boilerplate out of the SQL shortlist and ranks subject matches first', async () => {
    await seedCommunity();
    await seedLead();
    await database.binding
      .prepare('UPDATE events SET title=? WHERE id=?')
      .bind('Does anybody here use a formal system for review?', leadId)
      .run();
    const text = 'The report describes retained observations and their limitations. '.repeat(12);
    // More than LIMIT 60 misleading question matches must not crowd out the subject.
    for (let index = 0; index < 62; index++) {
      await seedDocument(
        researchDocument('primary', {
          id: `question-noise-${index}`,
          hash: index.toString(16).padStart(64, '0'),
          recordId: `question-noise-event-${index}`,
          url: `https://noise-${index}.example/report`,
          title: "Paid parental leave doesn't strain employers, survey finds",
          text: `A parental leave survey. ${text}`,
        })
      );
    }
    await seedDocument(
      researchDocument('primary', {
        title: 'AI is making developers faster. It also exposes broken software delivery',
        text,
      })
    );
    await seedDocument(
      researchDocument('corroboration', {
        title: 'A formal system for review workflows',
        text,
      })
    );
    await seedDocument(
      researchDocument('primary', {
        id: 'airport',
        hash: 'c'.repeat(64),
        recordId: 'airport-event',
        url: 'https://airport.example/report',
        title: 'Airport drop-off charges to be reviewed',
        text: `An unrelated transport study. ${text}`,
      })
    );
    complete.mockResolvedValue(
      JSON.stringify({
        report: { publish: false, reason: 'Retrieval test only; no report is qualified.' },
      })
    );
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'withheld', reason: 'insufficient_evidence' });
    const request = JSON.parse(complete.mock.calls[0][0].messages[1].content);
    // A generic study marker is only a tiebreaker after meaningful title relevance.
    expect(request.documents.map((document: { id: string }) => document.id)).toEqual([
      'corroboration',
      'primary',
      'airport',
    ]);
    expect(await count('claim_records')).toBe(0);
  });

  it('offers bounded relevant existing passages while retaining complete source text', async () => {
    await seedCommunity();
    await seedLead();
    const background =
      'Background observations give context and describe unrelated circumstances. '.repeat(20);
    const subject =
      'Developer code review workflows describe software quality and formal systems. '.repeat(20);
    const text = `${background}${subject}${background}${subject}${background}`;
    for (let index = 0; index < 8; index++) {
      await seedDocument(
        researchDocument('primary', {
          id: `large-${index}`,
          recordId: `large-event-${index}`,
          hash: index.toString(16).padStart(64, '0'),
          url: `https://publication-${index}.example/report`,
          title: `Marigold review survey ${'detailed retained context '.repeat(20)}`,
          publishedAt: new Date(Date.now() - (3600 + index * 60) * 1000).toISOString(),
          text,
        })
      );
    }
    complete.mockResolvedValue(
      JSON.stringify({
        report: {
          publish: false,
          reason: 'The retained material does not establish independent evidence.',
        },
      })
    );
    await researchPublicCommunity(
      { DB: database.binding, FREE_AI: freeGateway },
      communityId,
      leadId
    );
    const options = complete.mock.calls[0][0];
    expect(
      options.messages[0].content.length + options.messages[1].content.length
    ).toBeLessThanOrEqual(14_000);
    const request = JSON.parse(options.messages[1].content);
    expect(request.documents.length).toBeGreaterThanOrEqual(2);
    expect(request.documents.length).toBeLessThan(8);
    expect(request.documents.map((document: { id: string }) => document.id)).toEqual(
      Array.from({ length: request.documents.length }, (_, index) => `large-${index}`)
    );
    const original = communityPassages(text.slice(0, 8_000));
    for (const document of request.documents) {
      expect(Object.keys(document.passages)).toEqual(['P2', 'P3']);
      for (const [id, passage] of Object.entries(document.passages)) {
        expect(passage).toBe(original[id]);
        expect(passage).toContain('Developer code review workflows');
      }
    }
    const retained = await database.binding
      .prepare('SELECT raw_text FROM source_documents WHERE id=?')
      .bind('large-0')
      .first<{ raw_text: string }>();
    expect(retained?.raw_text).toBe(text);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await count('claim_records')).toBe(0);
  });

  it('audits an oversized two-document input without calling a model', async () => {
    await seedResearch();
    await database.binding
      .prepare('UPDATE events SET source_url=? WHERE id=?')
      .bind(
        `https://www.reddit.com/r/ExperiencedDevs/comments/lead?context=${'x'.repeat(14_000)}`,
        leadId
      )
      .run();
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toEqual({ status: 'unavailable', reason: 'research_request_too_large' });
    expect(complete).not.toHaveBeenCalled();
    expect(await count('claim_records')).toBe(0);
    const audit = await database.binding
      .prepare('SELECT accepted,reason,response_json FROM llm_runs')
      .first<{ accepted: number; reason: string; response_json: string }>();
    expect(audit).toMatchObject({ accepted: 0, reason: 'research_request_too_large' });
    expect(JSON.parse(audit!.response_json).requestChars).toBeGreaterThan(14_000);
    await expect(assertCommunityResearchAvailable(database.binding)).rejects.toThrow(
      'community_research_unavailable'
    );
  });

  it('rejects an existing but unoffered passage before verification', async () => {
    await seedCommunity();
    await seedLead();
    const background =
      'Background observations give context and describe unrelated circumstances. '.repeat(20);
    const subject =
      'Developer code review workflows describe software quality and formal systems. '.repeat(20);
    const text = `${background}${subject}${background}`;
    await seedDocument(researchDocument('primary', { text }));
    await seedDocument(researchDocument('corroboration', { text }));
    complete.mockImplementation(async (options) => {
      const request = JSON.parse(options.messages[1].content);
      expect(
        request.documents.find((document: { id: string }) => document.id === 'primary').passages.P0
      ).toBeUndefined();
      return JSON.stringify({ report: reportFixture() });
    });
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toEqual({ status: 'withheld', reason: 'invalid_passage' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await count('claim_records')).toBe(0);
  });

  it('publishes actual SQLite receipts, keeps community context separate, and renders only the proven item', async () => {
    await seedResearch();
    const result = await researchPublicCommunity(
      { DB: database.binding, FREE_AI: freeGateway },
      communityId,
      leadId
    );
    expect(result.status).toBe('published');
    expect(await count('community_digest_snapshots')).toBe(1);
    expect(await count('claim_records')).toBe(1);
    const links = await database.binding
      .prepare(`SELECT role,semantic_alignment,source_document_id,notes
      FROM claim_evidence_links ORDER BY role`)
      .all<{
        role: string;
        semantic_alignment: string;
        source_document_id: string | null;
        notes: string;
      }>();
    expect(links.results.filter((link) => link.role !== 'context')).toHaveLength(2);
    expect(links.results.find((link) => link.role === 'context')).toMatchObject({
      semantic_alignment: 'unverified',
      source_document_id: null,
    });
    for (const link of links.results.filter((link) => link.role !== 'context')) {
      const receipt = JSON.parse(link.notes);
      expect(receipt.quote.length).toBeGreaterThanOrEqual(40);
      expect(receipt.documentHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const audit = await database.binding
      .prepare('SELECT accepted,request_json,response_json FROM llm_runs')
      .first<{ accepted: number; request_json: string; response_json: string }>();
    expect(audit?.accepted).toBe(1);
    expect(JSON.parse(audit!.response_json).verification.copyAligned).toBe(true);
    const request = JSON.parse(audit!.request_json).input;
    expect(request.documents.map((document: { id: string }) => document.id).sort()).toEqual([
      'corroboration',
      'primary',
    ]);
    // These titles contain Marigold, not the static community prompt tokens.
    // The actual SQL must use the lead's anchor to retrieve both studies.
    expect(complete).toHaveBeenCalledTimes(2);
    const verificationInput = JSON.parse(complete.mock.calls[1][0].messages[1].content);
    expect(verificationInput.selected[0].document.passage).toBe(
      researchDocument('primary').passages['P0']
    );
    expect(verificationInput.selected[0].document.passages).toBeUndefined();
    for (const [options] of complete.mock.calls) {
      expect(options.config).toMatchObject({ gateway: freeGateway, model: 'auto' });
      expect(options.config.endpointUrl).toBeUndefined();
      expect(options.config.apiKey).toBeUndefined();
      expect(options.responseSchema).toBeDefined();
    }
    const outputSchema = complete.mock.calls[0][0].responseSchema as z.ZodType;
    expect(outputSchema.safeParse({ report: reportFixture() }).success).toBe(true);
    expect(outputSchema.safeParse(reportFixture()).success).toBe(false);
    expect(outputSchema.safeParse({ report: reportFixture(), extra: true }).success).toBe(false);
    expect(complete.mock.calls[1][0].responseSchema).toBe(communityVerificationSchema);
    expect(complete.mock.calls[1][0].messages[0].content).toContain(
      '"supports":["description","whyNow"]'
    );
    const trends = await buildTrends(db(database.binding), 'global', []);
    expect(trends).toHaveLength(1);
    expect(trends[0].description).toBe(reportFixture().description);
    expect(trends[0].provenance?.independentOriginCount).toBe(2);
    expect(trends[0].evidenceUrls.map((citation) => citation.url).sort()).toEqual([
      researchDocument('corroboration').url,
      researchDocument('primary').url,
    ]);
    expect(trends[0].evidenceUrls.some((citation) => citation.url.includes('reddit.com'))).toBe(
      false
    );
    expect(await buildIdeas(db(database.binding), 'global', [])).toEqual([]);
  });

  it('preserves an existing private community when installing publication defaults', async () => {
    await seedCommunity(false, 'experienceddevs');
    await initializePublicCommunityReporting(database.binding);
    const rows = await database.binding
      .prepare('SELECT id,is_public FROM tracked_communities WHERE lower(subreddit)=?')
      .bind('experienceddevs')
      .all<{ id: string; is_public: number }>();
    expect(rows.results).toEqual([{ id: communityId, is_public: 0 }]);
    expect(
      (await communityResearchPlan(database.binding)).some(
        (community) => community.id === communityId
      )
    ).toBe(false);
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'withheld', reason: 'public_community_not_found' });
    expect(complete).not.toHaveBeenCalled();
    expect(await count('claim_records')).toBe(0);
  });

  it('qualifies opportunities through the same proof path and rejects edited visible copy', async () => {
    await seedResearch();
    complete.mockImplementation(async (options) =>
      JSON.stringify(
        options.messages[0].content.startsWith('Independently verify')
          ? verificationFixture()
          : { report: { ...reportFixture(), section: 'ideas' } }
      )
    );
    expect(
      (
        await researchPublicCommunity(
          { DB: database.binding, FREE_AI: freeGateway },
          communityId,
          leadId
        )
      ).status
    ).toBe('published');
    const ideas = await buildIdeas(db(database.binding), 'global', []);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].uncertainty).toBe(reportFixture().uncertainty);
    expect(await buildTrends(db(database.binding), 'global', [])).toEqual([]);
    await database.binding
      .prepare(
        `UPDATE community_digest_snapshots SET summary=json_set(summary,'$.keyAction.title','Unsupported market size headline')`
      )
      .run();
    expect(await buildIdeas(db(database.binding), 'global', [])).toEqual([]);
  });

  it('withholds insufficient evidence without inventing a draft or calling AI', async () => {
    await seedResearch(1);
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'withheld', reason: 'insufficient_retained_documents' });
    expect(complete).not.toHaveBeenCalled();
    expect(await count('claim_records')).toBe(0);
    expect(await count('community_digest_snapshots')).toBe(0);
    await expect(assertCommunityResearchAvailable(database.binding)).resolves.toBeUndefined();
    expect(await buildTrends(db(database.binding), 'global', [])).toEqual([]);
  });

  it('records a valid model refusal as quiet and never attempts verification or publication', async () => {
    await seedResearch();
    complete.mockResolvedValue(
      JSON.stringify({
        report: {
          publish: false,
          reason: 'The two documents do not support the same narrow observation.',
        },
      })
    );
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'withheld', reason: 'insufficient_evidence' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await count('claim_records')).toBe(0);
    await expect(assertCommunityResearchAvailable(database.binding)).resolves.toBeUndefined();
  });

  it('withholds repeated document citations before verification and retains the audit', async () => {
    await seedResearch();
    const report = reportFixture({
      citations: [
        { documentId: 'primary', passageId: 'P0' },
        { documentId: 'primary', passageId: 'P1' },
      ],
    });
    complete.mockResolvedValue(JSON.stringify({ report }));
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toEqual({ status: 'withheld', reason: 'duplicate_document' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await count('claim_records')).toBe(0);
    expect(await count('community_digest_snapshots')).toBe(0);
    const audit = await database.binding
      .prepare('SELECT accepted,reason,response_json FROM llm_runs')
      .first<{ accepted: number; reason: string; response_json: string }>();
    expect(audit).toMatchObject({ accepted: 0, reason: 'duplicate_document' });
    expect(JSON.parse(audit!.response_json)).toEqual({ report });
  });

  it('rejects unwrapped generator objects without attempting verification', async () => {
    await seedResearch();
    complete.mockResolvedValue(JSON.stringify(reportFixture()));
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'unavailable', reason: 'invalid_model_response' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await count('claim_records')).toBe(0);
  });

  it('keeps unavailable AI distinct from a successful quiet research result', async () => {
    await seedResearch();
    expect(
      await researchPublicCommunity({ DB: database.binding }, communityId, leadId)
    ).toMatchObject({ status: 'unavailable' });
    expect(await count('claim_records')).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    await expect(assertCommunityResearchAvailable(database.binding)).rejects.toThrow(
      'community_research_unavailable'
    );
  });

  it('retains malformed completion text and its failure stage without provider secrets', async () => {
    await seedResearch();
    complete.mockResolvedValue('```json\n{"publish":true');
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'unavailable', reason: 'invalid_model_response' });
    const audit = await database.binding
      .prepare('SELECT response_json FROM llm_runs')
      .first<{ response_json: string }>();
    expect(JSON.parse(audit!.response_json)).toEqual({
      output: { generationText: '```json\n{"publish":true' },
      failure: { stage: 'generation', kind: 'invalid_json', statusCode: null },
    });
    expect(await count('claim_records')).toBe(0);
  });

  it('records provider status without retaining error messages or headers', async () => {
    await seedResearch();
    complete.mockRejectedValue(
      Object.assign(new Error('secret provider detail'), {
        statusCode: 503,
        headers: { authorization: 'secret header' },
      })
    );
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'unavailable', reason: 'research_or_model_unavailable' });
    const audit = await database.binding
      .prepare('SELECT response_json FROM llm_runs')
      .first<{ response_json: string }>();
    expect(JSON.parse(audit!.response_json)).toEqual({
      output: null,
      failure: { stage: 'generation', kind: 'request_or_storage_error', statusCode: 503 },
    });
    expect(audit!.response_json).not.toContain('secret');
  });

  it('keeps already qualified reports readable when later research is unavailable', async () => {
    await seedResearch();
    expect(
      (
        await researchPublicCommunity(
          { DB: database.binding, FREE_AI: freeGateway },
          communityId,
          leadId
        )
      ).status
    ).toBe('published');
    await database.binding
      .prepare(`INSERT INTO llm_runs
      (id,model,prompt_version,accepted,reason,request_json,response_json,created_at)
      VALUES('later-failure','auto','community-report-v3',0,'research_or_model_unavailable',
      '{"communityId":"another-public-community"}','null',unixepoch()+1)`)
      .run();
    expect(await buildTrends(db(database.binding), 'global', [])).toHaveLength(1);
    await expect(buildIdeas(db(database.binding), 'global', [])).rejects.toThrow(
      'community_research_unavailable'
    );
    expect(await buildIdeas(db(database.binding), 'south-asia', [])).toEqual([]);
  });

  it('rolls back the digest, claim and evidence if its successful model audit cannot commit', async () => {
    await seedResearch();
    database.exec(`CREATE TRIGGER fail_accepted_community_audit BEFORE INSERT ON llm_runs
      WHEN NEW.accepted=1 BEGIN SELECT RAISE(ABORT,'accepted audit storage unavailable'); END;`);
    expect(
      await researchPublicCommunity(
        { DB: database.binding, FREE_AI: freeGateway },
        communityId,
        leadId
      )
    ).toMatchObject({ status: 'unavailable' });
    for (const table of [
      'community_digest_snapshots',
      'claim_records',
      'claim_evidence_links',
      'claim_timeline_events',
    ]) {
      expect(await count(table)).toBe(0);
    }
    const failed = await database.binding
      .prepare('SELECT accepted,reason FROM llm_runs')
      .first<{ accepted: number; reason: string }>();
    expect(failed?.accepted).toBe(0);
    await expect(assertCommunityResearchAvailable(database.binding)).rejects.toThrow(
      'community_research_unavailable'
    );
  });

  it('retries preserve the published item and its original audit without another model call', async () => {
    await seedResearch();
    const env = { DB: database.binding, FREE_AI: freeGateway };
    const first = await researchPublicCommunity(env, communityId, leadId);
    const again = await researchPublicCommunity(env, communityId, leadId);
    expect(first.status).toBe('published');
    expect(again).toMatchObject({ status: 'already_published', claimId: first.claimId });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(await count('community_digest_snapshots')).toBe(1);
    expect(await count('claim_records')).toBe(1);
    expect(await count('llm_runs')).toBe(1);
  });
});
