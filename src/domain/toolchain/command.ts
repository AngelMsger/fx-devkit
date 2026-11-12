// Bind a provider's canonical tool name or configured binary to one executable.
export interface ToolCommandBinding {
  readonly tool: string;
  readonly binary: string;
  readonly binary_path?: string | null;
}

export function bindToolCommand(
  vector: readonly string[],
  binding: ToolCommandBinding | undefined,
): readonly string[] {
  if (binding === undefined || (vector[0] !== binding.tool && vector[0] !== binding.binary))
    return vector;
  return [binding.binary_path ?? binding.binary, ...vector.slice(1)];
}
