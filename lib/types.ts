// Shared types for the AI Visibility Fix Engine MVP

export interface PageFindings {
  url: string;
  title: string;
  metaDescription: string;
  h1s: string[];
  phones: string[];
  emails: string[];
  hasLocalBusinessSchema: boolean;
  hasFaqSchema: boolean;
  fetchError?: string;
}

export interface CrawlResult {
  url: string;
  pages: PageFindings[];
  napMismatches: string[];
  robotsTxt: { found: boolean; blocksAiBots: string[]; note?: string };
  llmsTxt: { found: boolean; preview?: string };
  lang?: string;
  nonEnglish?: boolean;
  blocked?: boolean;
  errors: string[];
  crawledAt: string;
}

export type Verdict = "invisible" | "mentioned" | "recommended";

export interface ProbeResult {
  question: string;
  answer: string;
  verdict: Verdict;
  accuracyNote: string;
  mock?: boolean;
}

export type FixArtifact =
  | "gbp_description"
  | "faqs"
  | "llms_txt"
  | "robots_txt"
  | "json_ld"
  | "nap"
  | "probe";

export interface Fix {
  title: string;
  why: string;
  effort: "5 min" | "30 min";
  impact: "High" | "Med";
  artifact: FixArtifact;
  content: string;
}

export interface BusinessInput {
  url: string;
  name: string;
  city: string;
  category: string;
}

export interface Report {
  id: string;
  createdAt: string;
  business: BusinessInput;
  score: number;
  crawl: CrawlResult;
  probes: ProbeResult[];
  fixes: Fix[];
  /** true when LLM steps were stubbed (no GEMINI_API_KEY) */
  mock: boolean;
}
