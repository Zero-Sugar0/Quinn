// tools/subagent.js
//
// Sub-agent spawning & parallel execution.
// Emits live progress events so the terminal UI can show what each
// sub-agent is doing in real time.
//
// Events emitted on `subagentEvents`:
//   'agent:start'     { id, role, task }
//   'agent:tool'      { id, role, toolName, args }
//   'agent:tool:done' { id, role, toolName, success, error? }
//   'agent:iter'      { id, role, iteration }
//   'agent:done'      { id, role, status, elapsed_ms, iterations }

import { GoogleGenAI } from '@google/genai';
import { EventEmitter } from 'events';
import { Type } from '@google/genai';

import { fileSystemDeclarations, executeFileSystemTool } from './filesystem.js';
import { shellDeclarations, executeShellTool } from './shell.js';
import { networkDeclarations, executeNetworkTool } from './network.js';
import { searchDeclarations, executeSearchTool } from './search.js';
import { memoryDeclarations, executeMemoryTool } from './memory.js';

// ── Shared event bus ─────────────────────────────────────────────────────────
// quinn.js subscribes to this to paint live progress in the terminal.
export const subagentEvents = new EventEmitter();
subagentEvents.setMaxListeners(32); // up to 8 agents × 4 event types

const MODEL = 'gemini-2.5-flash';
const MAX_ITERATIONS = 15;

// ─────────────────────────────────────────────
//  Role → system prompt library
// ─────────────────────────────────────────────
const ROLE_PROMPTS = {
  researcher: `
You are a focused research sub-agent. Your only job is to gather accurate,
comprehensive information on the topic you are given. Search broadly, cross-
reference sources, and return a well-structured Markdown summary with key facts,
citations where possible, and open questions. Do not chat — just research and report.
`.trim(),

  coder: `
You are a focused coding sub-agent. Your job is to write, refactor, or debug code.
Produce clean, production-ready implementations with no placeholders. Include
inline comments where behaviour is non-obvious. Return only the code and a brief
explanation of decisions made. Do not pad with filler.
`.trim(),

  reviewer: `
You are a focused code/document review sub-agent. Analyse what you are given with
a critical but constructive eye. Identify bugs, logic errors, security issues,
style violations, and missing tests. Output a structured Markdown review with
sections: Summary, Issues (severity: high/medium/low), Suggestions, Verdict.
`.trim(),

  tester: `
You are a focused test-writing sub-agent. Given code or a feature description,
produce thorough test cases covering happy paths, edge cases, and failure modes.
Prefer concrete runnable tests (Jest / Vitest style). Explain what each test
validates and why.
`.trim(),

  planner: `
You are a focused planning sub-agent. Break the goal you are given into a clear,
ordered, actionable plan. Return a numbered list of steps, each with: what to do,
why it matters, and any dependencies on prior steps. Flag risks and open decisions.
`.trim(),

  writer: `
You are a focused writing sub-agent. Produce polished, clear, human-sounding prose.
No filler. Adapt your voice to the material — technical for docs, warm for READMEs,
precise for changelogs. Return the finished writing, ready to use.
`.trim(),

  analyst: `
You are a focused data/logic analysis sub-agent. Reason carefully through the
information you are given. Identify patterns, anomalies, and conclusions. Be
precise with numbers. Return a structured analysis with a clear conclusion section.
`.trim(),
};

// ─────────────────────────────────────────────
//  Role → emoji badge shown in the terminal
// ─────────────────────────────────────────────
export const ROLE_BADGE = {
  researcher : '🔍',
  coder      : '💻',
  reviewer   : '🔎',
  tester     : '🧪',
  planner    : '📋',
  writer     : '✍️',
  analyst    : '📊',
  custom     : '⚡',
};

// ─────────────────────────────────────────────
//  Tool routing for sub-agents (no circular dep)
// ─────────────────────────────────────────────
const FILE_TOOLS   = new Set(fileSystemDeclarations.map((t) => t.name));
const SHELL_TOOLS  = new Set(shellDeclarations.map((t) => t.name));
const NET_TOOLS    = new Set(networkDeclarations.map((t) => t.name));
const SEARCH_TOOLS = new Set(searchDeclarations.map((t) => t.name));
const MEMORY_TOOLS = new Set(memoryDeclarations.map((t) => t.name));

const ALL_SUBAGENT_DECLARATIONS = [
  ...fileSystemDeclarations,
  ...shellDeclarations,
  ...networkDeclarations,
  ...searchDeclarations,
  ...memoryDeclarations,
];

