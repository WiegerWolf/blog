import rss from "@astrojs/rss";

export async function GET(context) {
  const postModules = Object.values(import.meta.glob("./blog/*.md", { eager: true }));

  const posts = postModules
    .map((post) => ({
      title: post.frontmatter.title,
      description: post.frontmatter.description,
      pubDate: new Date(post.frontmatter.pubDate),
      link: post.url
    }))
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: "Tsatsin Blog (EN)",
    description: "English notes on engineering and product building.",
    site: context.site,
    items: posts
  });
}
