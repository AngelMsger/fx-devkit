// Both are pure; the use cases exist so the CLI depends on one shape of
// call for every manifest command.

import { describePath, type FieldDoc } from '../../domain/manifest/explain.js';
import { jsonSchemaFor } from '../../domain/manifest/json-schema.js';
import type { Kind } from '../../domain/manifest/types.js';

export class ExplainManifest {
  execute(input: { readonly kind: Kind; readonly path?: string | undefined }): FieldDoc {
    return describePath(input.kind, input.path);
  }
}

export class SchemaManifest {
  execute(input: { readonly kind: Kind; readonly cliVersion: string }): Record<string, unknown> {
    return jsonSchemaFor(input.kind, input.cliVersion);
  }
}
