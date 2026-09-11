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

## Internal Dokploy deployment

The internal website uses `FX_DISTRIBUTION=internal`. Configure the application in Dokploy with
its internal Git source and a read-only deploy key. Use Dockerfile build type,
`docs/website/Dockerfile`, and the repository root (`.`) as build context. The
Dockerfile needs user Markdown from outside the website directory.

The container serves port 80 with directory indexes, a `/healthz` check and actual
404 responses. Only static output is copied into the NGINX runtime. Configure the
internal domain, HTTPS and network/access restrictions in Dokploy. `noindex`
metadata and headers discourage indexing; they do not provide access control.

Build arguments:

- `SITE_ORIGIN`: the internal HTTP(S) origin, without a path or credentials.
- `SITE_REPOSITORY_URL`: optional internal source browser URL, without credentials.
- `SITE_BASE_PATH`: keep `/` for the supplied NGINX container.

```sh
docker build -f docs/website/Dockerfile -t fx-devkit-website:local .
docker run --rm -p 4173:80 fx-devkit-website:local
```

Deploy a reviewed main revision after Jenkins checks pass. Keep private Git keys,
Registry tokens, application IDs and personal preview bindings in the platform.
Configure a real 404 for removed maintainer routes; do not add an SPA fallback.

Other static hosts can serve subpaths. For example:

```sh
SITE_BASE_PATH=/fx-devkit/ SITE_ORIGIN=https://docs.example.com npm run site:build
npm run site:check
```

The preview reads the base from ignored local build state; restart it after a base
change. Relative links, assets and English-default language selection work with
or without `SITE_ORIGIN`. When set, canonical URLs, hreflang and a sitemap use it.
Only `docs/website/dist/` is deployable; build state and source files stay outside it.

## Public GitHub Pages channel

Set `FX_DISTRIBUTION=public` for the npmjs package name and public installation
instructions. The Pages workflow validates root and repository-subpath routes,
builds against Pages origin metadata, and deploys only with
`PUBLIC_RELEASE_ENABLED=true`. Leave this gate unset while public release is on
hold. Public builds use the public repository link and allow indexing; internal
builds use the optional platform-supplied source link and discourage indexing.
Neither indexing metadata nor private repository visibility provides website access control.

Channel-specific Markdown is wrapped in `<!-- distribution:internal -->` or
`<!-- distribution:public -->` blocks, closed by `<!-- /distribution -->`.
The source README can show both; deployed user pages show only their own channel.
Keep both blocks and the matching translations accurate. See [delivery](../delivery.md)
for maintainer-side configuration; it is not a user website route.

## Languages and translation coverage

| Language            | Route prefix |
| ------------------- | ------------ |
| English             | `/`          |
| Japanese            | `/ja/`       |
| Simplified Chinese  | `/zh-Hans/`  |
| Traditional Chinese | `/zh-Hant/`  |

English is the default language. The site root and unprefixed documentation
routes always serve English, including under a static-host subpath.
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

## Preview and cache consistency

Review website changes through the running local preview before pushing or deploying.
The preview server disables caching. Generated stylesheet and script URLs include
content versions, checked against their actual bytes by `site:check`, so refreshed
HTML cannot reuse an older cached asset. The NGINX container revalidates responses
before reuse. This cannot retroactively invalidate responses already cached by a
previous deployment; a hard reload may be needed once when upgrading from it.

## Homepage hierarchy

The hero has one value statement, followed by the primary installation-guide link
and a secondary documentation link. Keep their filled and outlined treatments
distinct. The compact command row is a shortcut for users whose registry is ready;
requirements belong in the guide and the quiet baseline, not beside a competing
card title. Navigation installation links go directly to the guide. The closing
workspace action follows the complete getting-started flow.

Keep headline and body typography consistent across breakpoints; avoid manual
line breaks in the value statement. Review all four languages visually, including
320px screens. Command tabs own exploration: selecting one changes both its
localized purpose and illustrative output, with keyboard support and an announced
purpose. Do not add a hero action that only scrolls to an already visible demo.

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
