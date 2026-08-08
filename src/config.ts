import type { SourceConfig } from "./types.js";

export const DEFAULT_WINDOW_HOURS = 24;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_DAILY_ARTICLES = 10;

// Four-layer source network. Discovery sources run normally, but never enter
// public surfaces until an independent first-party or authoritative proof arrives.
export const SOURCES: SourceConfig[] = [
  {
    id: "academic-arxiv-robotics", role: "学术索引",
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
    id: "official-nvidia-newsroom", entityIds: ["nvidia"], role: "公司官网",
    type: "rss",
    name: "NVIDIA Newsroom",
    url: "https://nvidianews.nvidia.com/cats/robotics.xml",
    weight: 10,
    keywords: ["robotics", "physical ai", "isaac", "groot", "cosmos", "humanoid"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-lerobot-releases", entityIds: ["huggingface"], role: "代码发布",
    type: "rss",
    name: "LeRobot Releases",
    url: "https://github.com/huggingface/lerobot/releases.atom",
    weight: 9,
    keywords: ["robot", "lerobot", "embodied", "dataset", "policy"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-isaac-lab-releases", entityIds: ["nvidia"], role: "代码发布",
    type: "rss",
    name: "Isaac Lab Releases",
    url: "https://github.com/isaac-sim/IsaacLab/releases.atom",
    weight: 9,
    keywords: ["isaac", "robot", "simulation", "rl"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-google-deepmind-blog", entityIds: ["google-deepmind"], role: "实验室官网",
    type: "rss",
    name: "Google DeepMind Blog",
    url: "https://deepmind.google/blog/rss.xml",
    weight: 10,
    keywords: ["robot", "robotics", "embodied", "gemini robotics", "vision-language-action", "world model"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-google-ai-blog", entityIds: ["google-deepmind"], role: "实验室官网",
    type: "rss",
    name: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/",
    weight: 8,
    keywords: ["robot", "robotics", "embodied", "gemini robotics", "physical ai"],
    tier: "官方公司与实验室", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "media-ieee-spectrum-robotics", role: "产业媒体",
    type: "rss",
    name: "IEEE Spectrum · Robotics",
    url: "https://spectrum.ieee.org/feeds/topic/robotics.rss",
    weight: 7,
    keywords: ["robot", "robotics", "humanoid", "automation", "embodied"],
    tier: "权威产业媒体", status: "已启用", publicationPolicy: "可作为独立报道",
  },
  {
    id: "media-techcrunch-robotics", role: "产业媒体",
    type: "rss",
    name: "TechCrunch · Robotics",
    url: "https://techcrunch.com/category/robotics/feed/",
    weight: 6,
    keywords: ["robot", "robotics", "humanoid", "embodied", "automation", "physical ai"],
    tier: "权威产业媒体", status: "已启用", publicationPolicy: "可作为独立报道",
  },
  {
    id: "media-robot-report", role: "产业媒体",
    type: "rss",
    name: "The Robot Report",
    url: "https://www.therobotreport.com/feed/",
    weight: 8,
    keywords: ["robot", "robotics", "humanoid", "physical ai", "funding", "raises", "investment", "deployment"],
    tier: "权威产业媒体", status: "已启用", publicationPolicy: "可作为独立报道",
  },
  {
    id: "discovery-google-news-capital", role: "线索发现",
    type: "rss",
    name: "Google News · Robotics Capital",
    url: "https://news.google.com/rss/search?q=%28robotics%20OR%20humanoid%20OR%20%22physical%20AI%22%20OR%20embodied%29%20%28funding%20OR%20raises%20OR%20%22Series%20A%22%20OR%20%22Series%20B%22%20OR%20acquisition%29&hl=en-US&gl=US&ceid=US:en",
    weight: 6,
    keywords: ["robotics", "robot", "humanoid", "physical ai", "embodied", "funding", "raises", "series"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    id: "discovery-google-news-china", role: "线索发现",
    type: "rss",
    name: "Google News · 中国具身融资",
    url: "https://news.google.com/rss/search?q=%28%E5%85%B7%E8%BA%AB%E6%99%BA%E8%83%BD%20OR%20%E4%BA%BA%E5%BD%A2%E6%9C%BA%E5%99%A8%E4%BA%BA%20OR%20%E6%9C%BA%E5%99%A8%E4%BA%BA%29%20%28%E8%9E%8D%E8%B5%84%20OR%20%E6%8A%95%E8%B5%84%20OR%20%E6%94%B6%E8%B4%AD%29&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
    weight: 6,
    keywords: ["机器人", "人形机器人", "具身智能", "融资", "投资", "收购"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    id: "oss-openpi-releases", entityIds: ["physical-intelligence"], role: "代码发布",
    type: "rss",
    name: "OpenPI Releases",
    url: "https://github.com/Physical-Intelligence/openpi/releases.atom",
    weight: 9,
    keywords: ["robot", "openpi", "pi0", "embodied", "policy", "vision-language-action"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-openvla-releases", role: "代码发布",
    type: "rss",
    name: "OpenVLA Releases",
    url: "https://github.com/openvla/openvla/releases.atom",
    weight: 9,
    keywords: ["robot", "openvla", "vision-language-action", "vla", "embodied", "policy"],
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-groot-releases", type: "github-releases", repo: "NVIDIA/Isaac-GR00T", name: "Isaac GR00T Releases", weight: 10,
    keywords: ["robot", "groot", "humanoid", "vla", "foundation model"], entityIds: ["nvidia"], role: "代码发布",
    tier: "开源发布", status: "已启用", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-genesis-releases", type: "github-releases", repo: "Genesis-Embodied-AI/Genesis", name: "Genesis Releases", weight: 8,
    keywords: ["robot", "simulation", "embodied", "physics"], role: "代码发布",
    tier: "开源发布", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-maniskill-releases", type: "github-releases", repo: "haosulab/ManiSkill", name: "ManiSkill Releases", weight: 8,
    keywords: ["robot", "manipulation", "simulation", "benchmark"], role: "代码发布",
    tier: "开源发布", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-robomimic-releases", type: "github-releases", repo: "ARISE-Initiative/robomimic", name: "robomimic Releases", weight: 8,
    keywords: ["robot", "imitation", "dataset", "policy"], role: "代码发布",
    tier: "开源发布", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "oss-mujoco-releases", type: "github-releases", repo: "google-deepmind/mujoco", name: "MuJoCo Releases", weight: 8,
    keywords: ["robot", "simulation", "physics"], entityIds: ["google-deepmind"], role: "代码发布",
    tier: "开源发布", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-figure-news", type: "webpage", url: "https://www.figure.ai/news", linkPattern: "/news/", maxItems: 20,
    name: "Figure News", weight: 10, keywords: ["robot", "humanoid", "helix", "funding", "deployment"], entityIds: ["figure"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-1x-discover", type: "webpage", url: "https://www.1x.tech/discover", linkPattern: "/discover/", maxItems: 20,
    name: "1X Discover", weight: 10, keywords: ["robot", "humanoid", "neo", "world model"], entityIds: ["1x"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-apptronik-press", type: "webpage", url: "https://apptronik.com/company/press-releases", linkPattern: "press|news|company", maxItems: 20,
    name: "Apptronik Press", weight: 10, keywords: ["robot", "humanoid", "apollo", "funding", "deployment"], entityIds: ["apptronik"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-skild-blog", type: "webpage", url: "https://www.skild.ai/blogs", linkPattern: "/blogs/", maxItems: 20,
    name: "Skild AI Blog", weight: 10, keywords: ["robot", "skild brain", "funding", "deployment"], entityIds: ["skild-ai"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-boston-dynamics-news", type: "webpage", url: "https://bostondynamics.com/news/", linkPattern: "/news/", maxItems: 20,
    name: "Boston Dynamics News", weight: 10, keywords: ["robot", "atlas", "spot", "stretch", "deployment"], entityIds: ["boston-dynamics"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-physical-intelligence-blog", type: "webpage", url: "https://www.physicalintelligence.company/blog", linkPattern: "/blog/", maxItems: 20,
    name: "Physical Intelligence Blog", weight: 10, keywords: ["robot", "physical intelligence", "pi0", "vla"], entityIds: ["physical-intelligence"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-dyna-news", type: "webpage", url: "https://www.dyna.co/", linkPattern: "research|announcement|news", maxItems: 12,
    name: "DYNA Robotics News", weight: 10, keywords: ["robot", "embodied", "funding", "deployment"], entityIds: ["dyna-robotics"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-agility-press", type: "webpage", url: "https://www.agilityrobotics.com/latest-press", linkPattern: "content|press", maxItems: 20,
    name: "Agility Robotics Press", weight: 10, keywords: ["robot", "digit", "funding", "deployment"], entityIds: ["agility-robotics"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-stanford-robotics", type: "webpage", url: "https://src.stanford.edu/news", linkPattern: "/news/", maxItems: 20,
    name: "Stanford Robotics Center", weight: 9, keywords: ["robot", "robotics", "embodied", "foundation model"], entityIds: ["stanford-robotics-center"], role: "实验室官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-x-humanoid-news", type: "webpage", url: "https://www.x-humanoid.com/", linkPattern: "news|xwzx|detail", maxItems: 20,
    name: "北京人形机器人创新中心", weight: 10, keywords: ["机器人", "人形", "具身", "天工", "慧思开物"], entityIds: ["x-humanoid"], role: "实验室官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-booster-news", type: "webpage", url: "https://www.booster.tech/zh/", linkPattern: "news|blog|article", maxItems: 20,
    name: "加速进化 News", weight: 9, keywords: ["机器人", "人形", "Booster", "T1"], entityIds: ["booster-robotics"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-robotera-news", type: "webpage", url: "https://www.robotera.com/", linkPattern: "news|article|detail", maxItems: 20,
    name: "星动纪元 News", weight: 9, keywords: ["机器人", "人形", "具身", "灵巧手"], entityIds: ["robotera"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "official-xsquare-news", type: "webpage", url: "https://x2robot.com/", linkPattern: "news|article|about", maxItems: 20,
    name: "自变量机器人 News", weight: 9, keywords: ["机器人", "具身", "世界模型", "WALL"], entityIds: ["x-square-robot"], role: "公司官网",
    tier: "官方公司与实验室", status: "观察", publicationPolicy: "可作为一手证据",
  },
  {
    id: "discovery-hn-robotics", role: "线索发现",
    type: "algolia",
    name: "Hacker News · Robotics",
    query: "robotics",
    weight: 2,
    keywords: ["robot", "humanoid", "embodied", "physical ai", "vla"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    id: "discovery-hn-humanoid", role: "线索发现",
    type: "algolia",
    name: "Hacker News · Humanoid",
    query: "humanoid",
    weight: 2,
    keywords: ["humanoid", "robot", "figure", "unitree", "tesla"],
    tier: "线索发现层", status: "已启用", publicationPolicy: "仅作线索发现",
  },
  {
    id: "discovery-hn-embodied", role: "线索发现",
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
    id: "discovery-x-leaders", role: "线索发现",
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
