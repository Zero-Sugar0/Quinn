import { tavily } from '@tavily/core';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const searchDeclarations = [
  {
    name: 'web_search',
    description:
      'Search the web using Tavily — a search engine built for AI agents. Returns clean, relevant results with titles, URLs, and content snippets. Also provides an AI-synthesized answer when available. Use this whenever you need current information, facts, news, documentation, or anything that requires looking things up.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query. Be specific and natural, e.g. "latest Node.js LTS version 2025" or "how to configure nginx reverse proxy".',
        },
        depth: {
          type: Type.STRING,
          enum: ['basic', 'advanced'],
          description: 'Search depth. "basic" is faster; "advanced" gives deeper, more thorough results. Default: basic.',
        },
        max_results: {
          type: Type.INTEGER,
          description: 'Number of results to return (1-10). Default: 5.',
        },
        include_domains: {
          type: Type.STRING,
          description: 'Comma-separated list of domains to restrict results to, e.g. "github.com,docs.python.org".',
        },
        topic: {
          type: Type.STRING,
          enum: ['general', 'news'],
          description: 'Search topic type. Use "news" for recent news stories. Default: general.',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'extract_webpage',
    description:
      'Extract the full readable text content from one or more web pages. Strips HTML, ads, and boilerplate — returns clean article/documentation content. Use this after web_search to read the full content of a specific page, or when the user gives you a URL and wants you to read it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        urls: {
          type: Type.STRING,
          description: 'Comma-separated list of URLs to extract content from, e.g. "https://docs.python.org/3/library/os.html" or multiple: "https://a.com,https://b.com".',
        },
      },
      required: ['urls'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
function getClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY is not set. Get a free key at https://tavily.com and set: export TAVILY_API_KEY="tvly-..."'
    );
  }
  return tavily({ apiKey });
}

export async function executeSearchTool(name, args) {
  const client = getClient();

  switch (name) {
    case 'web_search': {
      const maxResults = Math.min(args.max_results ?? 5, 10);
      const includeDomains = args.include_domains
        ? args.include_domains.split(',').map((d) => d.trim()).filter(Boolean)
        : undefined;

      const response = await client.search(args.query, {
        searchDepth: args.depth ?? 'basic',
        maxResults,
        includeAnswer: true,
        includeDomains,
        topic: args.topic ?? 'general',
      });

      return {
        query: args.query,
        answer: response.answer ?? null,
        results: (response.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
          score: r.score,
          published_date: r.publishedDate ?? null,
        })),
        count: response.results?.length ?? 0,
      };
    }

    case 'extract_webpage': {
      const urls = args.urls
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);

      if (urls.length === 0) throw new Error('No URLs provided.');
      if (urls.length > 5) throw new Error('Maximum 5 URLs per extraction call.');

      const response = await client.extract(urls);

      const results = (response.results ?? []).map((r) => ({
        url: r.url,
        content: r.rawContent?.slice(0, 8000) ?? '',  // cap at 8k chars
        content_length: r.rawContent?.length ?? 0,
        truncated: (r.rawContent?.length ?? 0) > 8000,
      }));

      const failed = response.failedResults ?? [];

      return {
        extracted: results,
        failed: failed.map((f) => ({ url: f.url, error: f.error })),
        success_count: results.length,
        fail_count: failed.length,
      };
    }

    default:
      throw new Error(`Unknown search tool: ${name}`);
  }
}