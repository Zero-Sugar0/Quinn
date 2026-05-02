import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import ora from 'ora';
import figlet from 'figlet';
import boxen from 'boxen';
import { TOOL_NAMES } from '../tools/index.js';

// ─────────────────────────────────────────────
//  Markdown renderer setup
// ─────────────────────────────────────────────
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.cyan.bold,
    firstHeading: chalk.magenta.bold.underline,
    hr: chalk.gray,
    listitem: chalk.white,
    table: chalk.white,
    paragraph: chalk.white,
    strong: chalk.white.bold,
    em: chalk.white.italic,
    codespan: chalk.yellow,
    del: chalk.gray.strikethrough,
    link: chalk.cyan.underline,
    href: chalk.cyan.underline,
  }),
});

// ─────────────────────────────────────────────
//  Spinner helper
// ─────────────────────────────────────────────
export class Spinner {
  constructor() {
    this._ora = ora({
      spinner: 'dots',
      color: 'cyan',
      prefixText: '  ',
    });
  }

  start(text = 'Thinking...') {
    this._ora.start(chalk.gray(text));
  }

  update(text) {
    this._ora.text = chalk.gray(text);
  }

  stop() {
    this._ora.stop();
  }
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
            // Fallback if figlet fails
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
      chalk.gray("Your terminal companion — 15 tools, one conversation."),
      '',
      chalk.gray('Type ') + chalk.cyan('/help') + chalk.gray(' for commands, ') +
      chalk.cyan('/exit') + chalk.gray(' to quit.'),
    ].join('\n');

    console.log(
      boxen(lines, {
        padding: { top: 1, bottom: 1, left: 2, right: 2 },
        margin: { top: 0, bottom: 0, left: 1, right: 0 },
        borderStyle: 'round',
        borderColor: 'cyan',
        dimBorder: false,
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

    // Indent the markdown output
    const rendered = marked(text);
    const indented = rendered
      .split('\n')
      .map((line) => '    ' + line)
      .join('\n');

    console.log(indented);
  },

  // ── Tool usage display ───────────────────────
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

  // ── Error ────────────────────────────────────
  printError(msg) {
    console.log();
    console.log(
      boxen(chalk.red.bold('  Error: ') + chalk.red(msg), {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { left: 1 },
        borderStyle: 'round',
        borderColor: 'red',
      })
    );
  },

  // ── Goodbye ──────────────────────────────────
  printGoodbye() {
    console.log();
    console.log(
      chalk.gray('  ') + chalk.cyan('Quinn: ') + chalk.gray("Take care. See you next time.\n")
    );
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
    console.log(chalk.gray('  • "Read my clipboard and summarize it" works'));
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