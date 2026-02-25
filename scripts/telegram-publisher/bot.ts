import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Lang = "en" | "ru";
type GitHubMergeMethod = "merge" | "squash" | "rebase";

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

interface TelegramForwardOrigin {
  date: number;
}

interface TelegramMessageEntity {
  type:
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "spoiler"
    | "code"
    | "pre"
    | "text_link"
    | "text_mention"
    | "url"
    | "email"
    | "phone_number"
    | "mention"
    | "hashtag"
    | "cashtag"
    | "bot_command"
    | "custom_emoji";
  offset: number;
  length: number;
  url?: string;
  language?: string;
  user?: TelegramUser;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  forward_origin?: TelegramForwardOrigin;
  forward_date?: number;
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
  textPlain?: string;
  caption?: string;
  captionPlain?: string;
  fileId?: string;
  sourceDate: number;
  originalDate: number;
  originalDateSource: "forward" | "received";
}

interface PendingPublishRequest {
  overrideLang?: Lang;
  detectedDate: string;
  createdAt: string;
}

interface DraftState {
  items: DraftItem[];
  createdAt: string;
  updatedAt: string;
  lastPublishAttemptAt?: string;
  lastPublishError?: string;
  pendingPublish?: PendingPublishRequest;
}

interface PublisherState {
  lastUpdateId: number;
  drafts: Record<string, DraftState>;
}

interface PublishResult {
  postPath: string;
  mediaPaths: string[];
  imageDirPath: string;
  slug: string;
  lang: Lang;
  title: string;
  description: string;
  messageCount: number;
}

interface GitHubRepoInfo {
  full_name: string;
  permissions?: {
    pull?: boolean;
    push?: boolean;
  };
}

interface CreatedPullRequest {
  number: number;
  html_url: string;
  head: {
    ref: string;
    sha: string;
  };
  state?: string;
}

interface GitHubPullDetails {
  number: number;
  html_url: string;
  state: string;
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  head: {
    ref: string;
    sha: string;
  };
}

interface GitHubCombinedStatus {
  state: string;
  total_count?: number;
  statuses?: Array<{
    state?: string;
    context?: string;
  }>;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
}

interface AutoMergeResult {
  merged: boolean;
  reason: string;
}

interface TelegramBotCommand {
  command: string;
  description: string;
}

const TELEGRAM_COMMANDS_DEFAULT: TelegramBotCommand[] = [
  { command: "start", description: "Show usage" },
  { command: "status", description: "Show current draft" },
  { command: "publish", description: "Publish draft as PR" },
  { command: "cancel", description: "Cancel pending publish" },
  { command: "reset", description: "Clear current draft" }
];

const TELEGRAM_COMMANDS_RU: TelegramBotCommand[] = [
  { command: "start", description: "Показать помощь" },
  { command: "status", description: "Показать текущий драфт" },
  { command: "publish", description: "Опубликовать драфт в PR" },
  { command: "cancel", description: "Отменить ожидание публикации" },
  { command: "reset", description: "Очистить текущий драфт" }
];

const config = {
  telegramToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
  ownerId: Number(requiredEnv("TELEGRAM_OWNER_ID")),
  githubToken: requiredEnv("GITHUB_TOKEN"),
  githubRepo: requiredEnv("GITHUB_REPO"),
  repoDir: process.env.PUBLISH_REPO_DIR ?? "/repo",
  dataDir: process.env.BOT_DATA_DIR ?? "/data",
  baseBranch: process.env.POST_BASE_BRANCH ?? "main",
  pollTimeoutSeconds: Number(process.env.POLL_TIMEOUT_SECONDS ?? "50"),
  autoFinalizeMinutes: Number(process.env.AUTO_FINALIZE_MINUTES ?? "0"),
  autoFinalizeRetryMinutes: Number(process.env.AUTO_FINALIZE_RETRY_MINUTES ?? "30"),
  autoMergeBotPrs: parseBooleanEnv(process.env.AUTO_MERGE_BOT_PRS, true),
  autoMergeWaitSeconds: Number(process.env.AUTO_MERGE_WAIT_SECONDS ?? "300"),
  autoMergePollSeconds: Number(process.env.AUTO_MERGE_POLL_SECONDS ?? "5"),
  autoMergeMethod: (process.env.AUTO_MERGE_METHOD ?? "squash").toLowerCase() as GitHubMergeMethod,
  publicSiteUrl: normalizeSiteBaseUrl(process.env.PUBLIC_SITE_URL ?? "")
};

if (!Number.isFinite(config.ownerId)) {
  throw new Error("TELEGRAM_OWNER_ID must be a number");
}

if (!Number.isFinite(config.pollTimeoutSeconds) || config.pollTimeoutSeconds <= 0) {
  throw new Error("POLL_TIMEOUT_SECONDS must be a positive number");
}

if (!Number.isFinite(config.autoFinalizeMinutes) || config.autoFinalizeMinutes < 0) {
  throw new Error("AUTO_FINALIZE_MINUTES must be a non-negative number");
}

if (!Number.isFinite(config.autoFinalizeRetryMinutes) || config.autoFinalizeRetryMinutes <= 0) {
  throw new Error("AUTO_FINALIZE_RETRY_MINUTES must be a positive number");
}

