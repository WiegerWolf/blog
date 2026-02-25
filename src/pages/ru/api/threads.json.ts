import { sortFeedItemsDesc, toThreadFeedItem, type ThreadModule } from "../../../lib/threadFeed";

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export async function GET(context: { url: URL }) {
  const modules = Object.values(import.meta.glob("../blog/*.md", { eager: true })) as ThreadModule[];
  const items = sortFeedItemsDesc(modules.map((module) => toThreadFeedItem(module, "ru")));

  const offset = parsePositiveInt(context.url.searchParams.get("offset"), 0);
  const limit = Math.min(parsePositiveInt(context.url.searchParams.get("limit"), 12), 24);
  const sliced = items.slice(offset, offset + limit);
  const nextOffset = offset + sliced.length;
  const hasMore = nextOffset < items.length;

  return new Response(
    JSON.stringify({
      items: sliced,
      hasMore,
      nextOffset
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60"
      }
    }
  );
}
