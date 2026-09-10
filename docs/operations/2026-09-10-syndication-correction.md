---
title: September 10 syndication correction
description: Append-only receipt for withdrawing unsupported independent corroboration.
---

# September 10 syndication correction

The published signal `17b911e084eecb6d` counted a Mint republication of Bloomberg
as independent corroboration. The [Mint article](https://www.livemint.com/market/aidriven-ipo-wave-set-to-accompany-anthropic-listing-11788992244915.html)
credits Bloomberg as author and copyright holder. It is one originating report.

Using the existing Infisical-managed service identity under explicit owner
authorization, the normal admin correction endpoint created successor claim
`69118702fd6fab97` and marked parent `6dc6974e3f459550` corrected. The audit actor
is `codex-service (owner-authorized)`. The parent assertion and evidence remain
frozen in the claim history.

The successor contains the previously prepared correction, with Bloomberg as
primary evidence and Mint as context sharing the same originating evidence ID.
It remains **draft**; no independent corroboration was invented or published.
The original signal was marked corrected through the signal review endpoint.

Verification: all mutations returned 200; authenticated parent and successor
reads returned corrected and draft respectively. Fresh anonymous reads confirm
the corrected parent and the original signal absent from the September 10
signal list and daily brief. Existing anonymous claim caches can retain the old
status for up to the configured five-minute edge TTL; this does not rewrite
history. Full browser operator acceptance remains separate.

Independent evidence, valuation wording and any replacement publication remain
subject to the existing cite-or-kill gates. This receipt does not certify the
rest of the brief or close issue 133.