if (!Number.isFinite(config.autoMergeWaitSeconds) || config.autoMergeWaitSeconds <= 0) {
  throw new Error("AUTO_MERGE_WAIT_SECONDS must be a positive number");
}

if (!Number.isFinite(config.autoMergePollSeconds) || config.autoMergePollSeconds <= 0) {
  throw new Error("AUTO_MERGE_POLL_SECONDS must be a positive number");
}

if (!(["merge", "squash", "rebase"] as GitHubMergeMethod[]).includes(config.autoMergeMethod)) {
  throw new Error("AUTO_MERGE_METHOD must be one of: merge, squash, rebase");
}

const stateFilePath = path.join(config.dataDir, "publisher-state.json");

async function main() {
  await mkdir(config.dataDir, { recursive: true });
  await assertGitRepository(config.repoDir);
  await runStartupChecks();
  const state = await loadState();

  console.log("Telegram publisher bot started");

  while (true) {
    try {
      const updates = await fetchUpdates(state.lastUpdateId + 1, config.pollTimeoutSeconds);
      for (const update of updates) {
        state.lastUpdateId = update.update_id;
        await handleUpdate(update, state);
      }
      await autoFinalizeDrafts(state);
      await saveState(state);
    } catch (error) {
      console.error("Polling loop error:", error);
      await sleep(2000);
    }
  }
}

async function runStartupChecks() {
  console.log("Running startup checks...");

  const botInfo = await telegramRequest<{ id: number; username?: string }>("getMe", {});
  console.log(`Telegram check passed: ${botInfo.username ? `@${botInfo.username}` : botInfo.id}`);

  await syncTelegramCommands();
  console.log("Telegram commands synced");

  await assertCleanWorkingTree();
  console.log("Git check passed: working tree is clean");

  const repo = await githubRequest<GitHubRepoInfo>(`/repos/${config.githubRepo}`, "GET");
  if (repo.full_name.toLowerCase() !== config.githubRepo.toLowerCase()) {
    throw new Error(`GITHUB_REPO mismatch. Expected ${config.githubRepo}, got ${repo.full_name}`);
  }

  if (repo.permissions) {
    if (!repo.permissions.pull) {
      throw new Error("GITHUB_TOKEN is missing pull permission for repository access.");
    }
    if (!repo.permissions.push) {
      throw new Error("GITHUB_TOKEN is missing push permission (Contents: write).");
    }
  } else {
    console.warn("GitHub check warning: repository permissions were not returned by API.");
  }

  await githubRequest(`/repos/${config.githubRepo}/pulls?state=open&per_page=1`, "GET");
  await githubRequest(`/repos/${config.githubRepo}/branches/${config.baseBranch}`, "GET");

  console.log("GitHub check passed: repo access and base branch verified");
  console.log(
    config.autoFinalizeMinutes > 0
      ? `Auto-finalize enabled: ${config.autoFinalizeMinutes}m inactivity (retry ${config.autoFinalizeRetryMinutes}m)`
      : "Auto-finalize disabled"
  );
  console.log(
    config.autoMergeBotPrs
      ? `Auto-merge enabled: method=${config.autoMergeMethod}, wait=${config.autoMergeWaitSeconds}s`
      : "Auto-merge disabled"
  );
}

