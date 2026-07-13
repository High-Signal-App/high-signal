## 1. Mentions terminology

- [x] 1.1 Rename the existing `/mentions` configuration copy from category/query language to topic/prompt language.

## 2. Cited-source freshness

- [x] 2.1 Extract cited-source rebuilding into one helper shared by the manual endpoint and post-check workflow.
- [x] 2.2 Run cited-source and intent-opportunity refreshes independently after each mention check and log isolated failures.

## 3. Report token authorization

- [x] 3.1 Add and test a deterministic brand-scoped HMAC report token helper.
- [x] 3.2 Add owner-gated report token generation and owner-or-token report authorization with fail-closed secret handling.

## 4. Verification and documentation

- [x] 4.1 Extend focused OpenLens tests to cover terminology, refresh wiring, and token scoping.
- [x] 4.2 Run the OpenLens test, affected workspace typechecks, OpenSpec validation, and diff checks.
- [x] 4.3 Update plan 0011 and `PROJECT_STATUS.md` to record the local-code follow-ups as implemented while leaving migration/production work pending.
