// @high-signal/shared — public barrel.
// Source is grouped by product domain under src/<domain>/; this file re-exports
// every domain so existing `@high-signal/shared` imports keep working unchanged.
// Layering (acyclic): primitives <- core <- {nlp, ideas, content} <- {markets, personal} ...

export * from "./primitives";
export * from "./core";
export * from "./nlp";
export * from "./ideas";
export * from "./markets";
export * from "./mentions";
export * from "./agent-eval";
export * from "./personal";
export * from "./watchlist";
export * from "./content";
