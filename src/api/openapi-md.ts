import { generateOpenApiSpec } from './openapi.js';

type AnyObj = Record<string, any>;

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;

function describeSchema(schema: AnyObj | undefined, indent = 0): string {
  if (!schema || typeof schema !== 'object') return '';
  const pad = '  '.repeat(indent);

  if (schema.$ref) return `${pad}- ref: \`${schema.$ref}\``;

  if (schema.type === 'object' || schema.properties) {
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const props = schema.properties || {};
    const lines: string[] = [];
    for (const [name, raw] of Object.entries(props)) {
      const prop = raw as AnyObj;
      const flags: string[] = [];
      if (required.includes(name)) flags.push('required');
      if (prop.default !== undefined) flags.push(`default: \`${JSON.stringify(prop.default)}\``);
      if (Array.isArray(prop.enum)) flags.push(`enum: ${prop.enum.map((v: any) => `\`${v}\``).join(', ')}`);
      const type = prop.type || (prop.anyOf ? 'anyOf' : prop.oneOf ? 'oneOf' : 'any');
      const desc = prop.description ? ` — ${prop.description}` : '';
      const meta = flags.length ? ` _(${flags.join(', ')})_` : '';
      lines.push(`${pad}- \`${name}\` (${type})${meta}${desc}`);
      if (prop.properties) lines.push(describeSchema(prop, indent + 1));
      if (prop.type === 'array' && prop.items) {
        lines.push(`${pad}  - items: ${prop.items.type || 'object'}`);
        if (prop.items.properties) lines.push(describeSchema(prop.items, indent + 2));
      }
    }
    return lines.join('\n');
  }

  if (schema.type === 'array' && schema.items) {
    return `${pad}- array of \`${schema.items.type || 'object'}\``;
  }

  return `${pad}- type: \`${schema.type || 'any'}\``;
}

function renderParameters(params: AnyObj[] | undefined): string {
  if (!params || params.length === 0) return '';
  const rows = params.map((p) => {
    const type = p.schema?.type || 'string';
    const enumPart = Array.isArray(p.schema?.enum) ? ` (${p.schema.enum.map((v: any) => `\`${v}\``).join(' \\| ')})` : '';
    const def = p.schema?.default !== undefined ? `\`${p.schema.default}\`` : '';
    const req = p.required ? 'yes' : 'no';
    const desc = p.description || '';
    return `| \`${p.name}\` | ${p.in} | ${type}${enumPart} | ${req} | ${def} | ${desc} |`;
  });
  return [
    '| Name | In | Type | Required | Default | Description |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function renderRequestBody(body: AnyObj | undefined): string {
  if (!body) return '';
  const json = body.content?.['application/json'];
  if (!json?.schema) return '';
  const fields = describeSchema(json.schema);
  if (!fields) return '';
  return `**Request body** (\`application/json\`)\n\n${fields}`;
}

function renderResponses(responses: AnyObj | undefined): string {
  if (!responses) return '';
  const rows = Object.entries(responses).map(([code, raw]) => {
    const r = raw as AnyObj;
    return `| \`${code}\` | ${r.description || ''} |`;
  });
  return ['| Status | Description |', '| --- | --- |', ...rows].join('\n');
}

function tagOf(op: AnyObj): string {
  return Array.isArray(op.tags) && op.tags.length ? op.tags[0] : 'Other';
}

export function generateOpenApiMarkdown(): string {
  const spec = generateOpenApiSpec() as AnyObj;
  const out: string[] = [];

  out.push(`# ${spec.info?.title || 'API'}`);
  out.push('');
  if (spec.info?.version) out.push(`**Version:** ${spec.info.version}`);
  if (spec.info?.description) {
    out.push('');
    out.push(spec.info.description);
  }
  out.push('');

  if (Array.isArray(spec.servers) && spec.servers.length) {
    out.push('## Servers');
    out.push('');
    for (const s of spec.servers) {
      const desc = s.description ? ` — ${s.description}` : '';
      out.push(`- \`${s.url}\`${desc}`);
    }
    out.push('');
  }

  const schemes = spec.components?.securitySchemes;
  if (schemes && Object.keys(schemes).length) {
    out.push('## Authentication');
    out.push('');
    for (const [name, raw] of Object.entries(schemes)) {
      const s = raw as AnyObj;
      let line = `- **${name}**: `;
      if (s.type === 'apiKey') line += `API key in ${s.in} \`${s.name}\``;
      else if (s.type === 'http') line += `HTTP ${s.scheme}`;
      else line += s.type;
      out.push(line);
    }
    out.push('');
  }

  // Group operations by tag
  const grouped = new Map<string, Array<{ method: string; path: string; op: AnyObj }>>();
  const paths = (spec.paths || {}) as AnyObj;
  for (const [p, raw] of Object.entries(paths)) {
    const item = raw as AnyObj;
    for (const m of METHODS) {
      if (!item[m]) continue;
      const op = item[m] as AnyObj;
      const tag = tagOf(op);
      if (!grouped.has(tag)) grouped.set(tag, []);
      grouped.get(tag)!.push({ method: m.toUpperCase(), path: p, op });
    }
  }

  const tags = [...grouped.keys()].sort();
  if (tags.length) {
    out.push('## Endpoints');
    out.push('');
    for (const tag of tags) {
      out.push(`### ${tag}`);
      out.push('');
      for (const { method, path, op } of grouped.get(tag)!) {
        out.push(`#### \`${method} ${path}\``);
        out.push('');
        if (op.summary) out.push(op.summary);
        if (op.description) {
          out.push('');
          out.push(op.description);
        }
        out.push('');

        const params = renderParameters(op.parameters);
        if (params) {
          out.push('**Parameters**');
          out.push('');
          out.push(params);
          out.push('');
        }

        const body = renderRequestBody(op.requestBody);
        if (body) {
          out.push(body);
          out.push('');
        }

        const responses = renderResponses(op.responses);
        if (responses) {
          out.push('**Responses**');
          out.push('');
          out.push(responses);
          out.push('');
        }
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