const ROLE_TOOLS = {
  researcher : [NET_TOOLS, SEARCH_TOOLS, MEMORY_TOOLS, FILE_TOOLS],
  coder      : [FILE_TOOLS, SHELL_TOOLS, MEMORY_TOOLS],
  reviewer   : [FILE_TOOLS, MEMORY_TOOLS],
  tester     : [FILE_TOOLS, SHELL_TOOLS, MEMORY_TOOLS],
  planner    : [MEMORY_TOOLS],
  writer     : [FILE_TOOLS, MEMORY_TOOLS],
  analyst    : [FILE_TOOLS, SEARCH_TOOLS, MEMORY_TOOLS],
  custom     : [FILE_TOOLS, SHELL_TOOLS, NET_TOOLS, SEARCH_TOOLS, MEMORY_TOOLS],
};

function getDeclarationsForRole(role) {
  const allowed = ROLE_TOOLS[role] ?? ROLE_TOOLS.custom;
  return ALL_SUBAGENT_DECLARATIONS.filter((d) => allowed.some((s) => s.has(d.name)));
}

async function execSubTool(toolName, args) {
  if (FILE_TOOLS.has(toolName))   return executeFileSystemTool(toolName, args);
  if (SHELL_TOOLS.has(toolName))  return executeShellTool(toolName, args);
  if (NET_TOOLS.has(toolName))    return executeNetworkTool(toolName, args);
  if (SEARCH_TOOLS.has(toolName)) return executeSearchTool(toolName, args);
  if (MEMORY_TOOLS.has(toolName)) return executeMemoryTool(toolName, args);
  throw new Error(`Sub-agent has no access to tool: "${toolName}"`);
}

// ─────────────────────────────────────────────
//  Core: run a single sub-agent to completion
// ─────────────────────────────────────────────
async function runSubagent({ id, role, task, customSystemPrompt, context, timeoutMs }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set.');

  const ai = new GoogleGenAI({ apiKey });

  const systemPrompt = role === 'custom'
    ? (customSystemPrompt ?? 'You are a helpful sub-agent. Complete the task.')
    : (ROLE_PROMPTS[role] ?? ROLE_PROMPTS.custom);

  const fullTask = context
    ? `Context from parent agent:\n${context}\n\n---\n\nYour task:\n${task}`
    : task;

  const history    = [{ role: 'user', parts: [{ text: fullTask }] }];
  const toolDecls  = getDeclarationsForRole(role);
  const startTime  = Date.now();
  let   iterations = 0;

  subagentEvents.emit('agent:start', { id, role, task });

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    subagentEvents.emit('agent:iter', { id, role, iteration: iterations });

    if (timeoutMs && Date.now() - startTime > timeoutMs) {
      const result = {
        id, role, status: 'timeout',
        error      : `Sub-agent "${id}" exceeded timeout of ${timeoutMs}ms.`,
        elapsed_ms : Date.now() - startTime,
        iterations : iterations - 1,
      };
      subagentEvents.emit('agent:done', result);
      return result;
    }

    const response = await ai.models.generateContent({
      model    : MODEL,
      contents : history,
      config   : {
        systemInstruction : systemPrompt,
        tools             : toolDecls.length > 0 ? [{ functionDeclarations: toolDecls }] : undefined,
        temperature       : 1.0,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw new Error(`Sub-agent "${id}": no candidate from API.`);

    // Guard against safety-filtered / empty content
    const modelContent = candidate.content;
    if (!modelContent) {
      const reason = candidate.finishReason ?? 'unknown';
      throw new Error(
        `Sub-agent "${id}" got no content from Gemini (finishReason: ${reason}). ` +
        `Try rephrasing the task.`
      );
    }
    history.push(modelContent);

    const functionCalls = response.functionCalls;

    if (functionCalls?.length > 0) {
      const toolResults = await Promise.allSettled(
        functionCalls.map(async (fc) => {
          subagentEvents.emit('agent:tool', { id, role, toolName: fc.name, args: fc.args });
          try {
            const result = await execSubTool(fc.name, fc.args);
            subagentEvents.emit('agent:tool:done', { id, role, toolName: fc.name, success: true });
            return { id: fc.id, name: fc.name, response: { result } };
          } catch (err) {
            subagentEvents.emit('agent:tool:done', { id, role, toolName: fc.name, success: false, error: err.message });
            return { id: fc.id, name: fc.name, response: { result: { error: err.message } } };
          }
        })
      );

      history.push({
        role  : 'user',
        parts : toolResults.map((r) => ({
          functionResponse: r.status === 'fulfilled'
            ? r.value
            : { id: 'unknown', name: 'unknown', response: { result: { error: r.reason?.message } } },
        })),
      });

      continue;
    }

    const textPart = modelContent?.parts?.find((p) => p.text);
    const output   = textPart?.text ?? '*(sub-agent returned no text)*';

    const result = {
      id, role, status: 'success',
      output,
      elapsed_ms : Date.now() - startTime,
      iterations,
    };
    subagentEvents.emit('agent:done', result);
    return result;
  }

  const result = {
    id, role, status: 'max_iterations',
    error      : `Sub-agent "${id}" hit the ${MAX_ITERATIONS}-iteration limit.`,
    elapsed_ms : Date.now() - startTime,
    iterations,
  };
  subagentEvents.emit('agent:done', result);
  return result;
}

// ─────────────────────────────────────────────
//  Declarations (sent to Gemini)
// ─────────────────────────────────────────────
export const subagentDeclarations = [
  {
    name: 'spawn_subagents',
    description: `Spawn one or more specialised sub-agents that run in PARALLEL and return their results. Use this to split a complex task into concurrent workstreams — e.g. have a researcher gather facts while a coder writes implementation while a reviewer checks existing code — then synthesise all results yourself.

Available roles: researcher, coder, reviewer, tester, planner, writer, analyst, custom.

Each sub-agent runs its own isolated agent loop with access to a safe subset of tools appropriate for its role. Results arrive together once all agents finish (or timeout).`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        agents: {
          type: Type.ARRAY,
          description: 'List of sub-agents to spawn in parallel.',
          items: {
            type: Type.OBJECT,
            properties: {
              id                  : { type: Type.STRING, description: 'Short unique label (e.g. "research", "code", "review").' },
              role                : { type: Type.STRING, description: 'researcher | coder | reviewer | tester | planner | writer | analyst | custom' },
              task                : { type: Type.STRING, description: 'The specific task for this agent.' },
              custom_system_prompt: { type: Type.STRING, description: 'Only for role="custom": full system prompt.' },
            },
            required: ['id', 'role', 'task'],
          },
        },
        context    : { type: Type.STRING,  description: 'Optional shared context injected into every sub-agent.' },
        timeout_ms : { type: Type.INTEGER, description: 'Per-agent timeout in ms. Default: 120000.' },
      },
      required: ['agents'],
    },
  },

  {
    name: 'spawn_subagent',
    description: 'Spawn a single focused sub-agent for one specific task and wait for its result.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id                  : { type: Type.STRING,  description: 'Short label for this agent.' },
        role                : { type: Type.STRING,  description: 'researcher | coder | reviewer | tester | planner | writer | analyst | custom' },
        task                : { type: Type.STRING,  description: 'The specific task for this agent.' },
        custom_system_prompt: { type: Type.STRING,  description: 'Only for role="custom".' },
        context             : { type: Type.STRING,  description: 'Optional context prepended to the task.' },
        timeout_ms          : { type: Type.INTEGER, description: 'Timeout in ms. Default: 120000.' },
      },
      required: ['id', 'role', 'task'],
    },
  },
];

