#!/usr/bin/env node

import readline from 'readline';
import chalk from 'chalk';
import { Quinn } from './quinn.js';
import { UI } from './ui/renderer.js';

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error(chalk.red.bold('\n  ✗ GEMINI_API_KEY is not set in your environment.\n'));
    console.error(chalk.gray('  Set it with: export GEMINI_API_KEY="your-key-here"\n'));
    process.exit(1);
  }

  await UI.printBanner();
  UI.printWelcome();

  const quinn = new Quinn();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
  });

  // Graceful exit
  rl.on('close', () => {
    UI.printGoodbye();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    UI.printGoodbye();
    process.exit(0);
  });

  const prompt = () => {
    rl.question(chalk.cyan.bold('\n  You ❯ ') + chalk.white(''), async (raw) => {
      const input = raw.trim();

      if (!input) {
        prompt();
        return;
      }

      // Built-in slash commands
      switch (input.toLowerCase()) {
        case '/exit':
        case '/quit':
          rl.close();
          return;

        case '/clear':
          quinn.clearHistory();
          console.log(chalk.gray('\n  ✓ Conversation history cleared.'));
          prompt();
          return;

        case '/history':
          quinn.printHistory();
          prompt();
          return;

        case '/tools':
          UI.printToolList();
          prompt();
          return;

        case '/help':
          UI.printHelp();
          prompt();
          return;
      }

      try {
        await quinn.chat(input);
      } catch (err) {
        UI.printError(err.message);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error(chalk.red(`\n  Fatal error: ${err.message}\n`));
  process.exit(1);
});