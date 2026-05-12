# @astandrik/codex-pets

Install approved pets from the Codex Pets gallery into Codex.

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
```

Set `CODEX_PETS_URL` to point at another deployment.
