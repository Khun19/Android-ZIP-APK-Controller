# ZIP → APK Builder

A secure web controller that validates Android ZIP paths and drives an authenticated Termux MCP server while the real Gradle build stays on the Android phone.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required server configuration: `TERMUX_MCP_URL` and the `TERMUX_MCP_TOKEN` Replit Secret; see `docs/termux-mcp.md`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/zip-apk-builder/src/` — phone-first controller UI
- `artifacts/api-server/src/lib/mcp-client.ts` — Streamable HTTP MCP transport, JSON-RPC handling, timeouts, and redaction
- `artifacts/api-server/src/lib/builder.ts` — Android path validation and build/output orchestration
- `artifacts/api-server/src/routes/builder.ts` — connection test and build endpoints
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract
- `docs/termux-mcp.md` — configuration, security boundary, and Quick Tunnel limitation

## Architecture decisions

- Android compilation never runs in Replit; the backend is only a server-side MCP controller.
- Browser-selected ZIP bytes are never sent to the backend or treated as an Android path.
- Only the four allowlisted MCP tools can be called, and the token is read only on the server.
- APK output metadata is accepted only after `build_project` and `list_apk_outputs` agree; filenames are never assumed.

## Product

- Verify API health and authenticated Android Builder connectivity.
- Validate a real phone-side ZIP path and start a long-running Gradle build through MCP.
- Show safe connection/build errors, progress timeline, developer diagnostics, and verified APK metadata.
- Keep download/install controls hidden unless a real supported artifact route is returned.

## User preferences

- Keep the Android transfer boundary explicit; never fabricate end-to-end upload behavior.

## Gotchas

- Quick Tunnel URLs are temporary; configure `TERMUX_MCP_URL` server-side and update it when the tunnel changes.
- Use `/sdcard/...` or `/storage/emulated/0/...` ZIP paths only; Replit paths are not Android paths.
- Run API codegen after editing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
