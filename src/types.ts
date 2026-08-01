export type ArticleKind = "产品发布" | "公司商业" | "部署案例" | "开源项目" | "研究与数据";

export interface Article {
  id: string;
  title: string;
  link: string;
  publishedAt: Date;
  fetchedAt: Date;
  source: string;
  sourceWeight: number;
  excerpt: string;
  kind?: ArticleKind;
  tags: string[];
  titleZh?: string;
  summaryZh?: string;
  score?: number;
}

interface BaseSourceConfig {
  name: string;
  weight: number;
  keywords: string[];
}

export interface RssSourceConfig extends BaseSourceConfig {
  type: "rss";
  url: string;
}

export interface AlgoliaSourceConfig extends BaseSourceConfig {
  type: "algolia";
  query: string;
}

export type SourceConfig = RssSourceConfig | AlgoliaSourceConfig;

export interface FetchFailure {
  source: string;
  reason: string;
}

export interface DigestResult {
  articles: Article[];
  failures: FetchFailure[];
}

export interface LlmSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
