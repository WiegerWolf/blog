function normalize(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function getFeedTitle(title: string, description: string): string {
  const source = normalize(title) || normalize(description);
  if (!source) {
    return "Thread";
  }

  const sentence = source.split(/(?<=[.!?…])\s+/)[0] ?? source;
  return sentence;
}
