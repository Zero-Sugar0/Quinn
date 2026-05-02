import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import { toolDeclarations, executeTool, TOOL_NAMES } from './tools/index.js';
import { UI, Spinner } from './ui/renderer.js';

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

Working style:
- Before making any destructive change (delete, overwrite, run risky commands), you tell the user what you're about to do and confirm intent if it matters.
- When you use a tool, briefly mention what you're doing — like a colleague thinking out loud.
- After completing a task, give a concise summary of what happened.
- Format your responses in clean Markdown. Use headers, code blocks, and lists where appropriate.
- Never pad responses with filler. Be useful.

You're in a terminal chat session. The user is working on their laptop. Help them get things done.
`.trim();

const MODEL = 'gemini-2.5-flash';

export class Quinn {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.history = [];
    this.turnCount = 0;
  }

  // ─── Public: send a message and get a response ───────────────────────────
  async chat(userMessage) {
    this.turnCount++;

    // Add user message to history
    this.history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    const spinner = new Spinner();
    spinner.start('Quinn is thinking...');

    try {
      const finalText = await this._agentLoop(spinner);
      spinner.stop();
      UI.printResponse(finalText);
      return finalText;
    } catch (err) {
      spinner.stop();
      throw err;
    }
  }

  // ─── Agentic tool loop ───────────────────────────────────────────────────
  async _agentLoop(spinner) {
    const MAX_ITERATIONS = 20; // safety guard
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await this.ai.models.generateContent({
        model: MODEL,
        contents: this.history,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: toolDeclarations }],
          temperature: 1.0, // recommended for Gemini 3 series
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) throw new Error('No response from Gemini API.');

      const modelContent = candidate.content;

      // Push model's turn into history
      this.history.push(modelContent);

      // Check for function calls
      const functionCalls = response.functionCalls;

      if (functionCalls && functionCalls.length > 0) {
        // Execute all function calls (potentially parallel)
        const functionResponses = await this._executeToolCalls(functionCalls, spinner);

        // Push all tool results as a single user turn
        this.history.push({
          role: 'user',
          parts: functionResponses.map((fr) => ({ functionResponse: fr })),
        });

        // Update spinner and loop again
        spinner.update('Quinn is working...');
        continue;
      }

      // No more function calls — extract final text
      const textPart = modelContent.parts?.find((p) => p.text);
      return textPart?.text ?? '*(no response)*';
    }

    throw new Error('Agent loop exceeded maximum iterations.');
  }

  // ─── Execute tool calls and return responses ─────────────────────────────
  async _executeToolCalls(functionCalls, spinner) {
    const responses = [];

    for (const fc of functionCalls) {
      spinner.update(`Using tool: ${fc.name}...`);
      UI.printToolCall(fc.name, fc.args);

      let result;
      try {
        result = await executeTool(fc.name, fc.args);
        UI.printToolResult(fc.name, true);
      } catch (err) {
        result = { error: err.message };
        UI.printToolResult(fc.name, false, err.message);
      }

      responses.push({
        id: fc.id,
        name: fc.name,
        response: { result },
      });
    }

    return responses;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  clearHistory() {
    this.history = [];
    this.turnCount = 0;
  }

  printHistory() {
    if (this.history.length === 0) {
      console.log(chalk.gray('\n  No history yet.\n'));
      return;
    }

    console.log(chalk.bold.cyan('\n  ─── Conversation History ───\n'));
    for (const msg of this.history) {
      const role = msg.role === 'user' ? chalk.cyan('  You') : chalk.magenta('  Quinn');
      const text = msg.parts?.find((p) => p.text)?.text ?? '[tool call/response]';
      const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
      console.log(`${role}: ${chalk.gray(preview)}`);
    }
    console.log();
  }
}