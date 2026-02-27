import rss from "@astrojs/rss";
import { buildThreadTags } from "../lib/postTags";

export async function GET(context) {
  const postModules = [
    ...Object.values(import.meta.glob("./en/blog/*.md", { eager: true })),
    ...Object.values(import.meta.glob("./ru/blog/*.md", { eager: true }))
  ];

  const posts = postModules
    .map((post) => ({
      title: post.frontmatter.title,
      description: post.frontmatter.description,
      pubDate: new Date(post.frontmatter.pubDate),
      link: post.url,
      categories: buildThreadTags({
        defaultLang: post.url.startsWith("/ru/") ? "ru" : "en",
        url: post.url,
        title: post.frontmatter.title,
        description: post.frontmatter.description,
        lang: post.frontmatter.lang,
        messageCount: post.frontmatter.messageCount,
        previewImages: post.frontmatter.previewImages,
        previewVideos: post.frontmatter.previewVideos,
        youtubeVideoIds: post.frontmatter.youtubeVideoIds,
        singleMessageHtml: post.frontmatter.singleMessageHtml,
        tags: post.frontmatter.tags
      })
    }))
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: "Tsatsin Blog (All Languages)",
    description: "Bilingual notes on engineering and product building in English and Russian.",
    site: context.site,
    items: posts
  });
}