async function syncTelegramCommands() {
  await telegramRequest("setMyCommands", {
    commands: TELEGRAM_COMMANDS_DEFAULT
  });

  await telegramRequest("setMyCommands", {
    language_code: "ru",
    commands: TELEGRAM_COMMANDS_RU
  });
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

  const chatIdKey = String(message.chat.id);
  const activeDraft = state.drafts[chatIdKey];

  if (activeDraft?.pendingPublish) {
    if (incomingText) {
      const selectedDate = parsePublishDateChoice(incomingText, activeDraft.pendingPublish.detectedDate);
      if (!selectedDate) {
        await sendMessage(
          message.chat.id,
          [
            "Date not understood.",
            `Reply with one of: first, today, ${activeDraft.pendingPublish.detectedDate}`,
            "or a custom date in YYYY-MM-DD format.",
            "Use /cancel to stop publishing."
          ].join("\n")
        );
        return;
      }

      await sendMessage(message.chat.id, `Publishing draft with pubDate ${formatDateISO(selectedDate)}...`);
      const pending = activeDraft.pendingPublish;
      delete activeDraft.pendingPublish;

      await publishDraft(message.chat.id, chatIdKey, activeDraft, state, {
        overrideLang: pending.overrideLang,
        publicationDateOverride: selectedDate,
        mode: "manual"
      });
      return;
    }

    await sendMessage(
      message.chat.id,
      "Finish date choice first (reply: first / today / YYYY-MM-DD), or /cancel."
    );
    return;
  }

  const item = extractDraftItem(message);
  if (!item) {
    return;
  }

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
  draft.lastPublishError = undefined;
  draft.lastPublishAttemptAt = undefined;
  draft.pendingPublish = undefined;
  state.drafts[chatIdKey] = draft;

  if (draft.items.length === 1) {
    await sendMessage(message.chat.id, "Draft started. Forward your thread and run /publish when ready.");
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
        "Use /publish and choose a date (first/today/custom).",
        "Use /cancel to cancel pending publish.",
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
    const detectedDate = draft.items.length > 0 ? getDetectedPublishDate(draft) : null;
    const pendingLine = draft.pendingPublish
      ? `\nPending publish date choice: yes (default ${draft.pendingPublish.detectedDate})`
      : "";
    const detectedLine = detectedDate
      ? `\nDetected first date: ${detectedDate.dateIso} (${detectedDate.reliable ? "forward" : "fallback"})`
      : "";
    const lastErrorLine = draft.lastPublishError ? `\nLast publish error: ${draft.lastPublishError}` : "";
    await sendMessage(
      chatId,
      `Draft messages: ${draft.items.length}\nText blocks: ${textCount}\nPhotos: ${photoCount}\nStarted: ${draft.createdAt}${detectedLine}${pendingLine}${lastErrorLine}`
    );
    return;
  }

  if (command === "/cancel") {
    if (!draft?.pendingPublish) {
      await sendMessage(chatId, "Nothing pending.");
      return;
    }

    draft.pendingPublish = undefined;
    state.drafts[chatIdKey] = draft;
    await sendMessage(chatId, "Pending publish cancelled.");
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

    const parsed = parsePublishArgs(args);
    if (parsed.error) {
      await sendMessage(chatId, parsed.error);
      return;
    }

    const detectedDate = getDetectedPublishDate(draft);
    const explicitDate = parsed.dateToken
      ? parsePublishDateChoice(parsed.dateToken, detectedDate.dateIso)
      : null;

    if (parsed.dateToken && !explicitDate) {
      await sendMessage(
        chatId,
        [
          `Date value not understood: ${parsed.dateToken}`,
          "Use one of:",
          `- /publish first (detected ${detectedDate.dateIso})`,
          "- /publish today",
          "- /publish YYYY-MM-DD",
          "- /publish ru YYYY-MM-DD"
        ].join("\n")
      );
      return;
    }

    if (explicitDate) {
      await sendMessage(chatId, `Publishing draft with pubDate ${formatDateISO(explicitDate)}...`);
      draft.pendingPublish = undefined;
      await publishDraft(chatId, chatIdKey, draft, state, {
        overrideLang: parsed.overrideLang,
        publicationDateOverride: explicitDate,
        mode: "manual"
      });
      return;
    }

    draft.pendingPublish = {
      overrideLang: parsed.overrideLang,
      detectedDate: detectedDate.dateIso,
      createdAt: new Date().toISOString()
    };
    state.drafts[chatIdKey] = draft;

    await sendMessage(
      chatId,
      [
        "Choose publish date.",
        `Detected first date: ${detectedDate.dateIso}${detectedDate.reliable ? "" : " (fallback)"}`,
        "Reply with: first / today / YYYY-MM-DD",
        "Or use: /publish first, /publish today, /publish YYYY-MM-DD",
        "Use /cancel to stop."
      ].join("\n")
    );
    return;
  }

  await sendMessage(chatId, "Unknown command. Use /start for help.");
}

async function autoFinalizeDrafts(state: PublisherState) {
  if (config.autoFinalizeMinutes <= 0) {
    return;
  }

  const now = Date.now();
  const idleThresholdMs = config.autoFinalizeMinutes * 60_000;
  const retryThresholdMs = config.autoFinalizeRetryMinutes * 60_000;

  for (const [chatIdKey, draft] of Object.entries(state.drafts)) {
    if (!draft.items.length) {
      continue;
    }

    const lastItem = draft.items[draft.items.length - 1];
    const idleMs = now - lastItem.sourceDate * 1000;
    if (idleMs < idleThresholdMs) {
      continue;
    }

    const lastAttemptMs = draft.lastPublishAttemptAt ? Date.parse(draft.lastPublishAttemptAt) : 0;
    if (Number.isFinite(lastAttemptMs) && lastAttemptMs > 0 && now - lastAttemptMs < retryThresholdMs) {
      continue;
    }

    const chatId = Number(chatIdKey);
    if (!Number.isFinite(chatId)) {
      continue;
    }

    await sendMessage(
      chatId,
      `Auto-finalize triggered after ${config.autoFinalizeMinutes}m inactivity. Publishing draft...`
    );

    await publishDraft(chatId, chatIdKey, draft, state, {
      mode: "auto"
    });
  }
}

