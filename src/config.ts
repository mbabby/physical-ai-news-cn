import type { SourceConfig } from "./types.js";

export const DEFAULT_WINDOW_HOURS = 24;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_DAILY_ARTICLES = 10;

// 一手官方源优先，行业媒体用于补充投融资与部署消息；HN 仅作低权重线索。
export const SOURCES: SourceConfig[] = [
  {
    type: "rss",
    name: "NVIDIA Newsroom",
    url: "https://nvidianews.nvidia.com/cats/robotics.xml",
    weight: 10,
    keywords: ["robotics", "physical ai", "isaac", "groot", "cosmos", "humanoid"],
  },
  {
    type: "rss",
    name: "LeRobot Releases",
    url: "https://github.com/huggingface/lerobot/releases.atom",
    weight: 9,
    keywords: ["robot", "lerobot", "embodied", "dataset", "policy"],
  },
  {
    type: "rss",
    name: "Isaac Lab Releases",
    url: "https://github.com/isaac-sim/IsaacLab/releases.atom",
    weight: 9,
    keywords: ["isaac", "robot", "simulation", "rl"],
  },
  {
    type: "rss",
    name: "Google DeepMind Blog",
    url: "https://deepmind.google/blog/rss.xml",
    weight: 10,
    keywords: ["robot", "robotics", "embodied", "gemini robotics", "vision-language-action", "world model"],
  },
  {
    type: "rss",
    name: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/",
    weight: 8,
    keywords: ["robot", "robotics", "embodied", "gemini robotics", "physical ai"],
  },
  {
    type: "rss",
    name: "IEEE Spectrum · Robotics",
    url: "https://spectrum.ieee.org/feeds/topic/robotics.rss",
    weight: 7,
    keywords: ["robot", "robotics", "humanoid", "automation", "embodied"],
  },
  {
    type: "rss",
    name: "TechCrunch · Robotics",
    url: "https://techcrunch.com/category/robotics/feed/",
    weight: 6,
    keywords: ["robot", "robotics", "humanoid", "embodied", "automation", "physical ai"],
  },
  {
    type: "rss",
    name: "Google News · Robotics Capital",
    url: "https://news.google.com/rss/search?q=%28robotics%20OR%20humanoid%20OR%20%22physical%20AI%22%20OR%20embodied%29%20%28funding%20OR%20raises%20OR%20%22Series%20A%22%20OR%20%22Series%20B%22%20OR%20acquisition%29&hl=en-US&gl=US&ceid=US:en",
    weight: 6,
    keywords: ["robotics", "robot", "humanoid", "physical ai", "embodied", "funding", "raises", "series"],
  },
  {
    type: "rss",
    name: "Google News · 中国具身融资",
    url: "https://news.google.com/rss/search?q=%28%E5%85%B7%E8%BA%AB%E6%99%BA%E8%83%BD%20OR%20%E4%BA%BA%E5%BD%A2%E6%9C%BA%E5%99%A8%E4%BA%BA%20OR%20%E6%9C%BA%E5%99%A8%E4%BA%BA%29%20%28%E8%9E%8D%E8%B5%84%20OR%20%E6%8A%95%E8%B5%84%20OR%20%E6%94%B6%E8%B4%AD%29&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
    weight: 6,
    keywords: ["机器人", "人形机器人", "具身智能", "融资", "投资", "收购"],
  },
  {
    type: "rss",
    name: "OpenPI Releases",
    url: "https://github.com/Physical-Intelligence/openpi/releases.atom",
    weight: 9,
    keywords: ["robot", "openpi", "pi0", "embodied", "policy", "vision-language-action"],
  },
  {
    type: "rss",
    name: "OpenVLA Releases",
    url: "https://github.com/openvla/openvla/releases.atom",
    weight: 9,
    keywords: ["robot", "openvla", "vision-language-action", "vla", "embodied", "policy"],
  },
  {
    type: "algolia",
    name: "Hacker News · Robotics",
    query: "robotics",
    weight: 2,
    keywords: ["robot", "humanoid", "embodied", "physical ai", "vla"],
  },
  {
    type: "algolia",
    name: "Hacker News · Humanoid",
    query: "humanoid",
    weight: 2,
    keywords: ["humanoid", "robot", "figure", "unitree", "tesla"],
  },
  {
    type: "algolia",
    name: "Hacker News · Embodied AI",
    query: "embodied AI",
    weight: 2,
    keywords: ["embodied", "robot", "vla", "physical ai"],
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
    accounts: [
      { handle: "drfeifei", label: "李飞飞", type: "人物" },
      { handle: "demishassabis", label: "Demis Hassabis", type: "人物" },
      { handle: "GoogleDeepMind", label: "Google DeepMind", type: "机构" },
      { handle: "Figure_robot", label: "Figure", type: "机构" },
      { handle: "UnitreeRobotics", label: "宇树科技", type: "机构" },
    ],
  },
];
