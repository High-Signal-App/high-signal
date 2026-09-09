import { parseAiVerdictResponse, type VerdictResult } from './auto-publish-rules';

type JudgeFailure = 'network' | 'invalid_json' | 'invalid_verdict' | `http_${number}`;
export type JudgeResponse =
  | { verdict: VerdictResult; attempts: number }
  | { failure: JudgeFailure; attempts: number };

/** Retry transport/generation failures once; never relax the response or editorial contract. */
export async function requestJudge(
  url: string,
  request: RequestInit,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    retryDelayMs?: number;
  } = {}
): Promise<JudgeResponse> {
  const fetcher = options.fetch ?? fetch;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let failure: JudgeFailure = 'network';
    let retryable = true;
    try {
      const response = await fetcher(url, {
        ...request,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (!response.ok) {
        failure = `http_${response.status}`;
        // The configured gateway reports failed JSON generation as HTTP 400.
        // Inspect only to classify; provider bodies may contain sensitive data.
        const jsonGenerationFailure =
          response.status === 400 &&
          /failed to validate json|json_validate_failed/i.test(await response.text());
        retryable = response.status === 429 || response.status >= 500 || jsonGenerationFailure;
      } else {
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          failure = 'invalid_json';
        }
        if (data !== undefined) {
          const verdict = parseAiVerdictResponse(data);
          if (verdict) return { verdict, attempts: attempt };
          failure = 'invalid_verdict';
        }
      }
    } catch {
      // Do not log exception messages: transports can include URLs or headers.
      failure = 'network';
    }
    if (!retryable || attempt === 2) return { failure, attempts: attempt };
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 500));
  }
  throw new Error('Unreachable judge attempt limit');
}
