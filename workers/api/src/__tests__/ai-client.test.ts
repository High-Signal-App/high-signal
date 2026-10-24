import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateChatCompletion } from '../lib/ai-client';

function fakeGateway(content: string, status = 200) {
  const requests: { headers: Headers; body: unknown }[] = [];
  const fetch = vi.fn(async (request: Request) => {
    requests.push({ headers: request.headers, body: await request.json() });
    return new Response(
      JSON.stringify(
        status === 200
          ? {
              id: 'completion-test',
              object: 'chat.completion',
              created: 0,
              model: 'test-provider',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }
          : { error: { message: 'test gateway unavailable' } }
      ),
      { status, headers: { 'content-type': 'application/json' } }
    );
  });
  return { binding: { fetch } as unknown as Fetcher, fetch, requests };
}

const responseSchema = z
  .object({
    report: z
      .object({
        section: z.enum(['ideas', 'trends']),
        evidence: z.array(z.object({ documentId: z.string() }).strict()),
      })
      .strict(),
  })
  .strict();

describe('generateChatCompletion schema output', () => {
  it('sends a strict root-object JSON schema while retaining gateway routing and raw text', async () => {
    const raw = ' {"report":{"section":"trends","evidence":[{"documentId":"doc-1"}]}} ';
    const gateway = fakeGateway(raw);
    const result = await generateChatCompletion({
      config: { gateway: gateway.binding, model: 'unused-client-model' },
      messages: [{ role: 'user', content: 'Return JSON.' }],
      responseSchema,
      maxTokens: 2_000,
    });

    expect(result).toBe(raw);
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
    const request = gateway.requests[0]!;
    expect(request.headers.get('x-gateway-project-id')).toBe('high-signal');
    expect(request.body).toMatchObject({
      model: 'auto',
      max_tokens: 2_000,
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            type: 'object',
            required: ['report'],
            additionalProperties: false,
            properties: {
              report: {
                type: 'object',
                required: ['section', 'evidence'],
                additionalProperties: false,
                properties: { section: { enum: ['ideas', 'trends'] } },
              },
            },
          },
        },
      },
    });
  });

  it('preserves malformed model text for the caller validation and audit', async () => {
    const raw = '{"publish":false,"reason":"unescaped "quote""}';
    const gateway = fakeGateway(raw);
    await expect(
      generateChatCompletion({
        config: { gateway: gateway.binding, model: 'auto' },
        messages: [{ role: 'user', content: 'Return JSON.' }],
        responseSchema,
      })
    ).resolves.toBe(raw);
    expect(gateway.requests[0]!.body).toHaveProperty('response_format.type', 'json_schema');
  });

  it('preserves schema-invalid JSON for the caller validation and audit', async () => {
    const raw =
      '{"report":{"section":"ideas|trends","evidence":[{"documentId":"doc-1","passage":"extra"}]}}';
    const gateway = fakeGateway(raw);
    const result = await generateChatCompletion({
      config: { gateway: gateway.binding, model: 'auto' },
      messages: [{ role: 'user', content: 'Return JSON.' }],
      responseSchema,
    });
    expect(result).toBe(raw);
    expect(responseSchema.safeParse(JSON.parse(result)).success).toBe(false);
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps existing text callers free of JSON output requirements', async () => {
    const gateway = fakeGateway('Ordinary text response.');
    await expect(
      generateChatCompletion({
        config: { gateway: gateway.binding, model: 'auto' },
        messages: [{ role: 'user', content: 'Explain the result.' }],
      })
    ).resolves.toBe('Ordinary text response.');
    expect(gateway.requests[0]!.body).not.toHaveProperty('response_format');
  });

  it('does not turn gateway failures into successful model text or retry them', async () => {
    const gateway = fakeGateway('', 503);
    await expect(
      generateChatCompletion({
        config: { gateway: gateway.binding, model: 'auto' },
        messages: [{ role: 'user', content: 'Return JSON.' }],
        responseSchema,
      })
    ).rejects.toThrow();
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
  });
});
