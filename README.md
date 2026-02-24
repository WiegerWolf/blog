# Tsatsin

Tech explorations exported from Telegram to the web.

## Run locally

```bash
bun install
bun run dev
```

## Write a post

English posts live in `src/pages/en/blog/`.

```md
---
layout: ../../../layouts/PostLayout.astro
title: "Thread Title"
description: "Auto-generated from first sentence."
pubDate: 2026-02-24
lang: en
messageCount: 37
---

Your content here.
```

Russian posts live in `src/pages/ru/blog/`:

```md
---
layout: ../../../layouts/PostLayout.astro
title: "Заголовок треда"
description: "Автогенерация из первого предложения."
pubDate: 2026-02-24
lang: ru
messageCount: 37
---

Ваш текст.
```

`messageCount` shows how many messages in the thread.

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

## Language routes and feeds

- English: `/en/`
- Russian: `/ru/`
- All posts RSS: `/rss.xml`
- English RSS: `/en/rss.xml`
- Russian RSS: `/ru/rss.xml`

## Telegram publisher bot (Telegram → PR)

Private bot that forwards thread messages into PRs.

Flow:

1. Write in Telegram Saved Messages.
2. Forward the full thread to your bot (text + photos in order).
3. Send `/publish` to the bot.
4. Bot creates a branch and opens a PR to `main`.

Behavior:

- Keeps forwarded message order.
- Detects language automatically (`en` or `ru`).
- Infers title, description, and slug.
- Saves media to `public/images/<slug>/`.
- Writes post file to `src/pages/en/blog/` or `src/pages/ru/blog/`.
- Adds up to 4 `previewImages` for thread cards.
- Preserves Telegram formatting (italic, bold, code, links, code blocks).

Supported bot commands:

- `/start` - usage help
- `/status` - current draft counts
- `/publish` - publish draft as PR
- `/reset` - clear draft buffer

Auto-finalize:

- If `AUTO_FINALIZE_MINUTES` is greater than `0`, draft auto-publishes after inactivity timeout.
- Retry delay after failures is controlled by `AUTO_FINALIZE_RETRY_MINUTES`.

Startup self-checks:

- Validates Telegram bot token (`getMe`).
- Validates GitHub repo access + base branch.
- Checks token permissions where available (`pull` + `push`).
- Verifies working tree is clean before bot starts.

### Run bot locally

```bash
cp .env.publisher.example .env.publisher
bun run tg:bot
```

Required environment variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OWNER_ID`
- `GITHUB_TOKEN`
- `GITHUB_REPO` (example: `WiegerWolf/blog`)

Optional variables:

- `PUBLISH_REPO_DIR` (default: `/repo`)
- `BOT_DATA_DIR` (default: `/data`)
- `POST_BASE_BRANCH` (default: `main`)
- `POLL_TIMEOUT_SECONDS` (default: `50`)
- `AUTO_FINALIZE_MINUTES` (default: `0` = disabled)
- `AUTO_FINALIZE_RETRY_MINUTES` (default: `30`)

### Run bot on home server (Docker)

```bash
cp .env.publisher.example .env.publisher
docker compose -f docker-compose.publisher.yml up -d --build
```

The compose file mounts:

- repo at `/repo` (for git branch/commit/push)
- persistent state at `./publisher-data` (draft buffer + update offset)

## Deploy

1. Push this repository to GitHub.
2. In GitHub repo settings, set **Pages** source to **GitHub Actions**.
3. Push to `main` and the workflow in `.github/workflows/deploy.yml` will publish the site.

This project uses Bun for local development and CI builds.

Custom domain is set by `public/CNAME`:

`blog.tsatsin.com`
