// Local-only MCP tools. Deliberately excludes delete, replace, and attachment export.
const empty = { type: 'object', properties: {}, additionalProperties: false };
const string = (description, maxLength = 256) => ({ type: 'string', description, maxLength });
export const tools = [
  {
    name: 'list_notes',
    description: 'List active Slate notes and their IDs and last-modified times.',
    inputSchema: empty,
    annotations: { readOnlyHint: true }
  },
  {
    name: 'search_notes',
    description: 'Search active Slate notes by title and their text content.',
    inputSchema: { type: 'object', properties: { query: string('Search phrase', 200) }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_note',
    description: 'Read a Slate note by ID. Returns its current updated_at value, needed before appending.',
    inputSchema: { type: 'object', properties: { id: string('Note ID', 100) }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'create_note',
    description: 'Create a new Slate note (user confirmation required in Slate).',
    inputSchema: { type: 'object', properties: {
      title: string('Note title', 200),
      text: string('Plain-text content', 20000),
      parent_id: string('Optional parent note ID', 100)
    }, required: ['title'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: 'append_to_note',
    description: 'Append text to an existing Slate note without replacing existing rich-text blocks (user confirmation required in Slate). Read the note first and supply its updated_at value.',
    inputSchema: { type: 'object', properties: {
      id: string('Note ID', 100),
      text: string('Text to append', 20000),
      expected_updated_at: { type: 'number', description: 'updated_at from get_note, to prevent overwriting concurrent changes' }
    }, required: ['id', 'text', 'expected_updated_at'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false }
  }
];
export const writeTools = new Set(['create_note', 'append_to_note']);
export function validateToolCall(name, args) {
  const tool = tools.find(item => item.name === name);
  if (!tool) throw new Error('Unknown Slate MCP tool.');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  const shape = tool.inputSchema;
  for (const field of shape.required || []) if (!(field in args)) throw new Error('Missing argument: ' + field);
  for (const [key, value] of Object.entries(args)) {
    const spec = shape.properties[key];
    if (!spec) throw new Error('Unexpected argument: ' + key);
    if (typeof value !== spec.type || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid argument type: ' + key);
    if (typeof value === 'string' && value.length > (spec.maxLength || 20000)) throw new Error('Argument too long: ' + key);
  }
  return tool;
}
