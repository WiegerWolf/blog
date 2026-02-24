# Tsatsin Blog

A simple and modern blog built with Astro and deployed to GitHub Pages.

## Run locally

```bash
bun install
bun run dev
```

## Write a post

Create a new Markdown file in `src/pages/blog/`:

```md
---
layout: ../../layouts/PostLayout.astro
title: "My Post Title"
description: "Short summary shown on the homepage and in metadata."
pubDate: 2026-02-24
---

Your content here.
```

## Add images to posts

1. Put image files in `public/images/`.
2. Reference them from Markdown with an absolute path.

```md
![Screenshot of release dashboard](/images/release-dashboard.webp)
```

Optional caption:

```html
<figure>
  <img src="/images/release-dashboard.webp" alt="Screenshot of release dashboard" />
  <figcaption>Post release status from Friday deploy.</figcaption>
</figure>
```

## Deploy

1. Push this repository to GitHub.
2. In GitHub repo settings, set **Pages** source to **GitHub Actions**.
3. Push to `main` and the workflow in `.github/workflows/deploy.yml` will publish the site.

This project uses Bun for local development and CI builds.

Custom domain is set by `public/CNAME`:

`blog.tsatsin.com`
