# Tasks

- [x] Add a testable cache wrapper for successful canonical public Markdown.
- [x] Route anonymous `.md` GET requests through the wrapper before OpenNext.
- [x] Cover cache hit, cache miss, authenticated/query/HEAD bypass, and error
      non-storage behavior.
- [x] Run the focused Markdown and Worker routing tests.
- [x] Run web typecheck, targeted lint, public corpus receipt, and production
      build.
- [x] Archive the OpenSpec change and update `PROJECT_STATUS.md`.
- [x] Open a PR with `Closes #79`, merge after green CI, run the deploy guard,
      deploy the exact main SHA, and verify production cache behavior.
- [x] Warm the 35 catalog Markdown URLs and rerun the full production agent
      audit for 250/250 route coverage and 35/35 catalog integrity.
