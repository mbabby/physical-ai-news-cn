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
