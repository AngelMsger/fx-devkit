// Locale metadata and shared UI copy. Missing keys fail the static build.
import { readFile } from 'node:fs/promises';
export const locales = [
  { id: 'en', name: 'English', tag: 'en' },
  { id: 'ja', name: '日本語', tag: 'ja' },
  { id: 'zh-Hans', name: '简体中文', tag: 'zh-Hans' },
  { id: 'zh-Hant', name: '繁體中文', tag: 'zh-Hant' },
];
export async function messages(locale) {
  return JSON.parse(await readFile(new URL(`./i18n/${locale}.json`, import.meta.url), 'utf8'));
}
export function message(catalog, key) {
  if (typeof catalog[key] !== 'string') throw new Error(`Missing translation: ${key}`);
  return catalog[key];
}

export function validateCatalogs(catalogs, pages) {
  function shape(value, prefix = '') {
    return Object.entries(value)
      .flatMap(([key, item]) =>
        typeof item === 'string' ? [`${prefix}${key}`] : shape(item, `${prefix}${key}.`),
      )
      .sort();
  }
  const keys = JSON.stringify(shape(catalogs.en));
  for (const { id } of locales) {
    if (JSON.stringify(shape(catalogs[id])) !== keys)
      throw new Error(`Locale catalog keys differ: ${id}`);
    for (const page of pages) {
      const meta = catalogs[id].pages[page.route];
      if (!meta?.title || !meta?.description || !catalogs[id].groups[page.group])
        throw new Error(`Missing localized page metadata: ${id}/${page.route}`);
      if (id === 'en' && (meta.title !== page.title || meta.description !== page.description))
        throw new Error(`English metadata is stale: ${page.route}`);
    }
  }
}
