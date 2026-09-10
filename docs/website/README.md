# Static website

`docs/website/` contains the fx-devkit homepage, shared visual theme, and a small static
site generator. Documentation is rendered only from approved user-facing Markdown;
there is no second copy of feature documentation to maintain. The browser needs
no framework, backend, external fonts, or runtime CDN.

## Build and preview

From the fx-devkit repository root:

```sh
npm --prefix docs/website ci
npm run site:build
npm run site:check
npm run site:dev
```

The preview serves `docs/website/dist/` at `http://127.0.0.1:4173`. Stop it with Ctrl+C.
Rebuild after editing source; the preview server serves the updated files.
Deploy the contents of `docs/website/dist/` to any static host with directory indexes.
It is separate from the CLI's `dist/` and excluded from the npm package.
Personal hosting bindings are not tracked in this repository.
For hosts that support it, configure `404.html` as the custom error document.

## GitHub Pages deployment

GitHub Pages is the deployment baseline. `.github/workflows/pages.yml` checks
pull requests and pushes; only a run on the repository's default branch can deploy.
It builds the CLI reference, checks the website at both `/` and `/fx-devkit/`,
then uses Pages metadata to rebuild for the actual origin and base path. Only
`docs/website/dist/` is uploaded. The deploy job uses `pages: write` and `id-token: write`,
with the `github-pages` environment. It does not publish the npm package.

After the public GitHub repository exists, enable **Settings → Pages → Build and
deployment → Source → GitHub Actions**. Confirm the environment's deployment branch
rules. Package metadata follows the `oa-cli` convention: the inferred repository is
`https://github.com/AngelMsger/fx-devkit` and the homepage is
`https://angelmsger.github.io/fx-devkit/`. These addresses are configured targets;
the build does not create a remote or provision the website.
See [GitHub's custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

For another static host, set `SITE_BASE_PATH` to `/` or a slash-delimited repository
path ending in `/`. Optional `SITE_ORIGIN` is the trusted origin without a path.
When set, the build emits canonical URLs, hreflang alternates, a sitemap and robots
metadata. Relative navigation and assets work without an origin. For example:

```sh
SITE_BASE_PATH=/fx-devkit/ SITE_ORIGIN=https://example.github.io npm run site:build
npm run site:check
npm run site:dev
```

The preview server reads the base from the built manifest. Restart it when changing
the base path. `404.html` uses that same base for assets and recovery links, even
when served for a deeply nested missing URL. `.nojekyll` is emitted. No SPA rewrite,
Node.js runtime, proprietary hostname, or Sites registration is required to serve
the result. Personal preview bindings must stay outside the repository and are never packaged.

## Languages and translation coverage

| Language            | Route prefix |
| ------------------- | ------------ |
| English             | `/`          |
| Japanese            | `/ja/`       |
| Simplified Chinese  | `/zh-Hans/`  |
| Traditional Chinese | `/zh-Hant/`  |

English is the default language. The site root and unprefixed documentation
routes always serve English, including under a GitHub Pages repository subpath.
Do not redirect based on browser language, geolocation, or a remembered preference.
Other languages are selected explicitly through their URLs or the language menu.
The `x-default` alternate points to the English equivalent.

The language switch opens the equivalent page. All four versions have localized
homepage copy, navigation, metadata, copy feedback, motion controls and error
recovery navigation. English remains the canonical technical source.

The site is for fx users. Localized bodies cover introduction, getting started,
manifest setup, data and credentials, support/updates and changelog. The generated
CLI and agent reference pages retain English bodies with explicit language notices.
Maintainer and publishing guides have no public site routes or localized entries.

UI copy lives in `i18n/<locale>.json`; translated guides live in the matching locale
directory. `i18n/translations.json` explicitly records the canonical source and
its SHA-256 at translation review. The build fails if a translated source changes.
Review the language versions first, then update the recorded source digest; never
refresh hashes blindly. `_catalog_sha256` similarly tracks the English UI catalog.
Missing keys and missing page metadata also fail the build. Explicit Markdown
heading IDs (`{#install}`) retain stable cross-language section links.

## Content ownership

- `src/home.html`: product positioning, feature summaries and homepage links.
- `src/site.css`: shared typography, responsive layouts and motion.
- `src/site.js`: optional command-demo tabs, copy buttons and mobile navigation.
- `src/probe.js`: homepage-only pointer inspection lattice and terminal frame response.
- `i18n.mjs` and `i18n/`: locale definitions, UI catalogs and reviewed translations.
- `public-links.mjs`: resolve the project’s public links locally for each language.
- `paths.mjs`: origin-root and repository-subpath routing.
- `pages.mjs`: public page inventory, navigation, route, description and canonical
  Markdown path. Only add user documents accepted by `audience.mjs`.
- `audience.mjs`: explicit user-source allowlist and public-content checks.
- `build.mjs`: Markdown rendering, page shell, relative link rewriting and output.
- `check.mjs`: checks generated routes, anchors and local assets, plus JavaScript
  syntax and source freshness. A broken internal link fails the check; focused probe tests also verify scheduling,
  pointer capability changes and motion cancellation.

Build state is written to the ignored `.build-state.json` outside `dist/`. It is
used locally for freshness checks and preview configuration and must never ship.

Change the canonical user Markdown, then rebuild. Do not edit `docs/website/dist/` by hand.
The homepage must describe the same current behavior as the CLI and documentation.
Keep plans, pre-release availability and platform acceptance limits explicit.
The terminal demo is illustrative, not a live connection or exact output fixture.

Use the locale catalogs and translated guides for public-facing text. Keep code,
command identifiers and the canonical technical references in English. Keep
examples fictional. Before adding a route, review its source for public suitability;
team manifests, live transcripts and private evaluation data must never be exported.
Raw HTML from Markdown is escaped. Mermaid source is displayed in a readable code
block with a copy button, without a third-party browser runtime.

## Accessibility and motion

Pages include semantic navigation, a skip link, visible keyboard focus, responsive
code/table scrolling and usable content without JavaScript. The homepage command
tabs support arrow keys, Home and End. Copy buttons report success or select the
text when clipboard access is unavailable. Mobile documentation navigation supports
Escape. Motion honors `prefers-reduced-motion` and has an explicit pause control.
The homepage's pointer probe snaps to the existing 52px workspace lattice,
connecting a terminal-side origin to a selected cell with orthogonal traces.
Small cross marks, cell brackets and a coordinate caption make the effect read
like an inspection tool. Only the terminal's background frame shifts (at most
6px horizontally and 4px vertically); the terminal text and controls stay still.
The native pointer is preserved and the decorative canvas never intercepts input.

The probe runs only on fine, hover-capable pointers. It stops on pointer exit,
scroll, resize, loss of focus, a hidden tab, or the global motion pause. Reduced
motion and touch input disable it. Animation frames stop once the pointer settles;
canvas pixel density is capped at 2. Coordinates exist only in page memory and
are never stored or transmitted. Documentation pages do not load the probe.
Keep these behaviors when changing the theme or interactions.

## Documentation consistency

A change to a feature, command, configuration, default, compatibility guarantee or
design contract must update the matching external documentation in the same change.
Update homepage claims and page descriptions when affected. Regenerate CLI reference
with `npm run docs:gen` after CLI changes, then run `npm run site:build` and
`npm run site:check`. Repository-wide contributor requirements live in
[AGENTS.md](../../AGENTS.md).
