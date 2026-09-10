// Translate this project's public documentation/source URLs into local build targets.
// Unrelated sites and links with query parameters remain external.
export function publicTarget(target, { homepage, repository }) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.search) return null;
  const site = new URL(homepage);
  if (url.origin === site.origin && url.pathname.startsWith(site.pathname)) {
    return { route: url.pathname.slice(site.pathname.length), hash: url.hash };
  }
  const repo = new URL(repository);
  const prefix = `${repo.pathname}/blob/main/`;
  if (url.origin === repo.origin && url.pathname.startsWith(prefix)) {
    return { source: decodeURIComponent(url.pathname.slice(prefix.length)), hash: url.hash };
  }
  return null;
}
