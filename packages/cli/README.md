# @astandrik/codex-pets

Install approved pets from the Codex Pets gallery into Codex, or run a local
stdio MCP server that proxies the public gallery endpoints.

```sh
npx @astandrik/codex-pets install zero-two-2
```

The CLI reads the public manifest from `https://pets.ydb-qdrant.tech` by
default and writes files into `${CODEX_HOME:-~/.codex}/pets/<slug>/`.
If Codex is already running, restart it before selecting the new pet in
Settings -> Appearance -> Pets.

## Commands

```sh
codex-pets list
codex-pets install <slug>
codex-pets install <slug> --force
codex-pets install <slug> --url https://pets.ydb-qdrant.tech
codex-pets mcp
codex-pets mcp --url https://pets.ydb-qdrant.tech
```

Set `CODEX_PETS_URL` to point at another deployment.

## Local MCP server

Run a local stdio MCP server:

```sh
npx @astandrik/codex-pets mcp
```

This local process serves the same read-only tools as the public remote server,
but fetches live data from the configured gallery URL.

Example MCP client config:

```json
{
  "mcpServers": {
    "codexPetsLocal": {
      "command": "npx",
      "args": ["-y", "@astandrik/codex-pets", "mcp"]
    }
  }
}
```
