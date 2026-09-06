# Termux MCP configuration

ZIP → APK Builder is a controller, not an Android compiler. The browser talks to the Replit API, and the API makes authenticated Streamable HTTP MCP requests to the Termux server running on the Android phone. Gradle, Java 17, and the Android SDK remain on the phone.

## Required server configuration

Set these server-side values:

- `TERMUX_MCP_URL` — the complete MCP endpoint, including `/mcp`
- `TERMUX_MCP_TOKEN` — the Termux MCP bearer token, stored as a Replit Secret

The default development URL is `https://added-trains-beer-latex.trycloudflare.com/mcp`, but it is configured through `TERMUX_MCP_URL`; it is never placed in browser code. The token is never sent to the browser, logged, placed in a URL, stored in local storage, or returned in an API response.

## Supported MCP surface

The controller initializes the MCP session, sends the initialized notification, lists tools, verifies these required tools, and then calls only:

- `health_check`
- `get_environment`
- `list_apk_outputs`
- `build_project`

Build requests use the Android phone path supplied by the user. The path must be under `/sdcard` or `/storage/emulated/0`, end in `.zip`, and contain no parent traversal. A ZIP selected from the browser is only a local filename cue; it is not uploaded to Android.

## Quick Tunnel limitation

Quick Tunnel URLs are temporary and can change or become unreachable when the Termux session or tunnel stops. If the connection goes offline, start the Termux MCP server and tunnel again, then update `TERMUX_MCP_URL` on the server. This application does not silently fall back to a local URL, a Replit filesystem path, or a fabricated Android path.

## Artifact downloads

The current safe flow reports verified APK metadata and its Android phone path. A download or install action is shown only when the backend returns a real supported artifact route. The controller does not copy APK bytes out of Android without an explicit transport.