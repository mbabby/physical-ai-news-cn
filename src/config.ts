import type { SourceConfig } from "./types.js";

export const DEFAULT_WINDOW_HOURS = 24;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_DAILY_ARTICLES = 10;

// RSS/Atom 源以官方发布为主；HN 补充社区最早讨论。可通过 PR 扩充。
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
    type: "algolia",
    name: "Hacker News · Robotics",
    query: "robotics",
    weight: 4,
    keywords: ["robot", "humanoid", "embodied", "physical ai", "vla"],
  },
  {
    type: "algolia",
    name: "Hacker News · Humanoid",
    query: "humanoid",
    weight: 4,
    keywords: ["humanoid", "robot", "figure", "unitree", "tesla"],
  },
  {
    type: "algolia",
    name: "Hacker News · Embodied AI",
    query: "embodied AI",
    weight: 4,
    keywords: ["embodied", "robot", "vla", "physical ai"],
  },
];
