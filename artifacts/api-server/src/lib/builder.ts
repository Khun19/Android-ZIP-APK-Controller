import { McpClientError, requiredMcpTools, sanitizeDiagnostics, TermuxMcpClient } from "./mcp-client";

const pathPattern = /^\/(?:storage\/emulated\/0|sdcard)\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9 _.,()@+\-/]+\.zip$/i;

export function validateAndroidZipPath(value: unknown): string {
  if (typeof value !== "string" || value.length < 5 || value.length > 512 || !pathPattern.test(value)) {
    throw new McpClientError(
      "Enter a ZIP path that already exists on the Android phone, such as /sdcard/Download/project.zip.",
      "INVALID_ANDROID_ZIP_PATH",
    );
  }
  return value;
}

export function buildTimeline(state: "SUCCESS" | "FAILED") {
  const failed = state === "FAILED";
  return [
    { state: "CONNECTING_TO_TERMUX" as const, label: "Connecting to Android", status: failed ? "failed" as const : "complete" as const },
    { state: "ANALYZING" as const, label: "Checking project", status: failed ? "failed" as const : "complete" as const },
    { state: "BUILDING" as const, label: "Running Gradle on phone", status: failed ? "failed" as const : "complete" as const },
    { state: "VALIDATING_APK" as const, label: "Validating APK output", status: failed ? "failed" as const : "complete" as const },
  ];
}

export async function connectToBuilder() {
  const client = new TermuxMcpClient();
  await client.initialize();
  const tools = await client.listTools();
  const missing = requiredMcpTools.filter((tool) => !tools.includes(tool));
  if (missing.length) {
    throw new McpClientError(
      "Android Builder is missing required capabilities.",
      "MCP_REQUIRED_TOOLS_MISSING",
      { diagnostics: [`Missing tools: ${missing.join(", ")}`] },
    );
  }
  const health = await client.callTool("health_check", {}, 15_000);
  return { client, tools: requiredMcpTools, health: health.data };
}

type OutputRecord = Record<string, unknown>;

function asRecords(value: unknown): OutputRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is OutputRecord => Boolean(item && typeof item === "object"));
  if (value && typeof value === "object") {
    const record = value as OutputRecord;
    for (const key of ["outputs", "artifacts", "files", "apkOutputs"]) {
      if (Array.isArray(record[key])) return asRecords(record[key]);
    }
  }
  return [];
}

function findStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(findStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(findStrings);
  return [];
}

function outputPath(output: OutputRecord): string | undefined {
  for (const key of ["phonePath", "path", "filePath", "filename", "name"]) {
    if (typeof output[key] === "string" && String(output[key]).toLowerCase().endsWith(".apk")) return String(output[key]);
  }
  return undefined;
}

export function selectNewestApk(buildData: unknown, outputsData: unknown): OutputRecord {
  const outputs = asRecords(outputsData)
    .map((output) => ({ output, path: outputPath(output) }))
    .filter((item): item is { output: OutputRecord; path: string } => Boolean(item.path));
  if (!outputs.length) {
    throw new McpClientError("The Android Builder did not report a verified APK output.", "APK_OUTPUT_MISSING");
  }

  const buildHints = findStrings(buildData).filter((value) => value.toLowerCase().includes(".apk"));
  const consistent = buildHints.length
    ? outputs.filter(({ path }) => buildHints.some((hint) => hint.includes(path) || path.includes(hint) || hint.endsWith(path.split("/").at(-1) ?? "")))
    : outputs;
  if (!consistent.length) {
    throw new McpClientError("The reported APK output did not match the completed build.", "APK_OUTPUT_MISMATCH");
  }
  if (!buildHints.length && !consistent.some(({ output }) => ["generatedAt", "createdAt", "mtime", "modifiedAt"].some((key) => output[key]))) {
    throw new McpClientError("The Android Builder did not provide enough output metadata to verify the newest APK.", "APK_OUTPUT_UNVERIFIED");
  }
  const newest = [...consistent].sort((left, right) => {
    const leftDate = Date.parse(String(left.output.generatedAt ?? left.output.createdAt ?? left.output.mtime ?? left.output.modifiedAt ?? 0));
    const rightDate = Date.parse(String(right.output.generatedAt ?? right.output.createdAt ?? right.output.mtime ?? right.output.modifiedAt ?? 0));
    return rightDate - leftDate;
  })[0];
  if (!newest) throw new McpClientError("The Android Builder did not report a usable APK output.", "APK_OUTPUT_MISSING");
  return newest.output;
}

function stringValue(record: OutputRecord, keys: string[]): string | undefined {
  const value = keys.map((key) => record[key]).find((item) => typeof item === "string");
  return typeof value === "string" ? value : undefined;
}

export async function buildOnAndroid(androidZipPath: string, developerMode = false) {
  const { client } = await connectToBuilder();
  const build = await client.callTool("build_project", { zip_path: androidZipPath }, 10 * 60_000);
  const outputs = await client.callTool("list_apk_outputs", {}, 30_000);
  const artifact = selectNewestApk(build.data, outputs.data);
  const phonePath = outputPath(artifact) ?? stringValue(artifact, ["path", "filePath"]);
  const filename = stringValue(artifact, ["filename", "name"]) ?? phonePath?.split("/").at(-1);
  if (!filename) throw new McpClientError("The Android Builder returned an APK without a filename.", "APK_FILENAME_MISSING");
  const generatedAt = stringValue(artifact, ["generatedAt", "createdAt", "modifiedAt"]) ?? new Date().toISOString();
  const logs = developerMode
    ? sanitizeDiagnostics(findStrings(build.data).filter((line) => line.length < 2000))
    : [];
  return {
    state: "SUCCESS" as const,
    message: "APK Ready",
    artifact: {
      filename,
      phonePath,
      sizeBytes: typeof artifact.sizeBytes === "number" ? artifact.sizeBytes : typeof artifact.size === "number" ? artifact.size : null,
      generatedAt,
      status: stringValue(artifact, ["status"]) ?? "verified",
      sha256: stringValue(artifact, ["sha256", "sha256Hash"]) ?? null,
      downloadUrl: null,
    },
    timeline: buildTimeline("SUCCESS"),
    logs,
  };
}