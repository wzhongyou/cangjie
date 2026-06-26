import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';

const definition: ToolDefinition = {
  name: 'web_search',
  description:
    '搜索网络获取最新信息。返回标题、URL 和摘要。适合查阅最新文档、错误信息、技术方案等。当前使用 DuckDuckGo 搜索（无需 API Key）。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      allowed_domains: {
        type: 'array',
        items: { type: 'string' },
        description: '限定搜索域名（可选），如 ["github.com", "stackoverflow.com"]',
      },
    },
    required: ['query'],
  },
};

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 使用 DuckDuckGo Instant Answer API（非官方，但无需 API Key）。
 * 注意：这是 HTML 即时回答接口，不是完整的网页搜索。
 * 作为轻量实现，避免引入 Google/Bing API Key 依赖。
 */
async function duckduckgoSearch(query: string, maxResults = 10): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Cangjie/1.0 (code-agent)',
        Accept: 'text/html',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // 解析 DuckDuckGo HTML 搜索结果
    const results: SearchResult[] = [];

    // 匹配每个搜索结果块
    const resultRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = match[1].replace(/&amp;/g, '&').replace(/</g, '<').replace(/>/g, '>');
      const title = match[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .trim();
      const snippet = match[3]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .trim();

      if (title && rawUrl) {
        results.push({ title, url: rawUrl, snippet });
      }
    }

    // 备用解析（如果上面的正则不匹配 DuckDuckGo 的新格式）
    if (results.length === 0) {
      const altRegex = /<a[^>]*rel="nofollow"[^>]*class="[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null && results.length < maxResults) {
        const rawUrl = match[1];
        const title = match[2]
          .replace(/<[^>]+>/g, '')
          .replace(/&[^;]+;/g, '')
          .trim();
        if (title && rawUrl && !rawUrl.startsWith('//duckduckgo.com')) {
          results.push({ title, url: rawUrl, snippet: '' });
        }
      }
    }

    return results;
  } finally {
    clearTimeout(timeout);
  }
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = (args.query as string)?.trim();
  if (!query) {
    return { content: 'web_search: 缺少 query 参数', error: 'invalid_args' };
  }

  const allowedDomains = args.allowed_domains as string[] | undefined;

  try {
    const results = await duckduckgoSearch(query);

    if (results.length === 0) {
      return { content: `未找到 "${query}" 的搜索结果。` };
    }

    let filtered = results;
    if (allowedDomains?.length) {
      filtered = results.filter((r) =>
        allowedDomains.some((d) => {
          try {
            return new URL(r.url).hostname.includes(d);
          } catch {
            return false;
          }
        }),
      );
    }

    if (filtered.length === 0) {
      return {
        content: `搜索 "${query}" 有 ${results.length} 个结果，但没有匹配指定域名 ${allowedDomains!.join(', ')} 的结果。`,
      };
    }

    const lines = [`搜索 "${query}" 找到 ${filtered.length} 个结果：`, ''];
    for (let i = 0; i < filtered.length; i++) {
      const r = filtered[i];
      lines.push(`${i + 1}. **${r.title}**`);
      lines.push(`   ${r.url}`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
      lines.push('');
    }

    return { content: lines.join('\n') };
  } catch (err: any) {
    return { content: `web_search: 搜索失败: ${err.message}`, error: 'search_error' };
  }
}

export const webSearchTool: Tool = { definition, execute };
