import { fileSystemDeclarations, executeFileSystemTool } from './filesystem.js';
import { shellDeclarations, executeShellTool } from './shell.js';
import { systemDeclarations, executeSystemTool } from './system.js';
import { networkDeclarations, executeNetworkTool } from './network.js';
import { gitDeclarations, executeGitTool } from './git.js';
import { clipboardDeclarations, executeClipboardTool } from './clipboard.js';

// ─────────────────────────────────────────────
//  All tool declarations (passed to Gemini)
// ─────────────────────────────────────────────
export const toolDeclarations = [
  ...fileSystemDeclarations,
  ...shellDeclarations,
  ...systemDeclarations,
  ...networkDeclarations,
  ...gitDeclarations,
  ...clipboardDeclarations,
];

// ─────────────────────────────────────────────
//  Tool name registry (for /tools command)
// ─────────────────────────────────────────────
export const TOOL_NAMES = toolDeclarations.map((t) => ({
  name: t.name,
  description: t.description,
}));

// ─────────────────────────────────────────────
//  Route tool call to correct executor
// ─────────────────────────────────────────────
const FILE_TOOLS = new Set(fileSystemDeclarations.map((t) => t.name));
const SHELL_TOOLS = new Set(shellDeclarations.map((t) => t.name));
const SYSTEM_TOOLS = new Set(systemDeclarations.map((t) => t.name));
const NETWORK_TOOLS = new Set(networkDeclarations.map((t) => t.name));
const GIT_TOOLS = new Set(gitDeclarations.map((t) => t.name));
const CLIPBOARD_TOOLS = new Set(clipboardDeclarations.map((t) => t.name));

export async function executeTool(name, args) {
  if (FILE_TOOLS.has(name))      return executeFileSystemTool(name, args);
  if (SHELL_TOOLS.has(name))     return executeShellTool(name, args);
  if (SYSTEM_TOOLS.has(name))    return executeSystemTool(name, args);
  if (NETWORK_TOOLS.has(name))   return executeNetworkTool(name, args);
  if (GIT_TOOLS.has(name))       return executeGitTool(name, args);
  if (CLIPBOARD_TOOLS.has(name)) return executeClipboardTool(name, args);

  throw new Error(`Unknown tool: "${name}"`);
}