import type { ThreadFeedItem } from "./threadFeed";

export const FEED_PAGE_SIZE = 12;

export interface ThreadPagePayload {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
  items: ThreadFeedItem[];
}

export function getThreadPageCount(totalItems: number, pageSize = FEED_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function buildThreadPagePayload(
  items: ThreadFeedItem[],
  page: number,
  pageSize = FEED_PAGE_SIZE
): ThreadPagePayload | null {
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }

  const start = (page - 1) * pageSize;
  if (start >= items.length && !(items.length === 0 && page === 1)) {
    return null;
  }

  const sliced = items.slice(start, start + pageSize);
  const hasMore = start + sliced.length < items.length;

  return {
    page,
    pageSize,
    total: items.length,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    items: sliced
  };
}

export function jsonThreadPageResponse(payload: ThreadPagePayload): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
