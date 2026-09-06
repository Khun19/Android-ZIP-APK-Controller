const REQUIRED_TOOLS = [
  "health_check",
  "get_environment",
  "list_apk_outputs",
  "build_project",
] as const;

export type RequiredToolName = (typeof REQUIRED_TOOLS)[number];

export class McpClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly diagnostics: string[];

  constructor(
    message: string,
    code: string,
    options: { status?: number; diagnostics?: string[] } = {},
  ) {
    super(message);
    this.name = "McpClientError";
    this.code = code;
    this.status = options.status;
    this.diagnostics = sanitizeDiagnostics(options.diagnostics ?? []);
  }
}

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type ToolCallResult = {
  data: unknown;
  isError: boolean;
  raw: unknown;
};

export const requiredMcpTools = [...REQUIRED_TOOLS];

function mcpUrl(): string {
  const value = process.env.TERMUX_MCP_URL?.trim();
  if (!value) {
    throw new McpClientError(
      "Android Builder is not configured.",
      "MCP_URL_MISSING",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new McpClientError(
      "Android Builder endpoint is invalid.",
      "MCP_URL_INVALID",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new McpClientError(
      "Android Builder endpoint must use HTTP or HTTPS.",
      "MCP_URL_INVALID",
    );
  }
  return parsed.toString();
}

function bearerToken(): string {
  const value = process.env.TERMUX_MCP_TOKEN?.trim();
  if (!value) {
    throw new McpClientError(
      "Android Builder credentials are not configured.",
      "MCP_TOKEN_MISSING",
    );
  }
  return value;
}

export function sanitizeDiagnostics(values: string[]): string[] {
  return values
    .map((value) =>
      String(value)
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
        .replace(/(token|authorization|secret|password)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
        .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
          try {
            const parsed = new URL(url);
            return `${parsed.origin}${parsed.pathname}`;
          } catch {
            return "[redacted-url]";
          }
        }),
    )
    .slice(0, 20);
}

function safeText(value: unknown): string {
  if (typeof value === "string") return sanitizeDiagnostics([value])[0] ?? "";
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === "string") return sanitizeDiagnostics([current])[0];
      return current;
    });
  } catch {
    return "";
  }
}

async function parseMcpResponse(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!response.ok) {
    throw new McpClientError(
      response.status === 401 || response.status === 403
        ? "Android Builder authentication was rejected."
        : response.status === 404
          ? "Android Builder endpoint was not found."
          : response.status === 408 || response.status === 504
            ? "Android Builder timed out."
            : response.status === 429
              ? "Android Builder is rate limited."
              : "Android Builder returned an unavailable response.",
      `MCP_HTTP_${response.status}`,
      { status: response.status, diagnostics: [body] },
    );
  }

  if (contentType.includes("text/event-stream")) {
    const events = body
      .split(/\r?\n\r?\n/)
      .flatMap((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim()),
      )
      .filter((line) => line && line !== "[DONE]");
    const last = events.at(-1);
    if (!last) {
      throw new McpClientError("Android Builder returned an empty MCP stream.", "MCP_EMPTY_RESPONSE");
    }
    try {
      return JSON.parse(last) as JsonRpcResponse;
    } catch {
      throw new McpClientError("Android Builder returned an invalid MCP message.", "MCP_INVALID_JSON");
    }
  }

  try {
    return JSON.parse(body) as JsonRpcResponse;
  } catch {
    throw new McpClientError("Android Builder returned an invalid MCP message.", "MCP_INVALID_JSON");
  }
}

export class TermuxMcpClient {
  private id = 0;
  private sessionId?: string;

  private async request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    notification = false,
  ): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken()}`,
        "MCP-Protocol-Version": "2025-03-26",
      };
      if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
      const requestMessage = {
        jsonrpc: "2.0",
        ...(notification ? {} : { id: ++this.id }),
        method,
        ...(params ? { params } : {}),
      };
      const response = await fetch(mcpUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(requestMessage),
        signal: controller.signal,
      });
      this.sessionId = response.headers.get("Mcp-Session-Id") ?? this.sessionId;
      if (notification && (response.status === 202 || response.status === 204)) {
        return { jsonrpc: "2.0" };
      }
      const responseMessage = await parseMcpResponse(response);
      if (responseMessage.error) {
        throw new McpClientError(
          responseMessage.error.message || "Android Builder returned an MCP error.",
          `MCP_RPC_${responseMessage.error.code ?? "UNKNOWN"}`,
          { diagnostics: [safeText(responseMessage.error.data)] },
        );
      }
      return responseMessage;
    } catch (error) {
      if (error instanceof McpClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new McpClientError(
          "Android Builder did not respond in time.",
          "MCP_TIMEOUT",
        );
      }
      throw new McpClientError(
        "Android Builder could not be reached.",
        "MCP_CONNECTION_FAILED",
        { diagnostics: [error instanceof Error ? error.message : String(error)] },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async initialize(): Promise<void> {
    await this.request(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "zip-apk-builder", version: "1.0.0" },
      },
      15_000,
    );
    await this.request("notifications/initialized", undefined, 15_000, true);
  }

  async listTools(): Promise<string[]> {
    const response = await this.request("tools/list", {}, 15_000);
    const tools = (response.result as { tools?: Array<{ name?: unknown }> } | undefined)?.tools;
    if (!Array.isArray(tools)) {
      throw new McpClientError("Android Builder returned no tool list.", "MCP_TOOLS_INVALID");
    }
    return tools
      .map((tool) => (typeof tool.name === "string" ? tool.name : ""))
      .filter(Boolean);
  }

  async callTool(
    name: RequiredToolName,
    args: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<ToolCallResult> {
    const response = await this.request(
      "tools/call",
      { name, arguments: args },
      timeoutMs,
    );
    const result = response.result as { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined;
    if (!result) {
      throw new McpClientError("Android Builder returned no tool result.", "MCP_TOOL_RESULT_MISSING");
    }
    const content = result.structuredContent ?? result.content ?? result;
    if (result.isError) {
      throw new McpClientError(
        `Android Builder tool ${name} failed.`,
        "MCP_TOOL_FAILED",
        { diagnostics: [safeText(content)] },
      );
    }
    return { data: unwrapToolContent(content), isError: false, raw: result };
  }
}

function unwrapToolContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .filter((item): item is { type: string; text?: string } => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  const joined = texts.join("\n").trim();
  if (!joined) return content;
  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}