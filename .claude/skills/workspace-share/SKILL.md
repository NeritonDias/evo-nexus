# workspace-share

**Description:** Create, list, or revoke public share links for workspace files. Use when the user says "share this file", "create a public link", "share the dashboard", "compartilha esse arquivo", "list my share links", "revoke share link", or wants to share a report/HTML with someone external.

## Trigger

Use this skill when the user wants to:
- Share a workspace file with an external person
- Generate a public URL for a file (report, dashboard, HTML, markdown)
- List or manage active share links
- Revoke a share link

## Actions

### 1. Create share link

Accepts a file path (explicit or resolved from context, e.g., "today's dashboard").

**Smart resolution:** If the user says "share the financial pulse" or "share today's report", search `workspace/` for the most recent matching file (e.g., `workspace/finance/*pulse*.html`) and confirm with the user before sharing.

```bash
curl -s -X POST http://localhost:8080/api/shares \
  -H "Authorization: Bearer $DASHBOARD_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path": "<repo-relative-path>", "expires_in": "7d"}'
```

`expires_in` options: `"1h"`, `"24h"`, `"7d"`, `"30d"`, or `null` (no expiration).

Returns `{ token, url, expires_at }`. Present the `url` to the user — this is the public link.

### 2. List active shares

```bash
curl -s http://localhost:8080/api/shares \
  -H "Authorization: Bearer $DASHBOARD_API_TOKEN"
```

Returns `{ shares: [...] }`. Format as a readable table showing: file path, created by, created at, expires at, views, status.

### 3. Revoke share

Accepts a token or identifies the share from context (e.g., file path).

```bash
curl -s -X DELETE http://localhost:8080/api/shares/<token> \
  -H "Authorization: Bearer $DASHBOARD_API_TOKEN"
```

Confirm with the user before revoking (the link becomes immediately inaccessible).

## Auth

Uses `DASHBOARD_API_TOKEN` environment variable for Bearer auth. This is the same token used by other dashboard-calling skills. The token is pre-configured in `.env`.

## Notes

- Only files inside `workspace/` can be shared (no admin paths)
- HTML files render natively in the browser (no login required)
- Markdown and code files are rendered by the EvoNexus share viewer
- Each view is counted and logged in the audit trail
