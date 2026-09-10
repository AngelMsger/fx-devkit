// The common shape of a platform adapter: a label, a default command template and an
// optional page template, filled from the variables the caller merged. Unresolved
// placeholders stay visible so the reader sees what the manifest did not say.

import type { Capability } from '../../domain/capability.js';
import type { Coordinate, ProbeVector } from '../../domain/obs/types.js';
import { substitute, substituteAll, type Vars } from '../../domain/template.js';
import type { Platform } from '../../ports/platform.js';

export interface PlatformTemplate {
  readonly id: string;
  readonly capability: Capability;
  readonly label: string;
  readonly command: readonly string[];
  readonly url?: string;
  readonly probe?: ProbeVector;
  readonly optionalFlags?: Readonly<Record<string, string>>;
}

export class TemplatePlatform implements Platform {
  readonly id: string;
  readonly capability: Capability;

  constructor(private readonly template: PlatformTemplate) {
    this.id = template.id;
    this.capability = template.capability;
  }

  probe(vars: Vars): ProbeVector | undefined {
    const { probe } = this.template;
    if (probe === undefined) return undefined;
    const template = this.command(probe.command, vars);
    return {
      label: substitute(probe.label, vars).text,
      command: substituteAll(template, vars).vector,
      template,
    };
  }

  locate(vars: Vars): Coordinate {
    const { template } = this;
    return {
      label: substitute(template.label, vars).text,
      command: substituteAll(this.command(template.command, vars), vars).vector,
      ...(template.url === undefined ? {} : { url: substitute(template.url, vars).text }),
    };
  }
  private command(vector: readonly string[], vars: Vars): readonly string[] {
    const optional = Object.entries(this.template.optionalFlags ?? {}).flatMap(([key, flag]) =>
      vars[key] ? [flag, `{${key}}`] : [],
    );
    const separator = vector.indexOf('--');
    if (separator < 0) return [...vector, ...optional];
    return [...vector.slice(0, separator), ...optional, ...vector.slice(separator)];
  }
}
