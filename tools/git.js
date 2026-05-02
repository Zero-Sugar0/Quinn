import { execSync } from 'child_process';
import path from 'path';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const gitDeclarations = [
  {
    name: 'git_operation',
    description:
      'Run a git operation in a repository. Supports: status, log, diff, branch, add, commit, push, pull, clone, init, stash. Safe read operations (status, log, diff, branch) run freely. Write operations (commit, push, add) are executed as requested.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          enum: ['status', 'log', 'diff', 'branch', 'add', 'commit', 'push', 'pull', 'clone', 'init', 'stash', 'show', 'remote'],
          description: 'The git operation to perform.',
        },
        args: {
          type: Type.STRING,
          description: 'Additional arguments for the operation, e.g. for "commit" pass \'-m "my message"\', for "log" pass "--oneline -10", for "clone" pass the repo URL.',
        },
        working_directory: {
          type: Type.STRING,
          description: 'Path to the git repository. Defaults to current working directory.',
        },
      },
      required: ['operation'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
export async function executeGitTool(name, args) {
  if (name !== 'git_operation') throw new Error(`Unknown git tool: ${name}`);

  const cwd = args.working_directory ? path.resolve(args.working_directory) : process.cwd();
  const extraArgs = args.args ?? '';
  const op = args.operation;

  // Build the git command
  let cmd;
  switch (op) {
    case 'status':  cmd = `git status ${extraArgs}`; break;
    case 'log':     cmd = `git log ${extraArgs || '--oneline -15'}`; break;
    case 'diff':    cmd = `git diff ${extraArgs}`; break;
    case 'branch':  cmd = `git branch ${extraArgs}`; break;
    case 'add':     cmd = `git add ${extraArgs || '.'}`; break;
    case 'commit':  cmd = `git commit ${extraArgs}`; break;
    case 'push':    cmd = `git push ${extraArgs}`; break;
    case 'pull':    cmd = `git pull ${extraArgs}`; break;
    case 'clone':   cmd = `git clone ${extraArgs}`; break;
    case 'init':    cmd = `git init ${extraArgs}`; break;
    case 'stash':   cmd = `git stash ${extraArgs}`; break;
    case 'show':    cmd = `git show ${extraArgs}`; break;
    case 'remote':  cmd = `git remote ${extraArgs || '-v'}`; break;
    default: throw new Error(`Unsupported git operation: ${op}`);
  }

  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: 30000,
      shell: true,
      maxBuffer: 1024 * 512,
    });

    return {
      success: true,
      operation: op,
      command: cmd,
      directory: cwd,
      output: output.trim(),
    };
  } catch (err) {
    return {
      success: false,
      operation: op,
      command: cmd,
      directory: cwd,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
      exit_code: err.status ?? 1,
    };
  }
}