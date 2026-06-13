#!/usr/bin/env tsx
/**
 * Unit tests for plan 0010 impact-chain composer + suppression rules.
 *
 * Run: `pnpm watchlist-impact:test`
 */

import {
  composeImpactChain,
  isSuppressed,
  type ComposeArgs,
  type RelationshipEdge,
  type SignalForWatch,
  type SuppressionRule,
} from "@high-signal/shared";

let failures = 0;
let total = 0;
function checkEq<T>(label: string, actual: T, expected: T) {
  total++;
  if (actual === expected) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);
const yesterday = new Date(NOW - 24 * 3600 * 1000).toISOString();
const lastWeek = new Date(NOW - 6 * 24 * 3600 * 1000).toISOString();

function sig(id: string, primary: string, confidence: SignalForWatch["confidence"] = "medium", publishedAt = yesterday, signalType = "supply_chain"): SignalForWatch {
  return { id, slug: id, signalType, primaryEntityId: primary, confidence, publishedAt };
}

function edge(from: string, to: string, type: RelationshipEdge["type"] = "supplier", verified = true, weight = 1.0): RelationshipEdge {
  return { fromEntityId: from, toEntityId: to, type, weight, verified };
}

console.log("composeImpactChain — direct items");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [sig("s1", "NVDA", "high")],
    edges: [],
    secondOrderSignals: [],
    suppressions: [],
    alreadySurfacedSignalIds: new Set(),
    nowMs: NOW,
  };
  const out = composeImpactChain(args);
  checkEq("count", out.length, 1);
  checkEq("kind direct", out[0]!.deltaKind, "direct");
  checkEq("subject = watched", out[0]!.subjectEntityId, "NVDA");
  checkEq("observed true for direct", out[0]!.observed, true);
}

console.log("\ncomposeImpactChain — already surfaced is dropped");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [sig("s1", "NVDA")],
    edges: [],
    secondOrderSignals: [],
    suppressions: [],
    alreadySurfacedSignalIds: new Set(["s1"]),
    nowMs: NOW,
  };
  checkEq("filtered out", composeImpactChain(args).length, 0);
}

console.log("\ncomposeImpactChain — second-order via observed supplier edge");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [],
    edges: [edge("NVDA", "TSMC", "supplier", true)],
    secondOrderSignals: [sig("s2", "TSMC", "medium")],
    suppressions: [],
    alreadySurfacedSignalIds: new Set(),
    nowMs: NOW,
  };
  const out = composeImpactChain(args);
  checkEq("count", out.length, 1);
  checkEq("kind second_order", out[0]!.deltaKind, "second_order");
  checkEq("observed true", out[0]!.observed, true);
  checkEq("subject = TSMC", out[0]!.subjectEntityId, "TSMC");
  checkEq("watched = NVDA", out[0]!.watchedEntityId, "NVDA");
}

console.log("\ncomposeImpactChain — inferred edge labelled");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [],
    edges: [edge("NVDA", "TSMC", "supplier", false)],
    secondOrderSignals: [sig("s3", "TSMC")],
    suppressions: [],
    alreadySurfacedSignalIds: new Set(),
    nowMs: NOW,
  };
  const out = composeImpactChain(args);
  checkEq("inferred label", out[0]!.observed, false);
  checkEq("why mentions inferred", out[0]!.why.includes("inferred"), true);
}

console.log("\ncomposeImpactChain — direct outranks second-order by priority");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [sig("d", "NVDA", "high", yesterday)],
    edges: [edge("NVDA", "TSMC", "supplier", true)],
    secondOrderSignals: [sig("s", "TSMC", "high", yesterday)],
    suppressions: [],
    alreadySurfacedSignalIds: new Set(),
    nowMs: NOW,
  };
  const out = composeImpactChain(args);
  checkEq("direct first", out[0]!.deltaKind, "direct");
}

console.log("\ncomposeImpactChain — recency lowers older items");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [
      sig("recent", "NVDA", "medium", yesterday),
      sig("old", "NVDA", "high", lastWeek),
    ],
    edges: [],
    secondOrderSignals: [],
    suppressions: [],
    alreadySurfacedSignalIds: new Set(),
    nowMs: NOW,
  };
  const out = composeImpactChain(args);
  checkEq("recent ranks first", out[0]!.signalId, "recent");
}

console.log("\nisSuppressed — signal_type rule");
{
  const rules: SuppressionRule[] = [{ kind: "signal_type", value: "noisy" }];
  const item = {
    signalType: "noisy",
    relationshipPath: [],
    deltaKind: "direct" as const,
    watchedEntityId: "x",
  };
  checkEq("matches", isSuppressed(item, rules), true);
  checkEq("misses", isSuppressed({ ...item, signalType: "other" }, rules), false);
}

console.log("\nisSuppressed — second_order_from gates by watched id");
{
  const rules: SuppressionRule[] = [{ kind: "second_order_from", value: "NVDA" }];
  checkEq(
    "matches second-order from NVDA",
    isSuppressed(
      { signalType: "x", relationshipPath: [], deltaKind: "second_order", watchedEntityId: "NVDA" },
      rules,
    ),
    true,
  );
  checkEq(
    "leaves direct alone",
    isSuppressed(
      { signalType: "x", relationshipPath: [], deltaKind: "direct", watchedEntityId: "NVDA" },
      rules,
    ),
    false,
  );
}

console.log("\ncomposeImpactChain end-to-end — suppression rule drops second-order");
{
  const args: ComposeArgs = {
    watchedEntityIds: ["NVDA"],
    directSignals: [sig("d", "NVDA")],
    edges: [edge("NVDA", "TSMC", "supplier", true)],
    secondOrderSignals: [sig("s", "TSMC")],
    suppressions: [{ kind: "second_order_from", value: "NVDA" }],
    alreadySurfacedSignalIds: new Set(),
    nowMs: NOW,
  };
  const out = composeImpactChain(args);
  checkEq("only direct survives", out.length, 1);
  checkEq("direct kept", out[0]!.deltaKind, "direct");
}

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}
console.log(`\nall ${total} ok`);
