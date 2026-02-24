import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Lang = "en" | "ru";

interface TelegramUser {
  id: number;
}

interface TelegramChat {
  id: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  mime_type?: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
}

interface TelegramFile {
  file_path: string;
}

interface DraftItem {
  messageId: number;
  kind: "text" | "photo";
  text?: string;
  caption?: string;
  fileId?: string;
  sourceDate: number;
}

interface DraftState {
  items: DraftItem[];
  createdAt: string;
  updatedAt: string;
}

interface PublisherState {
  lastUpdateId: number;
  drafts: Record<string, DraftState>;
}

interface PublishResult {
  postPath: string;
  mediaPaths: string[];
  slug: string;
  lang: Lang;
  title: string;
  description: string;
}

const config = {
  telegramToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  ownerId: Number(requiredEnv("TELEGRAM_OWNER_ID")),
  githubToken: requiredEnv("GITHUB_TOKEN"),
  githubRepo: requiredEnv("GITHUB_REPO"),
  repoDir: process.env.PUBLISH_REPO_DIR ?? "/repo",
  dataDir: process.env.BOT_DATA_DIR ?? "/data",
  baseBranch: process.env.POST_BASE_BRANCH ?? "main",
  pollTimeoutSeconds: Number(process.env.POLL_TIMEOUT_SECONDS ?? "50")
};

if (!Number.isFinite(config.ownerId)) {
  throw new Error("TELEGRAM_OWNER_ID must be a number");
}

const stateFilePath = path.join(config.dataDir, "publisher-state.json");

async function main() {
  await mkdir(config.dataDir, { recursive: true });
  await assertGitRepository(config.repoDir);
  const state = await loadState();

  console.log("Telegram publisher bot started");

  while (true) {
    try {
      const updates = await fetchUpdates(state.lastUpdateId + 1, config.pollTimeoutSeconds);
      for (const update of updates) {
        state.lastUpdateId = update.update_id;
        await handleUpdate(update, state);
      }
      await saveState(state);
    } catch (error) {
      console.error("Polling loop error:", error);
      await sleep(2000);
    }
  }
}

