// Public-site inputs are an explicit user-facing allowlist, separate from repository docs.
export const userSources = new Set([
  'docs/README.md',
  'docs/user-guide.md',
  'docs/manifest-guide.md',
  'docs/user-privacy.md',
  'docs/support.md',
  'docs/cli/README.md',
  'skills/fx-workspace/SKILL.md',
  'skills/fx-workspace/references/commands.md',
  'CHANGELOG.md',
]);
export function assertPublicPath(file) {
  const retired =
    /^(?:(?:ja|zh-Hans|zh-Hant)\/)?docs\/(?:public-release|delivery|internal-delivery|validation|eval|website|contributing(?:-guide)?|design|roadmap|security)(?:\/|$)/;
  if (
    retired.test(file) ||
    /(?:^|\/)(?:build-manifest\.json|\.build-state\.json|\.openai)(?:\/|$)/.test(file)
  )
    throw new Error(`Non-user file in site output: ${file}`);
}
export function assertUserSources(pages) {
  for (const page of pages) {
    assertPublicPath(page.route ?? '');
    if (!userSources.has(page.source))
      throw new Error(`Not a user-documentation source: ${page.source}`);
  }
}
export function assertPublicContent(text, file) {
  const forbidden = [
    /(?:https?:\/\/[^\s"<>]+)?\/docs\/(?:public-release|delivery|internal-delivery|validation|eval|website|contributing(?:-guide)?|design|roadmap)(?:\/|["#?])/i,
    /(?:build-manifest|\.build-state)\.json/i,
    /appgprj_[a-z0-9]+/i,
    /[a-z0-9-]+\.chatgpt\.site/i,
    /npm-token|FX_PUBLISH_WRAPPED|scripts\/publish\.mjs/,
    /(?:\/Users\/|\/home\/)[A-Za-z][^\s<"/]+\//,
    /npm\s+(?:--prefix\s+docs\/website|run\s+(?:site:|docs:(?:gen|check)|test:contract|check:windows))/,
  ];
  if (forbidden.some((pattern) => pattern.test(text)))
    throw new Error(`Maintainer material in public output: ${file}`);
}