// ─────────────────────────────────────────────
//  Executor
// ─────────────────────────────────────────────
export async function executeSubagentTool_Router(name, args) {
  switch (name) {

    case 'spawn_subagents': {
      const { agents, context, timeout_ms = 120_000 } = args;

      if (!Array.isArray(agents) || agents.length === 0)
        throw new Error('agents must be a non-empty array.');
      if (agents.length > 8)
        throw new Error('Maximum 8 sub-agents per spawn call.');

      const invalidRoles = agents.filter((a) => !ROLE_PROMPTS[a.role] && a.role !== 'custom');
      if (invalidRoles.length > 0) {
        const bad   = invalidRoles.map((a) => `"${a.role}"`).join(', ');
        const valid = [...Object.keys(ROLE_PROMPTS), 'custom'].join(', ');
        throw new Error(`Unknown role(s): ${bad}. Valid: ${valid}`);
      }

      const startTime = Date.now();

      const settled = await Promise.allSettled(
        agents.map((a) => runSubagent({
          id: a.id, role: a.role, task: a.task,
          customSystemPrompt: a.custom_system_prompt,
          context, timeoutMs: timeout_ms,
        }))
      );

      const outcomes = settled.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { id: agents[i].id, role: agents[i].role, status: 'error', error: r.reason?.message ?? 'Unknown', elapsed_ms: null, iterations: null }
      );

      const succeeded = outcomes.filter((o) => o.status === 'success').length;

      return {
        summary         : `${agents.length} sub-agents ran in parallel. ${succeeded} succeeded, ${outcomes.length - succeeded} failed/timed out.`,
        total_elapsed_ms: Date.now() - startTime,
        results         : outcomes,
      };
    }

    case 'spawn_subagent': {
      const { id, role, task, custom_system_prompt, context, timeout_ms = 120_000 } = args;

      if (!ROLE_PROMPTS[role] && role !== 'custom') {
        const valid = [...Object.keys(ROLE_PROMPTS), 'custom'].join(', ');
        throw new Error(`Unknown role: "${role}". Valid: ${valid}`);
      }

      return runSubagent({ id, role, task, customSystemPrompt: custom_system_prompt, context, timeoutMs: timeout_ms });
    }

    default:
      throw new Error(`Unknown subagent tool: "${name}"`);
  }
}
