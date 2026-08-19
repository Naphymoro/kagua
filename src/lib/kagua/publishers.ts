// Groups near-duplicate publisher names (e.g. "Elsevier BV", "Elsevier Ltd",
// "Elsevier Inc.") under one canonical bucket, so a publisher filter reflects
// the actual publishing group rather than every legal-entity variant of the
// same one. Shared between the DHET registry filter and the Journal
// Hunter's own "Publisher" limit so both use identical buckets.
export const KNOWN_PUBLISHERS = [
  "elsevier",
  "taylor and francis",
  "springer",
  "wiley",
  "sage",
  "mdpi",
  "ieee",
  "acs",
  "royal society of chemistry",
  "wolters kluwer",
  "oxford university press",
  "cambridge university press",
  "frontiers",
  "emerald",
  "de gruyter",
  "hindawi",
  "nature",
];

export function publisherGroup(name: string): string | null {
  const n = name.toLowerCase();
  for (const k of KNOWN_PUBLISHERS) if (n.includes(k)) return k === "taylor and francis" ? "taylor & francis" : k;
  return null;
}

export function publisherLabel(group: string): string {
  return group
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Acs$/, "ACS")
    .replace(/^Ieee$/, "IEEE")
    .replace(/^Mdpi$/, "MDPI");
}

// For a <select> of filter options: the same 17 buckets above, but sorted
// alphabetically by label rather than by frequency (there's no "current
// result set" to rank by before a search has even run).
export const PUBLISHER_OPTIONS = [...new Set(KNOWN_PUBLISHERS.map((k) => (k === "taylor and francis" ? "taylor & francis" : k)))]
  .map((group) => ({ value: group, label: publisherLabel(group) }))
  .sort((a, b) => a.label.localeCompare(b.label));