async function publishDraft(
  chatId: number,
  chatIdKey: string,
  draft: DraftState,
  state: PublisherState,
  options: { mode: "manual" | "auto"; overrideLang?: Lang; publicationDateOverride?: Date }
) {
  let publishResult: PublishResult | null = null;
  draft.lastPublishAttemptAt = new Date().toISOString();

  try {
    await assertCleanWorkingTree();
    publishResult = await buildPostFromDraft(draft, options.overrideLang, options.publicationDateOverride);
    const pullRequest = await commitAndOpenPr(publishResult);
    let autoMergeResult: AutoMergeResult | null = null;

    if (config.autoMergeBotPrs) {
      try {
        autoMergeResult = await attemptAutoMergeForBotPr(pullRequest);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown auto-merge error";
        autoMergeResult = {
          merged: false,
          reason
        };
      }
    }

    delete state.drafts[chatIdKey];

    const postUrl = await resolvePublishedPostUrl(publishResult.lang, publishResult.slug);
    const locationLine = postUrl
      ? `Post URL: ${postUrl}`
      : `Post path: /${publishResult.lang}/blog/${publishResult.slug}/`;
    const outcomeLine = autoMergeResult
      ? autoMergeResult.merged
        ? `Outcome: merged to ${config.baseBranch} (${config.autoMergeMethod})`
        : `Outcome: PR opened, not merged (${autoMergeResult.reason})`
      : "Outcome: PR opened (auto-merge disabled)";
    const visibilityLine = autoMergeResult?.merged
      ? "Visibility: appears after GitHub Pages deploy finishes"
      : "Visibility: appears after PR merge and Pages deploy";

    await sendMessage(
      chatId,
      [
        `PR created: ${pullRequest.html_url}`,
        outcomeLine,
        visibilityLine,
        locationLine,
        `Language: ${publishResult.lang}`,
        `Slug: ${publishResult.slug}`,
        `Title: ${publishResult.title}`,
        options.mode === "auto" ? "Mode: auto-finalize" : "Mode: manual publish"
      ].join("\n")
    );
  } catch (error) {
    if (publishResult) {
      await cleanupGeneratedArtifacts(publishResult);
    }

    const messageText = error instanceof Error ? error.message : "Unknown publish error";
    draft.lastPublishError = messageText;
    state.drafts[chatIdKey] = draft;
    console.error("Publish failed:", error);
    await sendMessage(chatId, `Publish failed: ${messageText}`);
  }
}

