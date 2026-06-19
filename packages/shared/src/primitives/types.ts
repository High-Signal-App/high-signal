// Core cross-cutting types used across every domain. No dependencies.

export type Direction = "up" | "down" | "neutral";
export type Confidence = "low" | "medium" | "high";
export type ReviewStatus = "draft" | "published" | "corrected" | "killed";
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
