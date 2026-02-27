import rss from "@astrojs/rss";
import { buildThreadTags } from "../../lib/postTags";

export async function GET(context) {
  const postModules = Object.values(import.meta.glob("./blog/*.md", { eager: true }));

  const posts = postModules
    .map((post) => ({
      title: post.frontmatter.title,
      description: post.frontmatter.description,
      pubDate: new Date(post.frontmatter.pubDate),
      link: post.url,
      categories: buildThreadTags({
        defaultLang: "en",
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
    title: "Tsatsin Blog (EN)",
    description: "English notes on engineering and product building.",
    site: context.site,
    items: posts
  });
}
