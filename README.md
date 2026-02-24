# Tsatsin Blog

A simple and modern blog built with Astro and deployed to GitHub Pages.

## Run locally

```bash
npm install
npm run dev
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

## Deploy

1. Push this repository to GitHub.
2. In GitHub repo settings, set **Pages** source to **GitHub Actions**.
3. Push to `main` and the workflow in `.github/workflows/deploy.yml` will publish the site.

Custom domain is set by `public/CNAME`:

`blog.tsatsin.com`
