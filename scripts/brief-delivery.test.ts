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
  nextRetryMinutes,
  shouldAutoDisable,
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
checkEq("attempt 3 → null (terminal)", nextRetryMinutes(3), null);
checkEq("attempt 0 → 240 fallback", nextRetryMinutes(0), 240);

console.log("\nshouldAutoDisable");
checkEq("three failures disables", shouldAutoDisable(["failed", "failed", "failed"]), true);
checkEq("two failures + sent does not disable", shouldAutoDisable(["failed", "sent", "failed"]), false);
checkEq("two failures alone does not disable", shouldAutoDisable(["failed", "failed"]), false);
checkEq("empty does not disable", shouldAutoDisable([]), false);

if (failures > 0) {
  console.error(`\n${failures}/${total} failed`);
  process.exit(1);
}
console.log(`\nall ${total} ok`);
