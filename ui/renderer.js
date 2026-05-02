// ui/renderer.js

import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import ora from 'ora';
import figlet from 'figlet';
import boxen from 'boxen';
import { TOOL_NAMES } from '../tools/index.js';
import { ROLE_BADGE } from '../tools/subagent.js';

// ─────────────────────────────────────────────
//  Markdown renderer setup
// ─────────────────────────────────────────────
marked.setOptions({
  renderer: new TerminalRenderer({
    code          : chalk.yellow,
    blockquote    : chalk.gray.italic,
    html          : chalk.gray,
    heading       : chalk.cyan.bold,
    firstHeading  : chalk.magenta.bold.underline,
    hr            : chalk.gray,
    listitem      : chalk.white,
    table         : chalk.white,
    paragraph     : chalk.white,
    strong        : chalk.white.bold,
    em            : chalk.white.italic,
    codespan      : chalk.yellow,
    del           : chalk.gray.strikethrough,
    link          : chalk.cyan.underline,
    href          : chalk.cyan.underline,
  }),
});

// ─────────────────────────────────────────────
//  Spinner helper
// ─────────────────────────────────────────────
export class Spinner {
  constructor() {
    this._ora = ora({
      spinner    : 'dots',
      color      : 'cyan',
      prefixText : '  ',
    });
  }

  start(text = 'Thinking...') { this._ora.start(chalk.gray(text)); }
  update(text)                { this._ora.text = chalk.gray(text); }
  stop()                      { this._ora.stop(); }
}

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

// Column widths for the sub-agent live table
const COL_ID   = 14;  // agent id column
const COL_TOOL = 24;  // tool name column

function pad(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s.slice(0, len - 1) + '…' : s.padEnd(len);
}

