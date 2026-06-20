// ESLint is not currently wired up in this repo (eslint-config-next is
// incompatible with ESLint 10 — see apps/web's skipped lint script). This
// no-op config replaces the former @saas-maker/eslint-config import so the
// package dependency can be dropped. Reintroduce a real flat config here when
// the eslint-config-next / ESLint 10 compat issue is resolved.
export default [{ ignores: ["**/*"] }];
