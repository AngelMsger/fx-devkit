// `{name}` placeholders in manifest and recipe text. Substitution never
// invents a value: a name nobody supplied stays in `missing` so the caller
// decides whether that is a dropped field, a dropped step or a problem.

const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g;

export type Vars = Readonly<Record<string, string>>;

export interface Substitution {
  readonly text: string;
  readonly missing: readonly string[];
}

export function substitute(template: string, vars: Vars): Substitution {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      missing.add(name);
      return whole;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

export function substituteAll(
  templates: readonly string[],
  vars: Vars,
): { readonly vector: readonly string[]; readonly missing: readonly string[] } {
  const missing = new Set<string>();
  const vector = templates.map((t) => {
    const done = substitute(t, vars);
    for (const name of done.missing) missing.add(name);
    return done.text;
  });
  return { vector, missing: [...missing] };
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
}
