import { describe, expect, it, vi } from "vitest";
import app from "../index";
import {
  buildPatterns,
  matchEntity,
  termsFor,
  type GazetteerEntity,
} from "../lib/gazetteer";

const fetcher = app as unknown as {
  fetch(req: Request, env?: Record<string, unknown>): Promise<Response>;
};


// ─── pure helpers ─────────────────────────────────────────────────────────

describe("termsFor", () => {
  it("collects name + ticker + aliases, lowercased + min-length", () => {
    const t = termsFor({
      id: "NVDA",
      name: "NVIDIA Corporation",
      ticker: "NVDA",
      metadata: JSON.stringify({ aliases: ["Nvidia", "Nvidia Corp", "AI"] }),
    });
    expect(t).toContain("nvidia corporation");
    expect(t).toContain("nvda");
    expect(t).toContain("nvidia");
    expect(t).toContain("nvidia corp");
    expect(t).not.toContain("ai"); // 2 chars — filtered
  });

  it("survives malformed metadata", () => {
    const t = termsFor({
      id: "X",
      name: "X Corp",
      ticker: "X",
      metadata: "not json",
    });
    expect(t).toContain("x corp");
    expect(t).not.toContain("x"); // 1 char — filtered
  });

  it("handles null name/ticker/metadata", () => {
    expect(termsFor({ id: "X", name: null, ticker: null, metadata: null })).toEqual([]);
  });
});


describe("matchEntity", () => {
  const entities: GazetteerEntity[] = [
    { id: "ASML", name: "ASML Holding", ticker: "ASML", metadata: null },
    { id: "NVDA", name: "NVIDIA Corporation", ticker: "NVDA", metadata: null },
    { id: "AMD", name: "Advanced Micro Devices", ticker: "AMD", metadata: null },
  ];
  const patterns = buildPatterns(entities);

  it("matches $-prefixed ticker (the original bug)", () => {
    expect(matchEntity("Will $ASML reach $1700?", patterns)).toBe("ASML");
  });

  it("matches bare ticker with trailing punctuation", () => {
    expect(matchEntity("NVDA, posting record numbers.", patterns)).toBe("NVDA");
    expect(matchEntity("AMD: guidance raised.", patterns)).toBe("AMD");
  });

  it("does not match substrings inside other words", () => {
    expect(matchEntity("Some NVDAX or MASML word", patterns)).toBeNull();
  });

  it("matches full company name in prose", () => {
    expect(matchEntity("NVIDIA Corporation announces today...", patterns)).toBe("NVDA");
  });

  it("returns alphabetically-first when multiple match", () => {
    // ASML, AMD, NVDA all present — alphabetical first = AMD
    expect(matchEntity("$AMD vs $NVDA vs $ASML race", patterns)).toBe("AMD");
  });

  it("returns null on empty text", () => {
    expect(matchEntity("", patterns)).toBeNull();
  });
});


// ─── /admin/backfill-entities ─────────────────────────────────────────────

function mockDb(opts: { entities?: unknown[]; events?: unknown[] }) {
  const batched: unknown[] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const isSelectEntities = sql.includes("FROM entities");
      const isSelectEvents = sql.includes("FROM events");
      const isUpdate = sql.startsWith("UPDATE events");
      const bindArgs: unknown[] = [];
      const stmt: {
        bind: (...args: unknown[]) => typeof stmt;
        all: () => Promise<{ results: unknown[] }>;
        run: () => Promise<{ success: boolean }>;
        _sql: string;
        _args: unknown[];
      } = {
        _sql: sql,
        _args: bindArgs,
        bind: (...args: unknown[]) => {
          bindArgs.push(...args);
          return stmt;
        },
        all: async () => ({
          results: isSelectEntities
            ? opts.entities ?? []
            : isSelectEvents
              ? opts.events ?? []
              : [],
        }),
        run: async () => ({ success: true }),
      };
      if (isUpdate) batched.push(stmt);
      return stmt;
    }),
    batch: vi.fn(async (stmts: Array<{ _args: unknown[] }>) => {
      batched.push(...stmts);
      return [{ success: true }];
    }),
    _batched: batched,
  };
  return db;
}

function envWithDb(db: ReturnType<typeof mockDb>, adminToken = "secret") {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: "test",
    ADMIN_TOKEN: adminToken,
  };
}

describe("POST /admin/backfill-entities", () => {
  it("requires admin bearer token (401 without)", async () => {
    const db = mockDb({});
    const res = await fetcher.fetch(
      new Request("http://t/admin/backfill-entities", { method: "POST" }),
      envWithDb(db),
    );
    expect(res.status).toBe(401);
  });

  it("503 when ADMIN_TOKEN env var is unset", async () => {
    const db = mockDb({});
    const res = await fetcher.fetch(
      new Request("http://t/admin/backfill-entities", { method: "POST" }),
      envWithDb(db, ""),
    );
    expect(res.status).toBe(503);
  });

  it("dry_run=1 matches without writing", async () => {
    const db = mockDb({
      entities: [{ id: "ASML", name: "ASML Holding", ticker: "ASML", metadata: null }],
      events: [
        { id: "e1", title: "Will $ASML reach $1700?", content: null },
        { id: "e2", title: "random other text", content: null },
      ],
    });
    const res = await fetcher.fetch(
      new Request("http://t/admin/backfill-entities?dry_run=1", {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
      }),
      envWithDb(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matched: number;
      stillNull: number;
      dryRun: boolean;
    };
    expect(body.matched).toBe(1);
    expect(body.stillNull).toBe(1);
    expect(body.dryRun).toBe(true);
    // No batch called in dry-run mode
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("writes updates when dry_run is off", async () => {
    const db = mockDb({
      entities: [{ id: "NVDA", name: "NVIDIA", ticker: "NVDA", metadata: null }],
      events: [
        { id: "e1", title: "$NVDA crushed Q3", content: null },
        { id: "e2", title: "$NVDA Q4 guidance", content: null },
      ],
    });
    const res = await fetcher.fetch(
      new Request("http://t/admin/backfill-entities", {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
      }),
      envWithDb(db),
    );
    const body = (await res.json()) as { matched: number; dryRun: boolean };
    expect(body.matched).toBe(2);
    expect(body.dryRun).toBe(false);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });
});
