import type { ThreadFeedItem } from "./threadFeed";

export interface TagBucket {
  tag: string;
  count: number;
  posts: ThreadFeedItem[];
}

export function buildTagBuckets(items: ThreadFeedItem[]): TagBucket[] {
  const map = new Map<string, ThreadFeedItem[]>();

  for (const item of items) {
    for (const tag of item.tags) {
      const key = tag.trim();
      if (!key) {
        continue;
      }

      const existing = map.get(key);
      if (existing) {
        existing.push(item);
      } else {
        map.set(key, [item]);
      }
    }
  }

  return [...map.entries()]
    .map(([tag, posts]) => ({
      tag,
      count: posts.length,
      posts
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.tag.localeCompare(right.tag);
    });
}
