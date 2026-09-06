import { Router, type IRouter } from "express";
import { CheckBuilderConnectionResponse, StartAndroidBuildBody, StartAndroidBuildResponse } from "@workspace/api-zod";
import { buildOnAndroid, buildTimeline, connectToBuilder, validateAndroidZipPath } from "../lib/builder";
import { McpClientError, sanitizeDiagnostics } from "../lib/mcp-client";

const router: IRouter = Router();

function safeError(error: unknown, fallback: string, state: "CONNECTING_TO_TERMUX" | "FAILED") {
  if (error instanceof McpClientError) {
    return {
      error: error.message,
      code: error.code,
      state,
      diagnostics: sanitizeDiagnostics(error.diagnostics),
    };
  }
  return { error: fallback, code: "INTERNAL_ERROR", state, diagnostics: [] };
}

router.get("/builder/connection", async (req, res) => {
  try {
    const result = await connectToBuilder();
    const data = CheckBuilderConnectionResponse.parse({
      connected: true,
      status: "connected",
      tools: result.tools,
      checkedAt: new Date().toISOString(),
      environment: undefined,
    });
    res.json(data);
  } catch (error) {
    req.log.warn({ code: error instanceof McpClientError ? error.code : "INTERNAL_ERROR" }, "Android Builder connection check failed");
    res.status(error instanceof McpClientError && error.status ? error.status === 401 || error.status === 403 ? 502 : error.status : 502).json(safeError(error, "Android Builder is offline.", "CONNECTING_TO_TERMUX"));
  }
});

router.post("/builder/build", async (req, res) => {
  const parsed = StartAndroidBuildBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Provide a valid Android ZIP path. A Replit upload is not automatically available on the phone.",
      code: "INVALID_BUILD_INPUT",
      state: "FAILED",
      diagnostics: [],
    });
    return;
  }
  try {
    const androidZipPath = validateAndroidZipPath(parsed.data.androidZipPath);
    const result = await buildOnAndroid(androidZipPath, parsed.data.developerMode);
    res.json(StartAndroidBuildResponse.parse(result));
  } catch (error) {
    req.log.warn({ code: error instanceof McpClientError ? error.code : "INTERNAL_ERROR" }, "Android build failed");
    const status = error instanceof McpClientError && error.code === "MCP_TIMEOUT" ? 504 : error instanceof McpClientError && error.code.startsWith("INVALID_") ? 400 : 502;
    res.status(status).json(safeError(error, "The Android build could not be completed.", "FAILED"));
  }
});

export default router;