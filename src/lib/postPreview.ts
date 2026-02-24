function normalize(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncate(input: string, limit: number): string {
  if (input.length <= limit) {
    return input;
  }

  return `${input.slice(0, limit - 1).trimEnd()}…`;
}

export function getFeedTitle(title: string, description: string): string {
  const source = normalize(title) || normalize(description);
  if (!source) {
    return "Thread";
  }

  const sentence = source.split(/(?<=[.!?…])\s+/)[0] ?? source;
  return truncate(sentence, 120);
}
