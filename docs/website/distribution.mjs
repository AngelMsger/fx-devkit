// Keep one Markdown source while selecting installation guidance for the deployed channel.
export function distributionMarkdown(source, channel) {
  if (!['internal', 'public'].includes(channel)) throw new Error('Unknown documentation channel.');
  const rendered = source.replace(
    /<!-- distribution:(internal|public) -->\n([\s\S]*?)<!-- \/distribution -->/g,
    (_, selected, body) => (selected === channel ? body : ''),
  );
  if (/<!--\s*\/?distribution(?::|\s)/.test(rendered))
    throw new Error('Malformed distribution block in documentation.');
  return rendered;
}
