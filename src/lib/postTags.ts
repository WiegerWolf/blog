type ThreadLang = "en" | "ru";

export interface PostTagInput {
  defaultLang: ThreadLang;
  url: string;
  title: string;
  description: string;
  lang?: ThreadLang;
  messageCount?: number;
  previewImages?: string[];
  previewVideos?: string[];
  youtubeVideoIds?: string[];
  singleMessageHtml?: string;
  tags?: string[];
}

interface TagRule {
  tag: string;
  patterns?: RegExp[];
  hostnames?: string[];
}

const URL_PATTERN = /https?:\/\/[^\s<>")']+/gi;

const TAG_RULES: TagRule[] = [
  {
    tag: "ai",
    patterns: [/\bai\b/iu, /искусственн/iu, /нейросет/iu, /нейрон/iu, /machine learning/iu, /генератив/iu]
  },
  {
    tag: "llm",
    patterns: [/\bllm\b/iu, /large language model/iu, /языков\w* модел/iu, /\bgpt\b/iu, /claude/iu, /gemini/iu]
  },
  {
    tag: "prompting",
    patterns: [/\bprompt\b/iu, /промпт/iu]
  },
  {
    tag: "automation",
    patterns: [/automation/iu, /automated/iu, /автоматиз/iu, /автоген/iu, /workflow/iu, /\bbot\b/iu, /\bagent\b/iu]
  },
  {
    tag: "coding",
    patterns: [
      /\bcode\b/iu,
      /coding/iu,
      /programming/iu,
      /программир/iu,
      /разработк/iu,
      /repository/iu,
      /\brepo\b/iu,
      /\bgit\b/iu
    ]
  },
  {
    tag: "open-source",
    patterns: [/open[ -]?source/iu, /\boss\b/iu],
    hostnames: ["github.com"]
  },
  {
    tag: "youtube",
    patterns: [/youtube/iu, /ютуб/iu],
    hostnames: ["youtube.com", "youtu.be", "youtube-nocookie.com"]
  },
  {
    tag: "gaming",
    patterns: [/\bgame\b/iu, /gaming/iu, /игр/iu, /xbox/iu, /steam/iu, /playstation/iu, /postal2?/iu]
  },
  {
    tag: "hardware",
    patterns: [/\bhardware\b/iu, /\bgpu\b/iu, /\bcpu\b/iu, /\bchip\b/iu, /nvidia/iu, /\bamd\b/iu, /желез/iu]
  },
  {
    tag: "security",
    patterns: [/security/iu, /vulnerab/iu, /exploit/iu, /malware/iu, /phishing/iu, /уязв/iu, /безопас/iu, /хак/iu]
  },
  {
    tag: "browser",
    patterns: [/\bchrome\b/iu, /\bfirefox\b/iu, /\bsafari\b/iu, /\bedge\b/iu, /браузер/iu, /хром/iu]
  },
  {
    tag: "social",
    patterns: [/reddit/iu, /twitter/iu, /x\.com/iu, /facebook/iu, /instagram/iu, /linkedin/iu, /telegram/iu, /tiktok/iu, /соцсет/iu],
    hostnames: ["reddit.com", "x.com", "twitter.com", "facebook.com", "linkedin.com", "t.me", "telegram.me", "instagram.com", "tiktok.com"]
  },
  {
    tag: "startup",
    patterns: [/\bstartup\b/iu, /\bvc\b/iu, /funding/iu, /инвест/iu, /стартап/iu]
  },
  {
    tag: "google",
    patterns: [/\bgoogle\b/iu, /гугл/iu],
    hostnames: ["google.com"]
  },
  {
    tag: "microsoft",
    patterns: [/\bmicrosoft\b/iu, /майкрософт/iu, /\bxbox\b/iu],
    hostnames: ["microsoft.com", "linkedin.com"]
  },
  {
    tag: "openai",
    patterns: [/\bopenai\b/iu, /chatgpt/iu],
    hostnames: ["openai.com"]
  },
  {
    tag: "anthropic",
    patterns: [/\banthropic\b/iu, /claude/iu],
    hostnames: ["anthropic.com"]
  }
];

const TAG_PRIORITY = [
  "ai",
  "llm",
  "prompting",
  "coding",
  "automation",
  "open-source",
  "youtube",
  "gaming",
  "hardware",
  "security",
  "browser",
  "social",
  "startup",
  "google",
  "microsoft",
  "openai",
  "anthropic",
  "video",
  "image",
  "quick-note",
  "misc"
] as const;

const TAG_ALIAS: Record<string, string> = {
  llms: "llm",
  prompts: "prompting",
  prompt: "prompting",
  automation: "automation",
  coding: "coding",
  code: "coding",
  opensource: "open-source",
  "open-source": "open-source",
  youtube: "youtube",
  gaming: "gaming",
  hardware: "hardware",
  security: "security",
  browser: "browser",
  social: "social",
  startup: "startup",
  google: "google",
  microsoft: "microsoft",
  openai: "openai",
  anthropic: "anthropic",
  video: "video",
  image: "image",
  ai: "ai",
  llm: "llm",
  misc: "misc",
  "quick-note": "quick-note"
};

const ALLOWED_TAGS = new Set<string>(TAG_PRIORITY);

function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

function stripHtml(value: string): string {
  return value
    .replace(/<pre[\s\S]*?<\/pre>/giu, " ")
    .replace(/<code[\s\S]*?<\/code>/giu, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHostnames(text: string): Set<string> {
  const hosts = new Set<string>();
  const urls = text.match(URL_PATTERN) ?? [];

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      hosts.add(normalizeHost(parsed.hostname));
    } catch {
      // Ignore malformed URL-like fragments.
    }
  }

  return hosts;
}

function addScore(scores: Map<string, number>, tag: string, value: number) {
  scores.set(tag, (scores.get(tag) ?? 0) + value);
}

function scoreRule(rule: TagRule, text: string, hosts: Set<string>): number {
  let score = 0;

  for (const pattern of rule.patterns ?? []) {
    if (pattern.test(text)) {
      score += 1;
    }
  }

  for (const hostname of rule.hostnames ?? []) {
    const target = normalizeHost(hostname);
    for (const host of hosts) {
      if (host === target || host.endsWith(`.${target}`)) {
        score += 2;
        break;
      }
    }
  }

  return score;
}

function resolveManualTags(tags: string[]): string[] {
  const resolved: string[] = [];

  for (const raw of tags) {
    const normalized = normalizeTag(raw);
    const alias = TAG_ALIAS[normalized] ?? normalized;
    if (!ALLOWED_TAGS.has(alias)) {
      continue;
    }
    if (!resolved.includes(alias)) {
      resolved.push(alias);
    }
  }

  return resolved;
}

function getPriorityIndex(tag: string): number {
  const index = TAG_PRIORITY.indexOf(tag as (typeof TAG_PRIORITY)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function buildThreadTags(input: PostTagInput): string[] {
  const textSource = [input.title, input.description, stripHtml(input.singleMessageHtml ?? "")]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const hosts = extractHostnames(textSource);
  const scores = new Map<string, number>();

  for (const rule of TAG_RULES) {
    const score = scoreRule(rule, textSource, hosts);
    if (score > 0) {
      addScore(scores, rule.tag, score);
    }
  }

  if ((input.previewVideos?.length ?? 0) > 0 || (input.youtubeVideoIds?.length ?? 0) > 0) {
    addScore(scores, "video", 2);
  }

  if ((input.previewImages?.length ?? 0) > 0) {
    addScore(scores, "image", 1);
  }

  if ((input.youtubeVideoIds?.length ?? 0) > 0) {
    addScore(scores, "youtube", 2);
  }

  const manualTags = resolveManualTags(input.tags ?? []);

  const scoredTags = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return getPriorityIndex(left[0]) - getPriorityIndex(right[0]);
    })
    .map(([tag]) => tag);

  const merged = [...manualTags, ...scoredTags].filter((value, index, values) => values.indexOf(value) === index);
  const top = merged.slice(0, 4);

  if (top.length > 0) {
    return top;
  }

  return (input.messageCount ?? 0) <= 1 ? ["quick-note"] : ["misc"];
}
