export type Direction = "up" | "down" | "neutral";
export type Confidence = "low" | "medium" | "high";
export type ReviewStatus = "draft" | "published" | "corrected";
export type Outcome = "hit" | "miss" | "push" | "pending";

export type RelationshipType =
  | "supplier"
  | "customer"
  | "peer"
  | "subsidiary"
  | "partner"
  | "competitor";

export type EntityType = "public" | "private" | "sector" | "product";

export interface SignalCard {
  id: string;
  slug: string;
  signalType: string;
  primaryEntityId: string;
  direction: Direction;
  confidence: Confidence;
  predictedWindowDays: number;
  publishedAt: string;
  evidenceUrls: string[];
  spilloverEntityIds: string[];
  bodyMd: string;
}

export * from "./mention-intelligence";
export * from "./product-contracts";
export * from "./idea-intelligence";
export * from "./market-watch";
export * from "./agent-evaluation";
export * from "./personal-usefulness";
export * from "./approved-task-teardowns";
export * from "./watchlist";
export * from "./signal-intelligence";
export * from "./lightweight-nlp";
export * from "./annotation-client";
