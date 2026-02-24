function normalizeForCompare(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

export function getIndexExcerpt(title: string, description: string): string | null {
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();

  if (!cleanDescription) {
    return null;
  }

  const titleKey = normalizeForCompare(cleanTitle);
  const descriptionKey = normalizeForCompare(cleanDescription);

  if (!titleKey || !descriptionKey) {
    return cleanDescription;
  }

  if (descriptionKey.startsWith(titleKey) || titleKey.startsWith(descriptionKey)) {
    return null;
  }

  return cleanDescription;
}
