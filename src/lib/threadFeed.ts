import { getFeedTitle } from "./postPreview";
import { buildThreadTags } from "./postTags";

export type ThreadLang = "en" | "ru";

export interface ThreadFrontmatter {
  title: string;
  description: string;
  pubDate: string | Date;
  lang?: ThreadLang;
  messageCount?: number;
  previewImages?: string[];
  previewVideos?: string[];
  youtubeVideoIds?: string[];
  singleMessageHtml?: string;
  tags?: string[];
}

export interface ThreadModule {
  frontmatter: ThreadFrontmatter;
  url: string;
}

export interface ThreadFeedItem {
  title: string;
  pubDateIso: string;
  pubDateMs: number;
  url: string;
  lang: ThreadLang;
  messageCount: number;
  previewImages: string[];
  previewVideos: string[];
  youtubeVideoIds: string[];
  singleMessageHtml: string;
  tags: string[];
  isQuickThread: boolean;
}

export function toThreadFeedItem(module: ThreadModule, defaultLang: ThreadLang): ThreadFeedItem {
  const pubDate = new Date(module.frontmatter.pubDate);
  const safeDate = Number.isNaN(pubDate.getTime()) ? new Date() : pubDate;
  const messageCount = module.frontmatter.messageCount ?? 0;
  const previewImages = (module.frontmatter.previewImages ?? []).slice(0, 4);
  const previewVideos = (module.frontmatter.previewVideos ?? []).slice(0, 2);
  const youtubeVideoIds = (module.frontmatter.youtubeVideoIds ?? []).slice(0, 2);
  const tags = buildThreadTags({
    defaultLang,
    url: module.url,
    title: module.frontmatter.title,
    description: module.frontmatter.description,
    lang: module.frontmatter.lang,
    messageCount,
    previewImages,
    previewVideos,
    youtubeVideoIds,
    singleMessageHtml: module.frontmatter.singleMessageHtml,
    tags: module.frontmatter.tags
  });

  return {
    title: getFeedTitle(module.frontmatter.title, module.frontmatter.description),
    pubDateIso: safeDate.toISOString(),
    pubDateMs: safeDate.getTime(),
    url: module.url,
    lang: module.frontmatter.lang ?? defaultLang,
    messageCount,
    previewImages,
    previewVideos,
    youtubeVideoIds,
    singleMessageHtml: (module.frontmatter.singleMessageHtml ?? "").trim(),
    tags,
    isQuickThread: messageCount === 1 && (previewImages.length === 1 || previewVideos.length === 1 || youtubeVideoIds.length > 0)
  };
}

export function sortFeedItemsDesc(items: ThreadFeedItem[]): ThreadFeedItem[] {
  return [...items].sort((a, b) => b.pubDateMs - a.pubDateMs);
}
