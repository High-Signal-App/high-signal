#!/usr/bin/env tsx
/**
 * Unit tests for plan 0009 brief-delivery helpers.
 *
 * Run: `pnpm brief-delivery:test`
 */

import {
  isValidWindow,
  resolveOpenWindow,
  isKnownSkipReason,
  isAutomaticRetryEligible,
  nextRetryMinutes,
  nextRetryAtMs,
  shouldAutoDisable,
  briefSnapshotToEmailSections,
  briefSnapshotToCompactDigest,
  canRetryDelivery,
  createRssToken,
  unsubscribeToken,
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

console.log("isValidWindow");
checkEq("07:00 ok", isValidWindow("07:00"), true);
checkEq("23:59 ok", isValidWindow("23:59"), true);
checkEq("00:00 ok", isValidWindow("00:00"), true);
checkEq("24:00 invalid", isValidWindow("24:00"), false);
checkEq("7:00 (no pad) invalid", isValidWindow("7:00"), false);
checkEq("garbage invalid", isValidWindow("abc"), false);

console.log("\nresolveOpenWindow");
// 2026-06-12 06:30 UTC → 07:00 IST window (IST = UTC+5:30 → 12:00 local). 07:00 window closed.
const ist06_30 = Date.UTC(2026, 5, 12, 6, 30, 0);
const istOpen = resolveOpenWindow({ timezone: "Asia/Kolkata", localWindowStart: "07:00" }, ist06_30);
checkEq("IST window closed when local !=07:xx", istOpen, null);

// 2026-06-12 01:30 UTC → IST 07:00 → window OPEN
const ist01_30 = Date.UTC(2026, 5, 12, 1, 30, 0);
const istOpen2 = resolveOpenWindow({ timezone: "Asia/Kolkata", localWindowStart: "07:00" }, ist01_30);
checkEq("IST window open at local 07:00", istOpen2?.briefDate, "2026-06-12");

// 2026-06-12 02:30 UTC → IST 08:00 → window CLOSED (07:00-08:00 exclusive at 08:00)
const ist02_30 = Date.UTC(2026, 5, 12, 2, 30, 0);
const istClosed = resolveOpenWindow({ timezone: "Asia/Kolkata", localWindowStart: "07:00" }, ist02_30);
checkEq("IST window closed at local 08:00", istClosed, null);

// UTC 07:30 with localWindowStart 07:00 in UTC → open
const utc07 = Date.UTC(2026, 5, 12, 7, 30, 0);
checkEq(
  "UTC tz window open at 07:30",
  resolveOpenWindow({ timezone: "UTC", localWindowStart: "07:00" }, utc07)?.briefDate,
  "2026-06-12",
);

// Bad tz → null
checkEq(
  "bad timezone returns null",
  resolveOpenWindow({ timezone: "Not/Real", localWindowStart: "07:00" }, utc07),
  null,
);
// Bad window → null
checkEq(
  "bad window returns null",
  resolveOpenWindow({ timezone: "UTC", localWindowStart: "abc" }, utc07),
  null,
);

console.log("\nisKnownSkipReason");
checkEq("no_brief_today known", isKnownSkipReason("no_brief_today"), true);
checkEq("preference_disabled known", isKnownSkipReason("preference_disabled"), true);
checkEq("window_not_open known", isKnownSkipReason("window_not_open"), true);
checkEq("free-form rejected", isKnownSkipReason("oops"), false);

console.log("\nnextRetryMinutes backoff");
checkEq("attempt 1 → 15", nextRetryMinutes(1), 15);
checkEq("attempt 2 → 60", nextRetryMinutes(2), 60);
checkEq("attempt 3 → 240", nextRetryMinutes(3), 240);
checkEq("attempt 4 → null (terminal)", nextRetryMinutes(4), null);
checkEq("attempt 0 → 240 fallback", nextRetryMinutes(0), 240);

console.log("\ndurable automatic retry schedule");
const failedAt = Date.UTC(2026, 6, 13, 10, 0, 0);
checkEq("attempt 1 schedules +15m", nextRetryAtMs(1, failedAt), failedAt + 15 * 60_000);
checkEq("attempt 2 schedules +60m", nextRetryAtMs(2, failedAt), failedAt + 60 * 60_000);
checkEq("attempt 3 schedules +240m", nextRetryAtMs(3, failedAt), failedAt + 240 * 60_000);
checkEq("attempt 4 is terminal", nextRetryAtMs(4, failedAt), null);
checkEq(
  "future timestamp is not eligible",
  isAutomaticRetryEligible(1, failedAt + 15 * 60_000, failedAt + 14 * 60_000),
  false,
);
checkEq(
  "timestamp is eligible at boundary",
  isAutomaticRetryEligible(1, failedAt + 15 * 60_000, failedAt + 15 * 60_000),
  true,
);
checkEq("legacy null schedule is eligible below cap", isAutomaticRetryEligible(2, null, failedAt), true);
checkEq("terminal attempt is never eligible", isAutomaticRetryEligible(4, null, failedAt), false);

console.log("\nshouldAutoDisable");
checkEq("three failures disables", shouldAutoDisable(["failed", "failed", "failed"]), true);
checkEq("two failures + sent does not disable", shouldAutoDisable(["failed", "sent", "failed"]), false);
checkEq("two failures alone does not disable", shouldAutoDisable(["failed", "failed"]), false);
checkEq("empty does not disable", shouldAutoDisable([]), false);

console.log("\ncanRetryDelivery");
checkEq(
  "failed email can retry",
  canRetryDelivery({ channel: "email", status: "failed", attempt: 3 }),
  true,
);
checkEq(
  "sent email cannot retry",
  canRetryDelivery({ channel: "email", status: "sent", attempt: 1 }),
  false,
);
checkEq(
  "failed RSS cannot retry through email route",
  canRetryDelivery({ channel: "rss", status: "failed", attempt: 1 }),
  false,
);

console.log("\nbriefSnapshotToEmailSections");
checkEq("null snapshot → no sections", briefSnapshotToEmailSections(null).length, 0);
checkEq("empty snapshot → no sections", briefSnapshotToEmailSections({}).length, 0);

const fullSnapshot = {
  stocks: [
    {
      entityId: "e1",
      entityName: "Nvidia",
      ticker: "NVDA",
      direction: "up" as const,
      confidence: "high" as const,
      headline: "H200 supply loosening",
      signalType: "supply-demand",
      evidenceUrls: [
        { url: "https://a.example/1" },
        { url: "https://b.example/2" },
        { url: "https://c.example/3" },
      ] as Array<{ url: string }>,
      hitRate: 0.667,
      hitRateSample: 9,
      hitRateBand: "medium" as const,
    },
  ],
  ideas: [
    {
      title: "AI invoice triage",
      description: "SMBs drowning in AP",
      evidenceUrls: [{ url: "https://d.example/4" }] as Array<{ url: string }>,
      subreddit: "smallbusiness",
    },
  ],
  trends: [] as unknown[],
  perception: [
    {
      brandName: "Acme",
      mentionRate: 0.4,
      positiveShare: null,
      topIntent: {
        intentStage: "comparison",
        platform: "reddit",
        score: 88,
        actionType: "write_comparison",
        sourceTitle: "Acme versus Rival",
        sourceUrl: "https://reddit.com/r/tools/comments/intent-1",
      },
    },
  ],
  improvements: [
    {
      brandName: "Acme",
      area: "comparisons",
      task: "Publish a sourced comparison",
      priority: "high",
      sourceUrl: "https://reddit.com/r/tools/comments/intent-1",
      intent: {
        intentStage: "comparison",
        actionType: "write_comparison",
        score: 88,
      },
    },
  ],
};
// fixture matches the BriefSnapshot shape; cast through unknown for the test.
const secs = briefSnapshotToEmailSections(fullSnapshot as unknown as Parameters<typeof briefSnapshotToEmailSections>[0]);
checkEq("empty trends dropped → 4 sections", secs.length, 4);
checkEq("stocks section title", secs[0]?.title, "01 / stocks watching for a boom");
checkEq("hit-rate rounded to percent", secs[0]?.items[0]?.text.includes("hit-rate 67%"), true);
checkEq("citation links capped at 2", secs[0]?.items[0]?.links.length, 2);
checkEq("ideas subreddit rendered", secs[1]?.items[0]?.text.includes("(r/smallbusiness)"), true);
checkEq("perception null share → n/a", secs[2]?.items[0]?.text.includes("positive share n/a"), true);
checkEq("perception includes intent context", secs[2]?.items[0]?.text.includes("comparison intent on reddit (88/100)"), true);
checkEq("perception carries intent source", secs[2]?.items[0]?.links[0], "https://reddit.com/r/tools/comments/intent-1");
checkEq("improvement includes intent action", secs[3]?.items[0]?.text.includes("write comparison"), true);
checkEq("improvement carries source", secs[3]?.items[0]?.links[0], "https://reddit.com/r/tools/comments/intent-1");

console.log("\nbriefSnapshotToCompactDigest");
const compact = briefSnapshotToCompactDigest(
  fullSnapshot as unknown as Parameters<typeof briefSnapshotToCompactDigest>[0],
);
checkEq("compact schema is versioned", compact.schema, "high-signal.compact-digest.v1");
checkEq("compact sections preserve order", compact.sections.map((s) => s.id).join(","), "stocks,ideas,perception");
checkEq("compact evidence links preserved", compact.sections[0]?.items[0]?.evidenceUrls.length, 2);
checkEq("compact payload has no delivery identity", JSON.stringify(compact).includes("userId"), false);

async function main() {
  console.log("\ncreateRssToken");
  const rssA = createRssToken();
  const rssB = createRssToken();
  checkEq("RSS token is 256-bit hex", /^[0-9a-f]{64}$/.test(rssA), true);
  checkEq("RSS tokens are opaque and unique", rssA === rssB, false);

  console.log("\nunsubscribeToken");
  const tokA = await unsubscribeToken("secret-1", "user-123");
  const tokA2 = await unsubscribeToken("secret-1", "user-123");
  const tokB = await unsubscribeToken("secret-2", "user-123");
  const tokC = await unsubscribeToken("secret-1", "user-999");
  checkEq("deterministic for same secret+user", tokA, tokA2);
  checkEq("32 hex chars", /^[0-9a-f]{32}$/.test(tokA), true);
  checkEq("different secret → different token", tokA === tokB, false);
  checkEq("different user → different token", tokA === tokC, false);

  if (failures > 0) {
    console.error(`\n${failures}/${total} failed`);
    process.exit(1);
  }
  console.log(`\nall ${total} ok`);
}

main();
