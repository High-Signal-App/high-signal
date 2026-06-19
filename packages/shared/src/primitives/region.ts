/**
 * Region rollups for the Daily Brief.
 *
 * Regions are coarse groupings of countries. Stored on the user as a
 * preference; applied at query time by mapping the region back to its
 * member country codes. "global" means no filter.
 */

export type Region =
  | "global"
  | "north-america"
  | "europe"
  | "south-asia"
  | "east-asia"
  | "southeast-asia"
  | "latam"
  | "mena"
  | "africa"
  | "oceania";

export const REGIONS: Region[] = [
  "global",
  "north-america",
  "europe",
  "south-asia",
  "east-asia",
  "southeast-asia",
  "latam",
  "mena",
  "africa",
  "oceania",
];

export interface RegionMeta {
  label: string;
  countries: string[];
}

/**
 * Coarse ISO-3166 alpha-2 mappings. The `country` column on `entities` uses
 * mixed conventions (alpha-2 + a few free-form strings); the worker query
 * also matches `country` case-insensitively.
 */
export const REGION_META: Record<Region, RegionMeta> = {
  "global": { label: "Global", countries: [] },
  "north-america": {
    label: "North America",
    countries: ["US", "CA", "MX"],
  },
  "europe": {
    label: "Europe",
    countries: [
      "GB", "DE", "FR", "NL", "ES", "IT", "SE", "CH", "IE", "PL",
      "BE", "DK", "FI", "NO", "AT", "PT", "CZ", "HU", "RO", "GR",
    ],
  },
  "south-asia": {
    label: "South Asia",
    countries: ["IN", "PK", "BD", "LK", "NP", "BT", "MV"],
  },
  "east-asia": {
    label: "East Asia",
    countries: ["CN", "JP", "KR", "TW", "HK", "MO", "MN"],
  },
  "southeast-asia": {
    label: "Southeast Asia",
    countries: ["SG", "MY", "TH", "ID", "VN", "PH", "MM", "KH", "LA", "BN"],
  },
  "latam": {
    label: "Latin America",
    countries: ["BR", "AR", "CL", "CO", "PE", "UY", "VE", "EC", "BO", "PY"],
  },
  "mena": {
    label: "Middle East & North Africa",
    countries: ["AE", "SA", "IL", "EG", "TR", "IR", "QA", "KW", "BH", "OM", "JO", "LB", "MA", "DZ", "TN"],
  },
  "africa": {
    label: "Africa (Sub-Saharan)",
    countries: ["NG", "ZA", "KE", "GH", "ET", "TZ", "UG", "RW", "SN", "CI"],
  },
  "oceania": {
    label: "Oceania",
    countries: ["AU", "NZ", "FJ", "PG"],
  },
};

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && REGIONS.includes(value as Region);
}

export function regionLabel(region: Region): string {
  return REGION_META[region].label;
}

/**
 * Countries to filter by for a given region. Empty array means "no filter"
 * (global). Callers should treat empty as "include everything".
 */
export function countriesForRegion(region: Region): string[] {
  return REGION_META[region].countries;
}