function formatMs(ms) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ─────────────────────────────────────────────
//  Main UI class
// ─────────────────────────────────────────────
export const UI = {

  // ── Banner ──────────────────────────────────
  printBanner() {
    return new Promise((resolve) => {
      figlet.text(
        'QUINN',
        { font: 'ANSI Shadow', horizontalLayout: 'default', verticalLayout: 'default' },
        (err, data) => {
          console.clear();
          if (!err && data) {
            console.log(chalk.cyan(data));
          } else {
            console.log(chalk.cyan.bold('\n  ██████╗ ██╗   ██╗██╗███╗   ██╗███╗   ██╗'));
            console.log(chalk.cyan.bold('  ██╔═══██╗██║   ██║██║████╗  ██║████╗  ██║'));
            console.log(chalk.cyan.bold('  ██║   ██║██║   ██║██║██╔██╗ ██║██╔██╗ ██║'));
            console.log(chalk.cyan.bold('  ██║▄▄ ██║██║   ██║██║██║╚██╗██║██║╚██╗██║'));
            console.log(chalk.cyan.bold('  ╚██████╔╝╚██████╔╝██║██║ ╚████║██║ ╚████║'));
            console.log(chalk.cyan.bold('   ╚══▀▀═╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝╚═╝  ╚═══╝\n'));
          }
          resolve();
        }
      );
    });
  },

  // ── Welcome ─────────────────────────────────
  printWelcome() {
    const lines = [
      chalk.white.bold("Hey, I'm Quinn."),
      chalk.gray("Your terminal companion — 25 tools, one conversation."),
      '',
      chalk.gray('Type ') + chalk.cyan('/help') + chalk.gray(' for commands, ') +
      chalk.cyan('/exit') + chalk.gray(' to quit.'),
    ].join('\n');

    console.log(
      boxen(lines, {
        padding     : { top: 1, bottom: 1, left: 2, right: 2 },
        margin      : { top: 0, bottom: 0, left: 1, right: 0 },
        borderStyle : 'round',
        borderColor : 'cyan',
        dimBorder   : false,
      })
    );
    console.log();
  },

  // ── Quinn's response ─────────────────────────
  printResponse(text) {
    if (!text) return;
    console.log();
    console.log(chalk.magenta.bold('  Quinn ❯'));
    console.log();
    const rendered = marked(text);
    const indented = rendered.split('\n').map((l) => '    ' + l).join('\n');
    console.log(indented);
  },

  // ── Tool usage display (parent agent) ───────
  printToolCall(toolName, toolArgs) {
    const argsStr = Object.entries(toolArgs || {})
      .map(([k, v]) => {
        const val = String(v);
        const truncated = val.length > 50 ? val.slice(0, 50) + '…' : val;
        return `${chalk.gray(k + ':')} ${chalk.yellow(truncated)}`;
      })
      .join('  ');

    console.log(
      '\n  ' +
      chalk.blue('⚙') + '  ' +
      chalk.blue.bold(toolName) +
      (argsStr ? '  ' + argsStr : '')
    );
  },

  printToolResult(toolName, success, errorMsg) {
    if (success) {
      process.stdout.write(chalk.green('     ✓ done\n'));
    } else {
      process.stdout.write(chalk.red(`     ✗ failed: ${errorMsg || 'unknown error'}\n`));
    }
  },

  // ── Sub-agent live display ───────────────────
  //
  // Visual anatomy for a parallel spawn:
  //
  //   ┌─ Sub-agents launching (3 parallel) ──────────────────────┐
  //   │  🔍 research   waiting...                                 │
  //   │  💻 code       waiting...                                 │
  //   │  🔎 review     waiting...                                 │
  //   └───────────────────────────────────────────────────────────┘
  //
  //   🔍 research   → fetch_url           fetching docs...
  //   💻 code       → read_file           reading source...
  //   🔍 research   ✓ fetch_url
  //   🔍 research   → search              searching npm...
  //   💻 code       ✓ read_file
  //   🔎 review     → read_file           reading source...
  //   ...
  //   🔍 research   ✔ done  (3.1s, 4 iters)
  //   💻 code       ✔ done  (4.8s, 6 iters)
  //   🔎 review     ✔ done  (2.9s, 3 iters)
  //

  printSubagentLaunch(agents) {
    console.log();
    console.log(
      chalk.blue.bold(`  ┌─ Sub-agents launching`) +
      chalk.gray(` (${agents.length} parallel) `) +
      chalk.blue.bold('─'.repeat(Math.max(0, 40 - agents.length.toString().length)))
    );
    for (const a of agents) {
      const badge = ROLE_BADGE[a.role] ?? '⚡';
      console.log(
        chalk.blue('  │  ') +
        badge + '  ' +
        chalk.cyan(pad(a.id, COL_ID)) +
        chalk.gray('waiting...')
      );
    }
    console.log(chalk.blue('  └' + '─'.repeat(54)));
    console.log();
  },

  printSubagentTool(id, role, toolName, args) {
    const badge    = ROLE_BADGE[role] ?? '⚡';
    // Show one key arg as a hint (first string value, truncated)
    const hint = args
      ? Object.values(args).find((v) => typeof v === 'string')?.slice(0, 32) ?? ''
      : '';

    process.stdout.write(
      '  ' +
      chalk.gray(badge + '  ') +
      chalk.cyan(pad(id, COL_ID)) +
      chalk.gray('→ ') +
      chalk.yellow(pad(toolName, COL_TOOL)) +
      (hint ? chalk.gray(hint) : '') +
      '\n'
    );
  },

  printSubagentToolDone(id, role, toolName, success, errorMsg) {
    const badge = ROLE_BADGE[role] ?? '⚡';
    const mark  = success ? chalk.green('✓') : chalk.red('✗');

    process.stdout.write(
      '  ' +
      chalk.gray(badge + '  ') +
      chalk.cyan(pad(id, COL_ID)) +
      mark + ' ' +
      chalk.gray(toolName) +
      (errorMsg ? chalk.red('  ' + errorMsg.slice(0, 40)) : '') +
      '\n'
    );
  },

  printSubagentDone(id, role, status, elapsed_ms, iterations) {
    const badge = ROLE_BADGE[role] ?? '⚡';

    const statusStr = status === 'success'
      ? chalk.green('✔ done')
      : status === 'timeout'
        ? chalk.yellow('⏱ timeout')
        : chalk.red('✗ failed');

    const meta = chalk.gray(`(${formatMs(elapsed_ms)}, ${iterations ?? '?'} iter${iterations === 1 ? '' : 's'})`);

    console.log(
      '  ' +
      badge + '  ' +
      chalk.cyan(pad(id, COL_ID)) +
      statusStr + '  ' + meta
    );
  },

  printSubagentSeparator() {
    console.log(chalk.gray('  ' + '─'.repeat(56)));
  },

  // ── Error ────────────────────────────────────
  printError(msg) {
    console.log();
    console.log(
      boxen(chalk.red.bold('  Error: ') + chalk.red(msg), {
        padding     : { top: 0, bottom: 0, left: 1, right: 1 },
        margin      : { left: 1 },
        borderStyle : 'round',
        borderColor : 'red',
      })
    );
  },

  // ── Goodbye ──────────────────────────────────
  printGoodbye() {
    console.log();
    console.log(chalk.gray('  ') + chalk.cyan('Quinn: ') + chalk.gray("Take care. See you next time.\n"));
  },

  // ── Help ─────────────────────────────────────
  printHelp() {
    const commands = [
      ['/help',    'Show this help message'],
      ['/tools',   'List all available tools'],
      ['/history', 'Preview conversation history'],
      ['/clear',   'Clear conversation context'],
      ['/exit',    'Quit Quinn'],
    ];

    console.log();
    console.log(chalk.cyan.bold('  Commands'));
    console.log(chalk.gray('  ─────────────────────────────────'));
    for (const [cmd, desc] of commands) {
      console.log(`  ${chalk.cyan(cmd.padEnd(12))} ${chalk.gray(desc)}`);
    }
    console.log();
    console.log(chalk.cyan.bold('  Tips'));
    console.log(chalk.gray('  ─────────────────────────────────'));
    console.log(chalk.gray('  • Quinn can read, write, and search your files'));
    console.log(chalk.gray('  • Ask Quinn to run commands or check git status'));
    console.log(chalk.gray('  • Quinn can fetch URLs and call APIs'));
    console.log(chalk.gray('  • "Research X, code Y, and review it all at once" works'));
    console.log();
  },

  // ── Tool list ─────────────────────────────────
  printToolList() {
    console.log();
    console.log(chalk.cyan.bold(`  Tools (${TOOL_NAMES.length} available)`));
    console.log(chalk.gray('  ─────────────────────────────────────────────────'));
    for (const tool of TOOL_NAMES) {
      const desc = tool.description.length > 60
        ? tool.description.slice(0, 60) + '…'
        : tool.description;
      console.log(`  ${chalk.yellow(tool.name.padEnd(30))} ${chalk.gray(desc)}`);
    }
    console.log();
  },
};