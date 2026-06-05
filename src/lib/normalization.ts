const TOKEN_STOP_WORDS = new Set([
  "ORDER",
  "BOOKING",
  "PAYMENT",
  "PAYMENTS",
  "ONLINE",
  "INDIA",
  "COM",
  "PVT",
  "LTD",
  "PRIVATE",
  "LIMITED",
  "INTERNET",
  "TECHNOLOGIES",
  "TECHNOLOGY",
  "AIRLINES",
  "EXPRESS",
  "SERVICES",
  "SERVICE",
  "ROASTERS",
]);

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeEntity(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean);
}

export function informativeTokens(value: string): string[] {
  return tokenizeEntity(value).filter((token) => !TOKEN_STOP_WORDS.has(token));
}

export function canonicalizeMerchant(value: string): string {
  const tokens = informativeTokens(value);
  if (tokens.length === 0) {
    return normalizeText(value);
  }

  return tokens.slice(0, Math.min(2, tokens.length)).join(" ");
}

export function canonicalizeFundName(value: string): string {
  const tokens = informativeTokens(value);
  return tokens.join(" ");
}

export function normalizeCategory(value: string | undefined | null): string {
  return (value ?? "uncategorized").trim().toLowerCase();
}
