import type { Tool, ToolContext, ToolDefinition, ToolResult } from '@cangjie/shared';

const definition: ToolDefinition = {
  name: 'web_fetch',
  description: '获取网页内容并转为 Markdown 文本。适合查阅在线文档、API 参考、博客文章等。HTTP 自动升级为 HTTPS。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要获取的网页 URL' },
      prompt: {
        type: 'string',
        description: '针对页面内容的提问（可选，传入后会对内容做针对性提取）',
      },
    },
    required: ['url'],
  },
};

/** 简单的 HTML 到纯文本转换（不依赖外部包） */
function htmlToText(html: string, maxLength = 100_000): string {
  // 去掉 script 和 style 标签及其内容
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');

  // 常见标签 → 换行
  text = text.replace(/<\/(div|p|h[1-6]|li|tr|article|section|header|footer|main|nav)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr[^>]*>/gi, '\n---\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');

  // 去掉所有标签
  text = text.replace(/<[^>]+>/g, '');

  // 解码 HTML 实体
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

  // 合并连续空行
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');

  // 裁剪
  const lines = text.split('\n').map((l) => l.trim());
  const filteredLines: string[] = [];
  let emptyCount = 0;
  for (const line of lines) {
    if (!line) {
      emptyCount++;
      if (emptyCount <= 2) filteredLines.push('');
    } else {
      emptyCount = 0;
      filteredLines.push(line);
    }
  }

  let result = filteredLines.join('\n').trim();
  if (result.length > maxLength) {
    result = `${result.slice(0, maxLength)}\n\n... [内容已截断，原文共 ${result.length} 字符]`;
  }
  return result;
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const url = (args.url as string)?.trim();
  if (!url) {
    return { content: 'web_fetch: 缺少 url 参数', error: 'invalid_args' };
  }

  // 协议检查：只允许 http/https
  let fetchUrl: string;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { content: `web_fetch: 不支持的协议: ${parsed.protocol}。只支持 http/https。`, error: 'invalid_url' };
    }
    // HTTP → HTTPS 自动升级
    fetchUrl = parsed.toString();
    if (parsed.protocol === 'http:') {
      fetchUrl = `https:${fetchUrl.slice(5)}`;
    }
  } catch {
    return { content: `web_fetch: 无效的 URL: ${url}`, error: 'invalid_url' };
  }

  const prompt = args.prompt as string | undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Cangjie/1.0 (code-agent)',
        Accept: 'text/html, text/plain, application/xhtml+xml',
        'Accept-Language': 'zh-CN, en;q=0.9',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        content: `web_fetch: HTTP ${response.status} ${response.statusText}`,
        error: 'http_error',
      };
    }

    const contentType = response.headers.get('content-type') || '';
    let body: string;

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const html = await response.text();
      body = htmlToText(html);
    } else if (contentType.includes('text/plain') || contentType.includes('application/json')) {
      body = await response.text();
    } else {
      // 尝试作为文本读取
      body = await response.text();
    }

    let result = `## ${fetchUrl}\n\n${body}`;

    // 如果提供了 prompt，在前面加说明
    if (prompt) {
      result = `问题: ${prompt}\n\n---\n\n${result}`;
    }

    // 限制总输出
    if (result.length > 100_000) {
      result = `${result.slice(0, 100_000)}\n\n... [已截断]`;
    }

    return { content: result };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { content: `web_fetch: 请求超时 (15s)`, error: 'timeout' };
    }
    return { content: `web_fetch: 请求失败: ${err.message}`, error: 'fetch_error' };
  }
}

export const webFetchTool: Tool = { definition, execute };
