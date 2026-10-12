import { appendFileSync } from 'node:fs';

const response = await fetch('https://highsignal.app/api/reader-build', {
  signal: AbortSignal.timeout(20_000),
});
let source = null;
if (response.status !== 404) {
  if (!response.ok) throw new Error(`Reader discovery returned ${response.status}`);
  const build = await response.json();
  if (build.schema !== 1 || !/^[a-f0-9]{40}$/.test(build.source))
    throw new Error('Invalid reader source');
  source = build.source;
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `ready=${source !== null}\nsource=${source ?? ''}\n`);
console.log(
  source ? `Reader source: ${source}` : 'Reader is not deployed; publisher remains inactive.'
);
