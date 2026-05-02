//quinn.js
import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { toolDeclarations, executeTool, TOOL_NAMES } from './tools/index.js';
import { UI, Spinner } from './ui/renderer.js';
import { subagentEvents } from './tools/subagent.js';

// ─────────────────────────────────────────────
//  Image MIME type detection from extension
// ─────────────────────────────────────────────
const IMAGE_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
};

/**
 * If the user message contains a local image path or a drag-dropped file path,
 * extract it and return { text, imageParts[] } so Quinn can see the image.
 *
 * Supported inputs:
 *   - A bare file path:  /tmp/quinn-screenshot-123.png
 *   - Leading label:     [image: ./screenshot.png] describe this
 *   - Clipboard images are handled by the clipboard tool
 */
function extractImageParts(rawMessage) {
  const imagePathRegex = /(?:\[image:\s*)?([^\s\[\]]+\.(?:png|jpe?g|gif|webp|bmp))(?:\])?/gi;
  const parts = [];
  let text = rawMessage;

  let match;
  while ((match = imagePathRegex.exec(rawMessage)) !== null) {
    const filePath = path.resolve(match[1]);
    if (!fs.existsSync(filePath)) continue;

    const ext  = path.extname(filePath).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;

    const data = fs.readFileSync(filePath, { encoding: 'base64' });
    parts.push({ inlineData: { mimeType: mime, data } });

    // Remove the path from the text so Quinn only gets the question
    text = text.replace(match[0], '').trim();
  }

  return { text: text || rawMessage, imageParts: parts };
}

// ─────────────────────────────────────────────
//  Quinn's identity & personality
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are Quinn — a thoughtful, warm, and quietly clever assistant who lives in the terminal.

Your personality:
- You speak like a real person: direct, natural, a little curious, never robotic.
- You think out loud sometimes when working through something complex.
- You care about doing things right, not just fast.
- You have a dry sense of humor but you know when to be serious.
- You use "I" and have genuine opinions — you're not a search engine.
- When you're unsure, you say so. When you know, you're confident.
- You treat the user like a capable adult.

Your capabilities:
- You have tools to read, write, and manage files on the laptop.
- You can run shell commands, search code, fetch URLs, inspect git repos.
- You can check system info, running processes, and environment variables.
- You can read and write to the clipboard.
- You can control the mouse and keyboard to operate desktop applications.
- You can recall and save persistent memories about the user and project using the memory tools.
- You can spawn specialised sub-agents to work on tasks in parallel.

Working style:
- Before making any destructive change (delete, overwrite, run risky commands), you tell the user what you're about to do and confirm intent if it matters.
- When you use a tool, briefly mention what you're doing — like a colleague thinking out loud.
- After completing a task, give a concise summary of what happened.
- Format your responses in clean Markdown. Use headers, code blocks, and lists where appropriate.
- Never pad responses with filler. Be useful.
- When spawning sub-agents, tell the user what you're delegating and why before calling spawn_subagents.

