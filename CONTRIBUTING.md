# Contributing to fx-devkit

Start with a small reproducible problem or a concrete improvement. Bug fixes,
documentation, translations and provider work are welcome. For a substantial
behavior or architecture change, open an issue first to explain the use case and
proposed contract.

## Local setup

Use the Node.js and npm versions pinned in package.json, Git, and Bun for the
alternative-runtime checks. In your checkout:

```sh
npm ci
npm --prefix docs/website ci
npm run build
node bin/fx.js --help
```

The CLI and website have separate dependencies and output directories. Run
`npm run site:build` and `npm run site:dev` to preview the static site. See the
[website guide](docs/website/README.md) for hosting and multilingual content.

## Make a focused change

1. Read [AGENTS.md](AGENTS.md) and the relevant [design contract](docs/design/README.md).
2. Preserve existing working changes. Work in the target checkout or a worktree.
3. Add focused regression coverage for changed behavior, ownership or recovery.
4. Update the public guide and relevant translations in the same change. Mark
   planned behavior explicitly; do not describe an unfinished feature as available.
5. For command changes, run `npm run docs:gen`. Review translation source digests
   only after checking the corresponding language versions.

Do not include live manifests, credentials, personnel information, private service
coordinates or trial transcripts. Use fictional examples and isolated fixtures.
Report security issues through [SECURITY.md](SECURITY.md).

## Validate

```sh
npm run lint
npm run typecheck
npm test
npm run test:bun
npm run test:e2e
npm run docs:check
npm run site:build
npm run site:check
node scripts/check-package.mjs
```

Live companion tests are opt-in. GitHub Actions runs these checks on every pull
request; native Windows acceptance (`npm run check:windows`) runs on demand. Record
unavailable checks accurately. Passing a local test is not proof of remote access
or native host activation. See [validation](docs/validation.md).

## Submit a pull request

Fork [AngelMsger/fx-devkit](https://github.com/AngelMsger/fx-devkit), push a branch
to your fork and open a pull request against `main`. Use a concise Conventional Commit subject;
include an issue reference when one is available and appropriate for public history.

Describe the problem, resulting behavior, validation and any remaining limits.
Link the relevant issue and explain intentional compatibility changes. Keep
unrelated refactors, generated build output and local configuration out of the PR.
The project uses [Apache-2.0](LICENSE).
