import fs from 'fs';
import path from 'path';
import os from 'os';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Storage
// ─────────────────────────────────────────────
const CUSTOM_TOOLS_DIR = path.join(os.homedir(), '.quinn', 'custom_tools');

function ensureDir() {
  fs.mkdirSync(CUSTOM_TOOLS_DIR, { recursive: true });
}

// ─────────────────────────────────────────────
//  Dynamic tool registry (mutable — shared ref)
// ─────────────────────────────────────────────
// This is imported and mutated by tools/index.js
export const dynamicToolRegistry = new Map();  // name → execute fn
export const dynamicDeclarations = [];          // pushed to toolDeclarations

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const selfmodDeclarations = [
  {
    name: 'create_custom_tool',
    description:
      'Create a brand new tool for yourself that persists across sessions. Write JavaScript code that implements the tool, and Quinn will load it immediately and use it in this and all future sessions. Perfect for creating specialized tools for the user\'s specific workflow — e.g. a tool to query their specific database, ping their server, check a custom API, format data their way, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tool_name: {
          type: Type.STRING,
          description: 'Unique snake_case name for the tool, e.g. "check_bitcoin_price" or "query_my_postgres". No spaces.',
        },
        description: {
          type: Type.STRING,
          description: 'Clear description of what this tool does. This is what Gemini reads to decide when to use it.',
        },
        parameters_schema: {
          type: Type.STRING,
          description: 'JSON string defining the tool\'s input parameters using Gemini\'s Type schema. Example: {"type":"OBJECT","properties":{"symbol":{"type":"STRING","description":"Ticker symbol"}},"required":["symbol"]}',
        },
        implementation_code: {
          type: Type.STRING,
          description: 'The async JavaScript function body (NOT the function declaration — just the code inside it). The function receives an "args" object. Use fetch(), fs, execSync from child_process, etc. Must return a plain object. Example: const res = await fetch(`https://api.example.com/${args.symbol}`); const data = await res.json(); return { price: data.price };',
        },
        imports: {
          type: Type.STRING,
          description: 'Optional ESM import statements needed, one per line. Example: import { execSync } from "child_process";\\nimport fs from "fs";',
        },
      },
      required: ['tool_name', 'description', 'parameters_schema', 'implementation_code'],
    },
  },

  {
    name: 'list_custom_tools',
    description: 'List all custom tools Quinn has created for itself. Shows name, description, and when it was created.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  {
    name: 'delete_custom_tool',
    description: 'Permanently delete a custom tool Quinn created. The tool will no longer be available after deletion.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tool_name: {
          type: Type.STRING,
          description: 'The name of the custom tool to delete.',
        },
      },
      required: ['tool_name'],
    },
  },
];

// ─────────────────────────────────────────────
//  Tool file template
// ─────────────────────────────────────────────
function buildToolFile(toolName, description, parametersSchema, implementationCode, imports) {
  return `// Quinn Custom Tool: ${toolName}
// Created: ${new Date().toISOString()}
${imports ? imports + '\n' : ''}
export const declaration = {
  name: '${toolName}',
  description: ${JSON.stringify(description)},
  parameters: ${parametersSchema},
};

export async function execute(args) {
  ${implementationCode}
}
`;
}

// ─────────────────────────────────────────────
//  Load and register a custom tool from file
// ─────────────────────────────────────────────
export async function loadCustomTool(filePath) {
  // Cache-bust with timestamp so re-imported files reflect edits
  const url = `file://${filePath}?v=${Date.now()}`;
  try {
    const mod = await import(url);
    if (!mod.declaration || !mod.execute) return false;

    // Register into dynamic registry
    dynamicToolRegistry.set(mod.declaration.name, mod.execute);

    // Add to dynamic declarations if not already present
    const exists = dynamicDeclarations.find((d) => d.name === mod.declaration.name);
    if (!exists) {
      dynamicDeclarations.push(mod.declaration);
    } else {
      Object.assign(exists, mod.declaration);
    }
    return true;
  } catch (err) {
    console.error(`  Failed to load custom tool ${filePath}: ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────
//  Boot: restore all custom tools
// ─────────────────────────────────────────────
export async function restoreCustomTools() {
  ensureDir();
  const files = fs.readdirSync(CUSTOM_TOOLS_DIR).filter((f) => f.endsWith('.js'));
  let loaded = 0;
  for (const file of files) {
    const ok = await loadCustomTool(path.join(CUSTOM_TOOLS_DIR, file));
    if (ok) loaded++;
  }
  return loaded;
}

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
export async function executeSelfmodTool(name, args) {
  switch (name) {
    case 'create_custom_tool': {
      const toolName = args.tool_name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();

      // Validate cron expression... validate JSON schema
      let parsedSchema;
      try {
        parsedSchema = JSON.parse(args.parameters_schema);
      } catch {
        throw new Error('parameters_schema is not valid JSON. Please provide a valid JSON object.');
      }

      ensureDir();
      const filePath = path.join(CUSTOM_TOOLS_DIR, `${toolName}.js`);

      const code = buildToolFile(
        toolName,
        args.description,
        JSON.stringify(parsedSchema, null, 2),
        args.implementation_code,
        args.imports ?? ''
      );

      fs.writeFileSync(filePath, code, 'utf8');

      // Load the tool immediately
      const ok = await loadCustomTool(filePath);
      if (!ok) {
        throw new Error('Tool was saved but failed to load. Check the implementation_code for syntax errors.');
      }

      return {
        success: true,
        tool_name: toolName,
        file: filePath,
        loaded: true,
        message: `Tool "${toolName}" created and loaded. Quinn can now use it immediately.`,
        total_custom_tools: dynamicDeclarations.length,
      };
    }

    case 'list_custom_tools': {
      ensureDir();
      const files = fs.readdirSync(CUSTOM_TOOLS_DIR).filter((f) => f.endsWith('.js'));

      const tools = files.map((file) => {
        const filePath = path.join(CUSTOM_TOOLS_DIR, file);
        const name = file.replace('.js', '');
        const stat = fs.statSync(filePath);
        const loaded = dynamicToolRegistry.has(name);
        const decl = dynamicDeclarations.find((d) => d.name === name);
        return {
          name,
          description: decl?.description ?? '(not loaded)',
          file: filePath,
          created: stat.birthtime.toISOString(),
          loaded,
        };
      });

      return {
        custom_tools: tools,
        count: tools.length,
        loaded_count: tools.filter((t) => t.loaded).length,
      };
    }

    case 'delete_custom_tool': {
      const toolName = args.tool_name;
      const filePath = path.join(CUSTOM_TOOLS_DIR, `${toolName}.js`);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Custom tool "${toolName}" not found.`);
      }

      fs.unlinkSync(filePath);
      dynamicToolRegistry.delete(toolName);
      const idx = dynamicDeclarations.findIndex((d) => d.name === toolName);
      if (idx !== -1) dynamicDeclarations.splice(idx, 1);

      return { success: true, deleted: toolName };
    }

    default:
      throw new Error(`Unknown selfmod tool: ${name}`);
  }
}