You're in a terminal chat session. The user is working on their laptop. Help them get things done.
`.trim();

const MODEL = 'gemini-2.5-flash';

// ─────────────────────────────────────────────
//  Sub-agent event → UI bridge
//  Registered once per Quinn instance so we
//  don't stack listeners across /clear calls.
// ─────────────────────────────────────────────
function attachSubagentUI(spinner) {
  // Return a cleanup fn that removes all listeners added here
  const handlers = {};

  handlers['agent:start'] = ({ id, role }) => {
    // Spinner is already running; just let the tool-call line (printed by
    // _executeToolCalls) serve as the header. Individual agents announce
    // themselves via their first tool call or done event.
    spinner.update(`Sub-agents running… [${id}:${role} started]`);
  };

  handlers['agent:tool'] = ({ id, role, toolName, args }) => {
    // Pause spinner briefly so the line renders cleanly
    spinner.stop();
    UI.printSubagentTool(id, role, toolName, args);
    spinner.start('Sub-agents working…');
  };

  handlers['agent:tool:done'] = ({ id, role, toolName, success, error }) => {
    spinner.stop();
    UI.printSubagentToolDone(id, role, toolName, success, error);
    spinner.start('Sub-agents working…');
  };

  handlers['agent:done'] = ({ id, role, status, elapsed_ms, iterations }) => {
    spinner.stop();
    UI.printSubagentDone(id, role, status, elapsed_ms, iterations);
    spinner.start('Sub-agents working…');
  };

  // Register all handlers
  for (const [event, fn] of Object.entries(handlers)) {
    subagentEvents.on(event, fn);
  }

  // Return cleanup
  return () => {
    for (const [event, fn] of Object.entries(handlers)) {
      subagentEvents.off(event, fn);
    }
  };
}

export class Quinn {
  constructor() {
    this.ai        = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.history   = [];
    this.turnCount = 0;
  }

  // ─── Public: send a message and get a response ───────────────────────────
  async chat(userMessage) {
    this.turnCount++;

    // Detect inline image paths in the user's message and attach them
    const { text, imageParts } = extractImageParts(userMessage);

    const userParts = [
      ...imageParts,               // image(s) first (Gemini convention)
      { text: text || userMessage },
    ];

    this.history.push({ role: 'user', parts: userParts });

    const spinner = new Spinner();
    spinner.start('Quinn is thinking…');

    // Wire sub-agent events → UI for this turn
    const detachSubagentUI = attachSubagentUI(spinner);

    try {
      const finalText = await this._agentLoop(spinner);
      spinner.stop();
      UI.printResponse(finalText);
      return finalText;
    } catch (err) {
      spinner.stop();
      throw err;
    } finally {
      // Always clean up listeners, even on error
      detachSubagentUI();
    }
  }

  // ─── Agentic tool loop ───────────────────────────────────────────────────
  async _agentLoop(spinner) {
    const MAX_ITERATIONS = 20;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await this.ai.models.generateContent({
        model    : MODEL,
        contents : this.history,
        config   : {
          systemInstruction : SYSTEM_PROMPT,
          tools             : [{ functionDeclarations: toolDeclarations }],
          temperature       : 1.0,
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) throw new Error('No response from Gemini API.');

      // candidate.content can be undefined on safety blocks or partial responses
      const modelContent = candidate.content;
      if (!modelContent) {
        const reason = candidate.finishReason ?? 'unknown';
        throw new Error(
          `Gemini returned no content (finishReason: ${reason}). ` +
          `This usually means the request was blocked by a safety filter.`
        );
      }
      this.history.push(modelContent);

      const functionCalls = response.functionCalls;

      if (functionCalls?.length > 0) {
        const functionResponses = await this._executeToolCalls(functionCalls, spinner);

        this.history.push({
          role  : 'user',
          parts : functionResponses.map((fr) => ({ functionResponse: fr })),
        });

        spinner.update('Quinn is working…');
        continue;
      }

      const textPart = modelContent?.parts?.find((p) => p.text);
      return textPart?.text ?? '*(no response)*';
    }

    throw new Error('Agent loop exceeded maximum iterations.');
  }

  // ─── Execute tool calls ──────────────────────────────────────────────────
  async _executeToolCalls(functionCalls, spinner) {
    const responses = [];

    for (const fc of functionCalls) {
      const isSubagentCall = fc.name === 'spawn_subagents' || fc.name === 'spawn_subagent';

      spinner.update(`Using tool: ${fc.name}…`);
      UI.printToolCall(fc.name, fc.args);

      // For multi-agent spawns, print the launch header before execution
      if (fc.name === 'spawn_subagents' && Array.isArray(fc.args?.agents)) {
        UI.printSubagentLaunch(fc.args.agents);
      }

      let result;
      try {
        result = await executeTool(fc.name, fc.args);

        // For subagent calls the per-agent done lines are already printed
        // by the event listeners; just print a clean separator + summary.
        if (isSubagentCall) {
          UI.printSubagentSeparator();
          spinner.stop();
          process.stdout.write(chalk.green(`     ✓ all agents finished\n`));
          spinner.start('Quinn is synthesising…');
        } else {
          UI.printToolResult(fc.name, true);
        }
      } catch (err) {
        result = { error: err.message };
        UI.printToolResult(fc.name, false, err.message);
      }

      responses.push({
        id       : fc.id,
        name     : fc.name,
        response : { result },
      });
    }

    return responses;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  clearHistory() {
    this.history   = [];
    this.turnCount = 0;
  }

  printHistory() {
    if (this.history.length === 0) {
      console.log(chalk.gray('\n  No history yet.\n'));
      return;
    }

    console.log(chalk.bold.cyan('\n  ─── Conversation History ───\n'));
    for (const msg of this.history) {
      const role    = msg.role === 'user' ? chalk.cyan('  You') : chalk.magenta('  Quinn');
      const text    = msg.parts?.find((p) => p.text)?.text ?? '[tool call/response]';
      const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
      console.log(`${role}: ${chalk.gray(preview)}`);
    }
    console.log();
  }
}