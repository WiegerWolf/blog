import type { ThreadLang } from "./threadFeed";

export interface SimilarPostInput {
  title: string;
  description: string;
  pubDate: string | Date;
  url: string;
  lang: ThreadLang;
  previewImage?: string;
}

export interface SimilarPostResult extends SimilarPostInput {
  score: number;
}

const EN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your"
]);

function normalizePath(path: string): string {
  const base = path.split("#")[0]?.split("?")[0] ?? path;
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  if (withLeadingSlash === "/") {
    return withLeadingSlash;
  }
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function toTimestamp(value: string | Date): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }
  return parsed.getTime();
}

function buildTokenMap(title: string, description: string, lang: ThreadLang): Map<string, number> {
  const text = `${title} ${description}`.toLowerCase();
  const tokens = text
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  const tokenMap = new Map<string, number>();
  for (const token of tokens) {
    if (lang === "en" && EN_STOPWORDS.has(token)) {
      continue;
    }
    tokenMap.set(token, (tokenMap.get(token) ?? 0) + 1);
  }

  return tokenMap;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;

  for (const value of a.values()) {
    aMagnitude += value * value;
  }

  for (const value of b.values()) {
    bMagnitude += value * value;
  }

  for (const [token, value] of a) {
    const right = b.get(token);
    if (right) {
      dot += value * right;
    }
  }

  const denominator = Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude);
  if (denominator === 0) {
    return 0;
  }

  return dot / denominator;
}

function recencyScore(currentDateMs: number, candidateDateMs: number): number {
  if (currentDateMs === 0 || candidateDateMs === 0) {
    return 0;
  }

  const dayMs = 1000 * 60 * 60 * 24;
  const distanceInDays = Math.abs(currentDateMs - candidateDateMs) / dayMs;
  return 1 / (1 + distanceInDays / 45);
}

export function rankSimilarPosts(
  current: SimilarPostInput,
  candidates: SimilarPostInput[],
  limit = 3
): SimilarPostResult[] {
  const currentUrl = normalizePath(current.url);
  const currentDateMs = toTimestamp(current.pubDate);
  const currentTokens = buildTokenMap(current.title, current.description, current.lang);

  const scored: SimilarPostResult[] = [];

  for (const candidate of candidates) {
    if (candidate.lang !== current.lang) {
      continue;
    }

    if (normalizePath(candidate.url) === currentUrl) {
      continue;
    }

    const candidateTokens = buildTokenMap(candidate.title, candidate.description, candidate.lang);
    const lexical = cosineSimilarity(currentTokens, candidateTokens);
    const candidateDateMs = toTimestamp(candidate.pubDate);
    const temporal = recencyScore(currentDateMs, candidateDateMs);
    const score = lexical * 0.88 + temporal * 0.12;

    scored.push({ ...candidate, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return toTimestamp(b.pubDate) - toTimestamp(a.pubDate);
  });

  return scored.slice(0, Math.max(0, limit));
}