function extractDraftItem(message: TelegramMessage): DraftItem | null {
  const originalDate = getOriginalMessageDateInfo(message);
  const base = {
    messageId: message.message_id,
    sourceDate: message.date,
    originalDate: originalDate.unix,
    originalDateSource: originalDate.source
  };

  const renderedCaption = renderTelegramFormattedText(message.caption ?? "", message.caption_entities ?? []);
  const plainCaption = normalizeText(message.caption ?? "") || undefined;

  if (message.photo && message.photo.length > 0) {
    const largest = [...message.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
    return {
      ...base,
      kind: "photo",
      fileId: largest.file_id,
      caption: renderedCaption || undefined,
      captionPlain: plainCaption
    };
  }

  if (message.document?.mime_type?.startsWith("image/")) {
    return {
      ...base,
      kind: "photo",
      fileId: message.document.file_id,
      caption: renderedCaption || undefined,
      captionPlain: plainCaption
    };
  }

  const renderedText = renderTelegramFormattedText(message.text ?? "", message.entities ?? []);
  const plainText = normalizeText(message.text ?? "");
  if (renderedText) {
    return {
      ...base,
      kind: "text",
      text: renderedText,
      textPlain: plainText || undefined
    };
  }

  return null;
}

async function buildPostFromDraft(
  draft: DraftState,
  overrideLang?: Lang,
  publicationDateOverride?: Date
): Promise<PublishResult> {
  const sortedItems = [...draft.items].sort((a, b) => a.messageId - b.messageId);
  const textual = sortedItems
    .flatMap((item) => [item.textPlain, item.captionPlain])
    .filter((entry): entry is string => Boolean(entry && entry.trim()))
    .join("\n\n");

  const lang = overrideLang ?? detectLanguage(textual);
  const firstOriginalDate = sortedItems[0]?.originalDate ?? Math.floor(Date.now() / 1000);
  const candidatePublicationDate = new Date(firstOriginalDate * 1000);
  const detectedPublicationDate = Number.isNaN(candidatePublicationDate.getTime())
    ? new Date()
    : candidatePublicationDate;
  const publicationDate = publicationDateOverride ?? detectedPublicationDate;
  const title = inferTitle(textual, lang, publicationDate);
  const description = inferDescription(textual, lang);
  const slug = await createUniqueSlug(textual, publicationDate, lang);

  const blogDir = path.join(config.repoDir, "src", "pages", lang, "blog");
  const imagesDir = path.join(config.repoDir, "public", "images", slug);
  await mkdir(blogDir, { recursive: true });

  const bodyBlocks: string[] = [];
  const mediaPaths: string[] = [];
  const previewImages: string[] = [];
  const previewYoutubeVideoIds: string[] = [];
  let mediaIndex = 0;

  for (const item of sortedItems) {
    if (item.kind === "text" && item.text) {
      bodyBlocks.push(item.text);

      const youtubeVideoIds = extractYouTubeVideoIds(item.textPlain ?? "");
      for (const videoId of youtubeVideoIds) {
        bodyBlocks.push(renderYouTubeEmbed(videoId));
        if (!previewYoutubeVideoIds.includes(videoId)) {
          previewYoutubeVideoIds.push(videoId);
        }
      }

      continue;
    }

    if (item.kind === "photo" && item.fileId) {
      mediaIndex += 1;
      await mkdir(imagesDir, { recursive: true });
      const saved = await downloadTelegramImage(item.fileId, imagesDir, mediaIndex);
      mediaPaths.push(saved.absolutePath);
      if (previewImages.length < 4) {
        previewImages.push(saved.publicPath);
      }

      const altText = inferImageAlt(item.captionPlain, mediaIndex, lang);
      if (item.caption && item.caption.trim()) {
        bodyBlocks.push(
          [
            "<figure>",
            `  <img src=\"${saved.publicPath}\" alt=\"${escapeHtmlAttr(altText)}\" />`,
            `  <figcaption>${item.caption}</figcaption>`,
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
    `title: "${escapeYamlString(title)}"`,
    `description: "${escapeYamlString(description)}"`,
    `pubDate: ${publicationDate.toISOString().slice(0, 10)}`,
    `lang: ${lang}`,
    `messageCount: ${sortedItems.length}`
  ];

  if (previewImages.length > 0) {
    frontmatter.push("previewImages:");
    for (const previewImagePath of previewImages) {
      frontmatter.push(`  - "${escapeYamlString(previewImagePath)}"`);
    }
  }

  if (previewYoutubeVideoIds.length > 0) {
    frontmatter.push("youtubeVideoIds:");
    for (const youtubeVideoId of previewYoutubeVideoIds) {
      frontmatter.push(`  - "${escapeYamlString(youtubeVideoId)}"`);
    }
  }

  const singleMessageHtml =
    sortedItems.length === 1
      ? normalizeText(sortedItems[0]?.text ?? sortedItems[0]?.caption ?? "")
      : "";

  if (singleMessageHtml) {
    appendYamlBlockField(frontmatter, "singleMessageHtml", singleMessageHtml);
  }

  frontmatter.push("---", "");

  const markdown = [...frontmatter, bodyBlocks.join("\n\n"), ""].join("\n");
  const postPath = path.join(blogDir, `${slug}.md`);
  await writeFile(postPath, markdown, "utf8");

  return {
    postPath,
    mediaPaths,
    imageDirPath: imagesDir,
    slug,
    lang,
    title,
    description,
    messageCount: sortedItems.length
  };
}

async function commitAndOpenPr(publish: PublishResult): Promise<CreatedPullRequest> {
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
        `add ${publish.lang} thread ${publish.slug}`
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

    const pullRequest = await githubRequest<CreatedPullRequest>(
      `/repos/${config.githubRepo}/pulls`,
      "POST",
      {
        title: `Add ${publish.lang.toUpperCase()} thread: ${publish.title}`,
        head: branch,
        base: config.baseBranch,
        body: [
          "## Summary",
          `- Adds one new ${publish.lang.toUpperCase()} thread imported from Telegram`,
          `- Preserves message order and media sequencing`,
          `- Source file: \`${postRelative}\``
        ].join("\n")
      }
    );

    return pullRequest;
  } finally {
    await runGit(["checkout", config.baseBranch], { cwd: config.repoDir, allowFailure: true });
    await runGit(["branch", "-D", branch], { cwd: config.repoDir, allowFailure: true });
  }
}

async function attemptAutoMergeForBotPr(pullRequest: CreatedPullRequest): Promise<AutoMergeResult> {
  if (!pullRequest.head.ref.startsWith("bot/")) {
    return {
      merged: false,
      reason: "not a bot branch"
    };
  }

  const deadlineAt = Date.now() + config.autoMergeWaitSeconds * 1000;

  while (true) {
    const pull = await githubRequest<GitHubPullDetails>(
      `/repos/${config.githubRepo}/pulls/${pullRequest.number}`,
      "GET"
    );

    if (pull.state !== "open") {
      return {
        merged: false,
        reason: `PR is ${pull.state}`
      };
    }

    if (pull.head.ref !== pullRequest.head.ref) {
      return {
        merged: false,
        reason: "PR head ref changed"
      };
    }

    if (pull.draft) {
      return {
        merged: false,
        reason: "PR is draft"
      };
    }

    const mergeability = evaluateMergeability(pull);
    if (mergeability.state === "blocked") {
      return {
        merged: false,
        reason: mergeability.reason
      };
    }

    const checks = await evaluatePullChecks(pull.head.sha);
    if (checks.state === "failed") {
      return {
        merged: false,
        reason: checks.reason
      };
    }

    if (mergeability.state === "ready" && checks.state === "ready") {
      return mergePullRequest(pull.number, pull.head.sha, pull.head.ref);
    }

    if (Date.now() >= deadlineAt) {
      return {
        merged: false,
        reason: "timed out waiting for checks"
      };
    }

    await sleep(config.autoMergePollSeconds * 1000);
  }
}

function evaluateMergeability(
  pull: GitHubPullDetails
): { state: "ready" | "pending" | "blocked"; reason: string } {
  const mergeableState = (pull.mergeable_state ?? "unknown").toLowerCase();

  if (pull.mergeable === null || mergeableState === "unknown") {
    return {
      state: "pending",
      reason: "mergeability pending"
    };
  }

  if (pull.mergeable === false) {
    if (mergeableState === "dirty") {
      return {
        state: "blocked",
        reason: "merge conflict"
      };
    }

    return {
      state: "blocked",
      reason: `merge blocked (${mergeableState})`
    };
  }

  if (mergeableState === "behind") {
    return {
      state: "blocked",
      reason: "branch behind base"
    };
  }

  return {
    state: "ready",
    reason: "ready"
  };
}

async function evaluatePullChecks(
  commitSha: string
): Promise<{ state: "ready" | "pending" | "failed"; reason: string }> {
  const combinedStatus = await githubRequest<GitHubCombinedStatus>(
    `/repos/${config.githubRepo}/commits/${commitSha}/status`,
    "GET"
  );

  const commitStatusState = combinedStatus.state.toLowerCase();
  if (commitStatusState === "failure" || commitStatusState === "error") {
    return {
      state: "failed",
      reason: "commit status is failing"
    };
  }

  const statusCount = combinedStatus.total_count ?? combinedStatus.statuses?.length ?? 0;

  let checkRunsResponse: GitHubCheckRunsResponse;
  try {
    checkRunsResponse = await githubRequest<GitHubCheckRunsResponse>(
      `/repos/${config.githubRepo}/commits/${commitSha}/check-runs`,
      "GET"
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unable to read check-runs";
    return {
      state: "pending",
      reason
    };
  }

  for (const checkRun of checkRunsResponse.check_runs) {
    const status = checkRun.status.toLowerCase();
    const conclusion = (checkRun.conclusion ?? "").toLowerCase();

    if (status !== "completed") {
      return {
        state: "pending",
        reason: `check pending (${checkRun.name})`
      };
    }

    if (
      conclusion === "failure" ||
      conclusion === "cancelled" ||
      conclusion === "timed_out" ||
      conclusion === "action_required" ||
      conclusion === "stale" ||
      conclusion === "startup_failure"
    ) {
      return {
        state: "failed",
        reason: `check failed (${checkRun.name})`
      };
    }
  }

  if (commitStatusState === "pending") {
    if (statusCount === 0 && checkRunsResponse.check_runs.length === 0) {
      return {
        state: "ready",
        reason: "no status checks configured"
      };
    }

    return {
      state: "pending",
      reason: "commit status pending"
    };
  }

  return {
    state: "ready",
    reason: "checks green"
  };
}

async function mergePullRequest(prNumber: number, expectedHeadSha: string, headRef: string): Promise<AutoMergeResult> {
  try {
    const mergeResponse = await githubRequest<{ merged: boolean; message?: string }>(
      `/repos/${config.githubRepo}/pulls/${prNumber}/merge`,
      "PUT",
      {
        merge_method: config.autoMergeMethod,
        sha: expectedHeadSha
      }
    );

    if (!mergeResponse.merged) {
      return {
        merged: false,
        reason: mergeResponse.message ?? "merge not completed"
      };
    }

    const deleted = await deleteRemoteBranch(headRef);

    return {
      merged: true,
      reason: deleted ? "merged and branch deleted" : "merged (branch cleanup failed)"
    };
  } catch (error) {
    return {
      merged: false,
      reason: error instanceof Error ? error.message : "merge API request failed"
    };
  }
}

async function deleteRemoteBranch(branchRef: string): Promise<boolean> {
  try {
    const encodedRef = encodeURIComponent(`heads/${branchRef}`);
    await githubRequest(`/repos/${config.githubRepo}/git/refs/${encodedRef}`, "DELETE");
    return true;
  } catch (error) {
    console.warn(
      `Branch cleanup failed for ${branchRef}:`,
      error instanceof Error ? error.message : "unknown error"
    );
    return false;
  }
}

async function cleanupGeneratedArtifacts(publish: PublishResult) {
  const relativePaths = [toRepoRelativePath(publish.postPath), ...publish.mediaPaths.map(toRepoRelativePath)];
  if (relativePaths.length > 0) {
    await runGit(["restore", "--staged", "--", ...relativePaths], {
      cwd: config.repoDir,
      allowFailure: true
    });
  }

  await rm(publish.postPath, { force: true });
  await rm(publish.imageDirPath, { recursive: true, force: true });
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

async function githubRequest<T>(endpoint: string, method: "POST" | "GET" | "PUT" | "DELETE", body?: unknown): Promise<T> {
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

  if (response.status === 204) {
    return undefined as T;
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
  const candidate = `thread-${lang}-${datePart}-${hash}`;

  const postPath = path.join(config.repoDir, "src", "pages", lang, "blog", `${candidate}.md`);
  try {
    await readFile(postPath);
    return `${candidate}-${Date.now().toString().slice(-4)}`;
  } catch {
    return candidate;
  }
}

function detectLanguage(input: string): Lang {
  const source = stripNoiseForLanguageDetection(input || "");
  const fallbackSource = input || "";

  const candidate = source.trim() ? source : fallbackSource;
  let cyrillicCount = 0;
  let latinCount = 0;

  for (const char of candidate) {
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

function stripNoiseForLanguageDetection(input: string): string {
  return normalizeLineEndings(input)
    .replace(/https?:\/\/[^\s)]+/gi, " ")
    .replace(/www\.[^\s)]+/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[\*_~>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOriginalMessageDateInfo(message: TelegramMessage): { unix: number; source: "forward" | "received" } {
  const forwardOriginDate = message.forward_origin?.date;
  if (typeof forwardOriginDate === "number" && Number.isFinite(forwardOriginDate) && forwardOriginDate > 0) {
    return { unix: forwardOriginDate, source: "forward" };
  }

  const legacyForwardDate = message.forward_date;
  if (typeof legacyForwardDate === "number" && Number.isFinite(legacyForwardDate) && legacyForwardDate > 0) {
    return { unix: legacyForwardDate, source: "forward" };
  }

  return { unix: message.date, source: "received" };
}

function getDetectedPublishDate(draft: DraftState): { date: Date; dateIso: string; reliable: boolean } {
  const sorted = [...draft.items].sort((a, b) => a.messageId - b.messageId);
  const first = sorted[0];

  const firstDateUnix = first?.originalDate ?? Math.floor(Date.now() / 1000);
  const parsed = new Date(firstDateUnix * 1000);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const reliable = sorted.length > 0 && sorted.every((item) => item.originalDateSource === "forward");
  return {
    date: safeDate,
    dateIso: formatDateISO(safeDate),
    reliable
  };
}

function parsePublishArgs(args: string[]): { overrideLang?: Lang; dateToken?: string; error?: string } {
  const tokens = args.map((arg) => arg.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return {};
  }

  let overrideLang: Lang | undefined;
  let index = 0;

  const maybeLang = tokens[0]?.toLowerCase();
  if (maybeLang === "ru" || maybeLang === "en") {
    overrideLang = maybeLang;
    index = 1;
  }

  const remaining = tokens.slice(index);
  if (remaining.length > 1) {
    return {
      error: "Usage: /publish [ru|en] [first|today|YYYY-MM-DD]"
    };
  }

  return {
    overrideLang,
    dateToken: remaining[0]
  };
}

function parsePublishDateChoice(input: string, detectedDateIso: string): Date | null {
  const value = input.trim().toLowerCase();

  if (value === "first") {
    return parseIsoDate(detectedDateIso);
  }

  if (value === "today") {
    return parseIsoDate(formatDateISO(new Date()));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseIsoDate(value);
  }

  return null;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function inferTitle(input: string, lang: Lang, date: Date): string {
  const normalized = normalizeText(input);
  if (!normalized) {
    return lang === "ru" ? `Tred ${date.toISOString().slice(0, 10)}` : `Thread ${date.toISOString().slice(0, 10)}`;
  }

  const firstLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 12);

  if (!firstLine) {
    return lang === "ru" ? `Tred ${date.toISOString().slice(0, 10)}` : `Thread ${date.toISOString().slice(0, 10)}`;
  }

  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const clean = sentence.replace(/[#*_`>\[\]]/g, "").trim();
  if (clean.length < 8) {
    return lang === "ru" ? `Tred ${date.toISOString().slice(0, 10)}` : `Thread ${date.toISOString().slice(0, 10)}`;
  }

  return clean;
}

function inferDescription(input: string, lang: Lang): string {
  const normalized = normalizeText(input).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return lang === "ru"
      ? "Thread imported from Telegram with ordered messages and media."
      : "Thread imported from Telegram with ordered messages and media.";
  }

  return truncate(normalized, 155);
}

function inferImageAlt(caption: string | undefined, index: number, lang: Lang): string {
  const normalizedCaption = normalizeText(caption ?? "");
  if (normalizedCaption) {
    return truncate(normalizedCaption.replace(/\s+/g, " "), 90);
  }

  return lang === "ru" ? `Thread image ${index}` : `Thread image ${index}`;
}

interface RichTelegramEntity extends TelegramMessageEntity {
  id: number;
  end: number;
}

function renderTelegramFormattedText(text: string, entities: TelegramMessageEntity[]): string {
  const source = normalizeLineEndings(text).trim();
  if (!source) {
    return "";
  }

  const validEntities = normalizeTelegramEntities(source, entities);
  if (!validEntities.length) {
    return escapeHtmlText(source);
  }

  const startsAt = new Map<number, RichTelegramEntity[]>();
  for (const entity of validEntities) {
    const existing = startsAt.get(entity.offset) ?? [];
    existing.push(entity);
    startsAt.set(entity.offset, existing);
  }

  for (const list of startsAt.values()) {
    list.sort((a, b) => b.length - a.length || entityPriority(a) - entityPriority(b));
  }

  let output = "";
  const stack: RichTelegramEntity[] = [];

  for (let position = 0; position <= source.length; position += 1) {
    while (stack.length > 0 && stack[stack.length - 1]?.end === position) {
      const closing = stack.pop();
      if (closing) {
        output += entityCloseTag(closing);
      }
    }

    const openingEntities = startsAt.get(position) ?? [];
    for (const entity of openingEntities) {
      const top = stack[stack.length - 1];
      if (top && entity.end > top.end) {
        continue;
      }

      const openTag = entityOpenTag(entity, source);
      const closeTag = entityCloseTag(entity);
      if (!openTag || !closeTag) {
        continue;
      }

      output += openTag;
      stack.push(entity);
    }

    if (position === source.length) {
      break;
    }

    output += escapeHtmlText(source[position] ?? "");
  }

  while (stack.length > 0) {
    const closing = stack.pop();
    if (closing) {
      output += entityCloseTag(closing);
    }
  }

  return output.trim();
}

function normalizeTelegramEntities(text: string, entities: TelegramMessageEntity[]): RichTelegramEntity[] {
  return entities
    .map((entity, id) => ({
      ...entity,
      id,
      end: entity.offset + entity.length
    }))
    .filter(
      (entity) =>
        Number.isInteger(entity.offset) &&
        Number.isInteger(entity.length) &&
        entity.length > 0 &&
        entity.offset >= 0 &&
        entity.end <= text.length
    )
    .sort((a, b) => a.offset - b.offset || b.length - a.length || entityPriority(a) - entityPriority(b));
}

function entityOpenTag(entity: RichTelegramEntity, source: string): string {
  const segment = source.slice(entity.offset, entity.end);

  switch (entity.type) {
    case "bold":
      return "<strong>";
    case "italic":
      return "<em>";
    case "underline":
      return "<u>";
    case "strikethrough":
      return "<s>";
    case "spoiler":
      return '<span class="tg-spoiler">';
    case "code":
      return "<code>";
    case "pre": {
      const language = (entity.language ?? "").match(/^[a-zA-Z0-9_-]{1,32}$/)?.[0];
      return language ? `<pre><code class="language-${language}">` : "<pre><code>";
    }
    case "text_link":
      return entity.url
        ? `<a href="${escapeHtmlAttr(entity.url)}" target="_blank" rel="noopener noreferrer">`
        : "";
    case "text_mention":
      return entity.user?.id
        ? `<a href="tg://user?id=${entity.user.id}" target="_blank" rel="noopener noreferrer">`
        : "";
    case "url": {
      const href = segment.startsWith("http://") || segment.startsWith("https://") ? segment : `https://${segment}`;
      return `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    case "email":
      return `<a href="mailto:${escapeHtmlAttr(segment)}">`;
    case "phone_number":
      return `<a href="tel:${escapeHtmlAttr(segment)}">`;
    default:
      return "";
  }
}

function entityCloseTag(entity: RichTelegramEntity): string {
  switch (entity.type) {
    case "bold":
      return "</strong>";
    case "italic":
      return "</em>";
    case "underline":
      return "</u>";
    case "strikethrough":
      return "</s>";
    case "spoiler":
      return "</span>";
    case "code":
      return "</code>";
    case "pre":
      return "</code></pre>";
    case "text_link":
    case "text_mention":
    case "url":
    case "email":
    case "phone_number":
      return "</a>";
    default:
      return "";
  }
}

function entityPriority(entity: TelegramMessageEntity): number {
  switch (entity.type) {
    case "pre":
      return 0;
    case "code":
      return 1;
    case "bold":
      return 2;
    case "italic":
      return 3;
    case "underline":
      return 4;
    case "strikethrough":
      return 5;
    case "spoiler":
      return 6;
    case "text_link":
    case "text_mention":
    case "url":
    case "email":
    case "phone_number":
      return 7;
    default:
      return 10;
  }
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n");
}

function extractYouTubeVideoIds(input: string): string[] {
  const source = normalizeText(input);
  if (!source) {
    return [];
  }

  const matches = source.match(/(?:https?:\/\/|www\.)[^\s<>()"']+/g) ?? [];
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const cleaned = match.replace(/[),.;!?]+$/g, "");
    const videoId = extractYouTubeVideoIdFromUrl(cleaned);
    if (!videoId || seen.has(videoId)) {
      continue;
    }

    seen.add(videoId);
    ids.push(videoId);
  }

  return ids;
}

function extractYouTubeVideoIdFromUrl(rawUrl: string): string | null {
  const normalizedUrl = rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`;

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const pathSegments = parsed.pathname.split("/").filter(Boolean);

  let candidate = "";

  if (host === "youtu.be") {
    candidate = pathSegments[0] ?? "";
  } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    if (pathSegments[0] === "watch") {
      candidate = parsed.searchParams.get("v") ?? "";
    } else if (pathSegments[0] === "shorts" || pathSegments[0] === "live" || pathSegments[0] === "embed") {
      candidate = pathSegments[1] ?? "";
    }
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

function renderYouTubeEmbed(videoId: string): string {
  return [
    '<div class="youtube-embed">',
    `  <iframe src="https://www.youtube-nocookie.com/embed/${videoId}" title="YouTube video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`,
    "</div>"
  ].join("\n");
}

function appendYamlBlockField(lines: string[], key: string, value: string) {
  lines.push(`${key}: |`);
  for (const rawLine of normalizeLineEndings(value).split("\n")) {
    lines.push(`  ${rawLine}`);
  }
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

function normalizeSiteBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(prefixed);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

async function resolvePublishedPostUrl(lang: Lang, slug: string): Promise<string | null> {
  const configuredBase = config.publicSiteUrl;
  if (configuredBase) {
    return `${configuredBase}/${lang}/blog/${slug}/`;
  }

  const cnamePath = path.join(config.repoDir, "public", "CNAME");
  try {
    const cnameRaw = await readFile(cnamePath, "utf8");
    const cname = cnameRaw.trim();
    if (cname) {
      return `https://${cname}/${lang}/blog/${slug}/`;
    }
  } catch {
    // Ignore missing CNAME and fall back to GitHub Pages URL.
  }

  const [owner, repo] = config.githubRepo.split("/");
  if (owner && repo) {
    return `https://${owner}.github.io/${repo}/${lang}/blog/${slug}/`;
  }

  return null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function parseBooleanEnv(input: string | undefined, defaultValue: boolean): boolean {
  if (input == null) {
    return defaultValue;
  }

  const value = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  return defaultValue;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