async function handleUpdate(update: TelegramUpdate, state: PublisherState) {
  const message = update.message;
  if (!message || !message.from) {
    return;
  }

  if (message.from.id !== config.ownerId) {
    await sendMessage(message.chat.id, "This bot is private.");
    return;
  }

  const incomingText = message.text?.trim();
  if (incomingText?.startsWith("/")) {
    await handleCommand(message, incomingText, state);
    return;
  }

  const item = extractDraftItem(message);
  if (!item) {
    return;
  }

  const chatIdKey = String(message.chat.id);
  const draft = state.drafts[chatIdKey] ?? {
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const alreadyExists = draft.items.some((entry) => entry.messageId === item.messageId);
  if (alreadyExists) {
    return;
  }

  draft.items.push(item);
  draft.updatedAt = new Date().toISOString();
  state.drafts[chatIdKey] = draft;

  if (draft.items.length === 1) {
    await sendMessage(message.chat.id, "Draft started. Forward your story and run /publish when ready.");
  }
}

async function handleCommand(message: TelegramMessage, commandText: string, state: PublisherState) {
  const chatId = message.chat.id;
  const [rawCommand, ...args] = commandText.split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();
  const chatIdKey = String(chatId);
  const draft = state.drafts[chatIdKey];

  if (command === "/start") {
    await sendMessage(
      chatId,
      [
        "Forward messages from Saved Messages to build a draft.",
        "Use /status to inspect current draft.",
        "Use /publish to open a PR.",
        "Use /reset to clear draft."
      ].join("\n")
    );
    return;
  }

  if (command === "/status") {
    if (!draft || draft.items.length === 0) {
      await sendMessage(chatId, "Draft is empty.");
      return;
    }

    const textCount = draft.items.filter((item) => item.kind === "text").length;
    const photoCount = draft.items.filter((item) => item.kind === "photo").length;
    await sendMessage(
      chatId,
      `Draft messages: ${draft.items.length}\nText blocks: ${textCount}\nPhotos: ${photoCount}\nStarted: ${draft.createdAt}`
    );
    return;
  }

  if (command === "/reset") {
    delete state.drafts[chatIdKey];
    await sendMessage(chatId, "Draft cleared.");
    return;
  }

  if (command === "/publish") {
    if (!draft || draft.items.length === 0) {
      await sendMessage(chatId, "Nothing to publish. Forward messages first.");
      return;
    }

    const overrideLang = args[0] === "ru" || args[0] === "en" ? (args[0] as Lang) : undefined;

    await sendMessage(chatId, "Publishing draft... this can take a moment.");
    try {
      await assertCleanWorkingTree();
      const publishResult = await buildPostFromDraft(draft, overrideLang);
      const pullRequestUrl = await commitAndOpenPr(publishResult);
      delete state.drafts[chatIdKey];

      await sendMessage(
        chatId,
        [
          `PR created: ${pullRequestUrl}`,
          `Language: ${publishResult.lang}`,
          `Slug: ${publishResult.slug}`,
          `Title: ${publishResult.title}`
        ].join("\n")
      );
    } catch (error) {
      console.error("Publish failed:", error);
      const messageText = error instanceof Error ? error.message : "Unknown publish error";
      await sendMessage(chatId, `Publish failed: ${messageText}`);
    }
    return;
  }

  await sendMessage(chatId, "Unknown command. Use /start for help.");
}

function extractDraftItem(message: TelegramMessage): DraftItem | null {
  const base = {
    messageId: message.message_id,
    sourceDate: message.date
  };

  if (message.photo && message.photo.length > 0) {
    const largest = [...message.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
    return {
      ...base,
      kind: "photo",
      fileId: largest.file_id,
      caption: normalizeText(message.caption ?? "") || undefined
    };
  }

  if (message.document?.mime_type?.startsWith("image/")) {
    return {
      ...base,
      kind: "photo",
      fileId: message.document.file_id,
      caption: normalizeText(message.caption ?? "") || undefined
    };
  }

  const text = normalizeText(message.text ?? "");
  if (text) {
    return {
      ...base,
      kind: "text",
      text
    };
  }

  return null;
}

async function buildPostFromDraft(draft: DraftState, overrideLang?: Lang): Promise<PublishResult> {
  const sortedItems = [...draft.items].sort((a, b) => a.messageId - b.messageId);
  const textual = sortedItems
    .flatMap((item) => [item.text, item.caption])
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .join("\n\n");

  const lang = overrideLang ?? detectLanguage(textual);
  const publicationDate = new Date();
  const title = inferTitle(textual, lang, publicationDate);
  const description = inferDescription(textual, lang);
  const slug = await createUniqueSlug(textual, publicationDate, lang);

  const blogDir = path.join(config.repoDir, "src", "pages", lang, "blog");
  const imagesDir = path.join(config.repoDir, "public", "images", slug);
  await mkdir(blogDir, { recursive: true });

  const bodyBlocks: string[] = [];
  const mediaPaths: string[] = [];
  let mediaIndex = 0;

  for (const item of sortedItems) {
    if (item.kind === "text" && item.text) {
      bodyBlocks.push(item.text);
      continue;
    }

    if (item.kind === "photo" && item.fileId) {
      mediaIndex += 1;
      await mkdir(imagesDir, { recursive: true });
      const saved = await downloadTelegramImage(item.fileId, imagesDir, mediaIndex);
      mediaPaths.push(saved.absolutePath);

      const altText = inferImageAlt(item.caption, mediaIndex, lang);
      if (item.caption && item.caption.trim()) {
        bodyBlocks.push(
          [
            "<figure>",
            `  <img src=\"${saved.publicPath}\" alt=\"${escapeHtmlAttr(altText)}\" />`,
            `  <figcaption>${escapeHtmlText(item.caption)}</figcaption>`,
            "</figure>"
          ].join("\n")
        );
      } else {
        bodyBlocks.push(`![${escapeMarkdownAlt(altText)}](${saved.publicPath})`);
      }
    }
  }

  const frontmatter = [
    "---",
    "layout: ../../../layouts/PostLayout.astro",
    `title: \"${escapeYamlString(title)}\"`,
    `description: \"${escapeYamlString(description)}\"`,
    `pubDate: ${publicationDate.toISOString().slice(0, 10)}`,
    `lang: ${lang}`,
    "---",
    ""
  ];

  const markdown = [...frontmatter, bodyBlocks.join("\n\n"), ""].join("\n");
  const postPath = path.join(blogDir, `${slug}.md`);
  await writeFile(postPath, markdown, "utf8");

  return {
    postPath,
    mediaPaths,
    slug,
    lang,
    title,
    description
  };
}

async function commitAndOpenPr(publish: PublishResult): Promise<string> {
  const branch = `bot/${publish.lang}-${publish.slug}-${Date.now()}`;
  const postRelative = toRepoRelativePath(publish.postPath);
  const mediaRelative = publish.mediaPaths.map(toRepoRelativePath);
  const pathsToStage = [postRelative, ...mediaRelative];

  await runGit(["fetch", "origin", config.baseBranch], { cwd: config.repoDir, allowFailure: false });
  await runGit(["checkout", config.baseBranch], { cwd: config.repoDir, allowFailure: false });
  await runGit(["pull", "--ff-only", "origin", config.baseBranch], { cwd: config.repoDir, allowFailure: false });
  await runGit(["checkout", "-b", branch], { cwd: config.repoDir, allowFailure: false });

  try {
    await runGit(["add", "--", ...pathsToStage], { cwd: config.repoDir, allowFailure: false });
    await runGit(
      [
        "-c",
        "user.name=Telegram Publisher Bot",
        "-c",
        "user.email=telegram-publisher-bot@users.noreply.github.com",
        "commit",
        "-m",
        `add ${publish.lang} story ${publish.slug}`
      ],
      {
        cwd: config.repoDir,
        allowFailure: false
      }
    );

    const pushUrl = `https://x-access-token:${config.githubToken}@github.com/${config.githubRepo}.git`;
    await runGit(["push", "--set-upstream", pushUrl, branch], {
      cwd: config.repoDir,
      allowFailure: false,
      redactToken: config.githubToken
    });

    const pullRequest = await githubRequest<{ html_url: string }>(
      `/repos/${config.githubRepo}/pulls`,
      "POST",
      {
        title: `Add ${publish.lang.toUpperCase()} story: ${publish.title}`,
        head: branch,
        base: config.baseBranch,
        body: [
          "## Summary",
          `- Adds one new ${publish.lang.toUpperCase()} story imported from Telegram`,
          `- Preserves message order and media sequencing`,
          `- Source file: \`${postRelative}\``
        ].join("\n")
      }
    );

    return pullRequest.html_url;
  } finally {
    await runGit(["checkout", config.baseBranch], { cwd: config.repoDir, allowFailure: true });
  }
}

async function fetchUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
  return telegramRequest<TelegramUpdate[]>("getUpdates", {
    offset,
    timeout: timeoutSeconds,
    allowed_updates: ["message"]
  });
}

async function sendMessage(chatId: number, text: string) {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

async function downloadTelegramImage(fileId: string, targetDir: string, index: number) {
  const telegramFile = await telegramRequest<TelegramFile>("getFile", {
    file_id: fileId
  });

  const ext = path.extname(telegramFile.file_path) || ".jpg";
  const filename = `${String(index).padStart(3, "0")}${ext.toLowerCase()}`;
  const absolutePath = path.join(targetDir, filename);

  const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${telegramFile.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram media: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(absolutePath, new Uint8Array(arrayBuffer));

  return {
    absolutePath,
    publicPath: `/images/${path.basename(targetDir)}/${filename}`
  };
}

async function telegramRequest<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram API ${method} returned ok=false`);
  }

  return data.result;
}

async function githubRequest<T>(endpoint: string, method: "POST" | "GET", body?: unknown): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

async function runGit(
  args: string[],
  options: { cwd: string; allowFailure: boolean; redactToken?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      env: process.env,
      maxBuffer: 1024 * 1024 * 16
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    const cast = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };

    if (options.allowFailure) {
      return {
        stdout: cast.stdout ?? "",
        stderr: cast.stderr ?? "",
        exitCode: cast.code ?? 1
      };
    }

    const stderr = options.redactToken
      ? (cast.stderr ?? "").replaceAll(options.redactToken, "[REDACTED]")
      : cast.stderr ?? "";

    throw new Error(`Git command failed: git ${args.join(" ")}\n${stderr}`);
  }
}

async function assertGitRepository(repoDir: string) {
  const probe = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: repoDir,
    allowFailure: true
  });
  if (probe.exitCode !== 0 || !probe.stdout.includes("true")) {
    throw new Error(`PUBLISH_REPO_DIR is not a git repository: ${repoDir}`);
  }
}

async function assertCleanWorkingTree() {
  const status = await runGit(["status", "--porcelain"], {
    cwd: config.repoDir,
    allowFailure: false
  });

  if (status.stdout.trim()) {
    throw new Error("Repository has pending changes. Commit or stash them before /publish.");
  }
}

async function loadState(): Promise<PublisherState> {
  try {
    const raw = await readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as PublisherState;
    return {
      lastUpdateId: Number(parsed.lastUpdateId ?? 0),
      drafts: parsed.drafts ?? {}
    };
  } catch {
    return {
      lastUpdateId: 0,
      drafts: {}
    };
  }
}

async function saveState(state: PublisherState) {
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function createUniqueSlug(textual: string, date: Date, lang: Lang): Promise<string> {
  const hash = createHash("sha256").update(textual || date.toISOString()).digest("hex").slice(0, 8);
  const datePart = date.toISOString().slice(0, 10);
  const candidate = `story-${lang}-${datePart}-${hash}`;

  const postPath = path.join(config.repoDir, "src", "pages", lang, "blog", `${candidate}.md`);
  try {
    await readFile(postPath);
    return `${candidate}-${Date.now().toString().slice(-4)}`;
  } catch {
    return candidate;
  }
}

function detectLanguage(input: string): Lang {
  const source = input || "";
  let cyrillicCount = 0;
  let latinCount = 0;

  for (const char of source) {
    if (/[A-Za-z]/.test(char)) {
      latinCount += 1;
    } else if (/[\u0400-\u04FF]/u.test(char)) {
      cyrillicCount += 1;
    }
  }

  if (cyrillicCount > latinCount) {
    return "ru";
  }

  return "en";
}

function inferTitle(input: string, lang: Lang, date: Date): string {
  const normalized = normalizeText(input);
  if (!normalized) {
    return lang === "ru" ? `Istoriya ${date.toISOString().slice(0, 10)}` : `Story ${date.toISOString().slice(0, 10)}`;
  }

  const firstLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 12);

  if (!firstLine) {
    return lang === "ru" ? `Istoriya ${date.toISOString().slice(0, 10)}` : `Story ${date.toISOString().slice(0, 10)}`;
  }

  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const clean = sentence.replace(/[#*_`>\[\]]/g, "").trim();
  if (clean.length < 8) {
    return lang === "ru" ? `Istoriya ${date.toISOString().slice(0, 10)}` : `Story ${date.toISOString().slice(0, 10)}`;
  }

  return truncate(clean, 72);
}

function inferDescription(input: string, lang: Lang): string {
  const normalized = normalizeText(input).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return lang === "ru"
      ? "Story imported from Telegram with ordered messages and media."
      : "Story imported from Telegram with ordered messages and media.";
  }

  return truncate(normalized, 155);
}

function inferImageAlt(caption: string | undefined, index: number, lang: Lang): string {
  const normalizedCaption = normalizeText(caption ?? "");
  if (normalizedCaption) {
    return truncate(normalizedCaption.replace(/\s+/g, " "), 90);
  }

  return lang === "ru" ? `Story image ${index}` : `Story image ${index}`;
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function escapeYamlString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeHtmlText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(input: string): string {
  return escapeHtmlText(input).replaceAll('"', "&quot;");
}

function escapeMarkdownAlt(input: string): string {
  return input.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function truncate(input: string, limit: number): string {
  if (input.length <= limit) {
    return input;
  }
  return `${input.slice(0, limit - 1).trimEnd()}…`;
}

function toRepoRelativePath(absolutePath: string): string {
  const relative = path.relative(config.repoDir, absolutePath);
  return relative.split(path.sep).join(path.posix.sep);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
