import type { SourceConfig } from "./types.js";

export const DEFAULT_WINDOW_HOURS = 24;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_DAILY_ARTICLES = 10;

// Four-layer source network. Discovery sources run normally, but never enter
// public surfaces until an independent first-party or authoritative proof arrives.
export const SOURCES: SourceConfig[] = [
  {
    type: "rss",
    name: "arXiv · Robotics",
    // The category RSS feed is empty on arXiv non-publication days. The Atom
    // API keeps the latest submissions available for the rolling research view.
    // Keep a sufficiently deep rolling pool. The homepage selects only six
    // papers, but needs more than one day's submissions to rank responsibly.
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.RO&start=0&max_results=100&sortBy=submittedDate&sortOrder=descending",
    weight: 9,
    keywords: ["robot", "robotics", "humanoid", "embodied", "manipulation", "vision-language-action", "world model"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "NVIDIA Newsroom",
    url: "https://nvidianews.nvidia.com/cats/robotics.xml",
    weight: 10,
    keywords: ["robotics", "physical ai", "isaac", "groot", "cosmos", "humanoid"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "LeRobot Releases",
    url: "https://github.com/huggingface/lerobot/releases.atom",
    weight: 9,
    keywords: ["robot", "lerobot", "embodied", "dataset", "policy"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "Isaac Lab Releases",
    url: "https://github.com/isaac-sim/IsaacLab/releases.atom",
    weight: 9,
    keywords: ["isaac", "robot", "simulation", "rl"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "Google DeepMind Blog",
    url: "https://deepmind.google/blog/rss.xml",
    weight: 10,
    keywords: ["robot", "robotics", "embodied", "gemini robotics", "vision-language-action", "world model"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/",
    weight: 8,
    keywords: ["robot", "robotics", "embodied", "gemini robotics", "physical ai"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "IEEE Spectrum · Robotics",
    url: "https://spectrum.ieee.org/feeds/topic/robotics.rss",
    weight: 7,
    keywords: ["robot", "robotics", "humanoid", "automation", "embodied"],
    tier: "权威产业媒体", status: "已启用", publicationPolicy: "可作为独立报道",
  },
  {
    type: "rss",
    name: "TechCrunch · Robotics",
    url: "https://techcrunch.com/category/robotics/feed/",
    weight: 6,
    keywords: ["robot", "robotics", "humanoid", "embodied", "automation", "physical ai"],
    tier: "权威产业媒体", status: "已启用", publicationPolicy: "可作为独立报道",
  },
  {
    type: "rss",
    name: "Google News · Robotics Capital",
    url: "https://news.google.com/rss/search?q=%28robotics%20OR%20humanoid%20OR%20%22physical%20AI%22%20OR%20embodied%29%20%28funding%20OR%20raises%20OR%20%22Series%20A%22%20OR%20%22Series%20B%22%20OR%20acquisition%29&hl=en-US&gl=US&ceid=US:en",
    weight: 6,
    keywords: ["robotics", "robot", "humanoid", "physical ai", "embodied", "funding", "raises", "series"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    type: "rss",
    name: "Google News · 中国具身融资",
    url: "https://news.google.com/rss/search?q=%28%E5%85%B7%E8%BA%AB%E6%99%BA%E8%83%BD%20OR%20%E4%BA%BA%E5%BD%A2%E6%9C%BA%E5%99%A8%E4%BA%BA%20OR%20%E6%9C%BA%E5%99%A8%E4%BA%BA%29%20%28%E8%9E%8D%E8%B5%84%20OR%20%E6%8A%95%E8%B5%84%20OR%20%E6%94%B6%E8%B4%AD%29&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
    weight: 6,
    keywords: ["机器人", "人形机器人", "具身智能", "融资", "投资", "收购"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    type: "rss",
    name: "OpenPI Releases",
    url: "https://github.com/Physical-Intelligence/openpi/releases.atom",
    weight: 9,
    keywords: ["robot", "openpi", "pi0", "embodied", "policy", "vision-language-action"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "rss",
    name: "OpenVLA Releases",
    url: "https://github.com/openvla/openvla/releases.atom",
    weight: 9,
    keywords: ["robot", "openvla", "vision-language-action", "vla", "embodied", "policy"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    type: "algolia",
    name: "Hacker News · Robotics",
    query: "robotics",
    weight: 2,
    keywords: ["robot", "humanoid", "embodied", "physical ai", "vla"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    type: "algolia",
    name: "Hacker News · Humanoid",
    query: "humanoid",
    weight: 2,
    keywords: ["humanoid", "robot", "figure", "unitree", "tesla"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    type: "algolia",
    name: "Hacker News · Embodied AI",
    query: "embodied AI",
    weight: 2,
    keywords: ["embodied", "robot", "vla", "physical ai"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
];

// X 仅作为「行业脉搏」的发现层：只追踪身份明确的公开账号，且不以单条帖文
// 改写长期产业判断。需要 X_BEARER_TOKEN 才会启用；未配置时日报照常生成。
export const X_SOURCES: SourceConfig[] = [
  {
    type: "x",
    name: "X · 产业领军者观察",
    weight: 7,
    keywords: ["robot", "robotics", "humanoid", "embodied", "physical ai", "vla", "world model"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
    accounts: [
      { handle: "drfeifei", label: "李飞飞", type: "人物" },
      { handle: "demishassabis", label: "Demis Hassabis", type: "人物" },
      { handle: "GoogleDeepMind", label: "Google DeepMind", type: "机构" },
      { handle: "Figure_robot", label: "Figure", type: "机构" },
      { handle: "UnitreeRobotics", label: "宇树科技", type: "机构" },
    ],
  },
];
