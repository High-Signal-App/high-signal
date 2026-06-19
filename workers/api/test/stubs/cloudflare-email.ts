// Test-only stub for the workerd-provided `cloudflare:email` virtual module,
// which is unavailable under vitest's node environment. Aliased in
// vitest.config.ts. Production builds use the real module from the runtime.
export class EmailMessage {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly raw: string | ReadableStream,
  ) {}
}
