// @high-signal/shared — public barrel.
// Source is grouped by product domain under src/<domain>/; this file re-exports
// every domain so existing `@high-signal/shared` imports keep working unchanged.
// Layering (acyclic): primitives <- core <- {nlp, markets} ...

export * from './primitives';
export * from './core';
export * from './nlp';
export * from './markets';
export * from './traffic';
