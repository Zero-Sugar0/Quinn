import { execSync } from 'child_process';
import path from 'path';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const shellDeclarations = [
  {
    name: 'run_command',
    description:
      'Execute a shell command on the laptop and return its output. Use for running scripts, installing packages, compiling code, checking tool versions, etc. Avoid commands that require interactive input.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'The shell command to run, e.g. "ls -la" or "npm run build" or "python3 script.py".',
        },
        working_directory: {
          type: Type.STRING,
          description: 'Directory to run the command in. Defaults to current working directory.',
        },
        timeout_seconds: {
          type: Type.INTEGER,
          description: 'Max seconds to wait before killing the process. Default: 30.',
        },
      },
      required: ['command'],
    },
  },

  {
    name: 'search_files',
    description:
      'Search for a text pattern inside files in a directory (like grep). Returns matching lines with file paths and line numbers. Great for finding where something is defined or used in a codebase.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: {
          type: Type.STRING,
          description: 'The text or regex pattern to search for.',
        },
        directory: {
          type: Type.STRING,
          description: 'Directory to search in. Defaults to current working directory.',
        },
        file_extension: {
          type: Type.STRING,
          description: 'Optional file extension filter, e.g. "js", "py", "ts". Searches all files if omitted.',
        },
        case_sensitive: {
          type: Type.BOOLEAN,
          description: 'Whether the search is case-sensitive. Default: false.',
        },
        max_results: {
          type: Type.INTEGER,
          description: 'Maximum number of matching lines to return. Default: 50.',
        },
      },
      required: ['pattern'],
    },
  },
];

// ─────────────────────────────────────────────
//  Blocked command patterns (safety)
// ─────────────────────────────────────────────
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/[^/]/,   // rm -rf / or /root etc
  /mkfs/,                  // format drives
  /dd\s+if=/,              // low-level disk write
  /:(){ :|:& };:/,         // fork bomb
  /chmod\s+-R\s+777\s+\//,
];

function isSafeCommand(cmd) {
  return !BLOCKED_PATTERNS.some((re) => re.test(cmd));
}

// ─────────────────────────────────────────────
//  Implementations
// ─────────────────────────────────────────────
export async function executeShellTool(name, args) {
  switch (name) {
    case 'run_command': {
      if (!isSafeCommand(args.command)) {
        throw new Error(`Command blocked for safety reasons: "${args.command}"`);
      }

      const cwd = args.working_directory ? path.resolve(args.working_directory) : process.cwd();
      const timeout = (args.timeout_seconds ?? 30) * 1000;

      try {
        const output = execSync(args.command, {
          cwd,
          timeout,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 5, // 5MB
          shell: true,
        });

        return {
          success: true,
          command: args.command,
          cwd,
          stdout: output.trim(),
          exit_code: 0,
        };
      } catch (err) {
        return {
          success: false,
          command: args.command,
          cwd,
          stdout: (err.stdout || '').trim(),
          stderr: (err.stderr || err.message || '').trim(),
          exit_code: err.status ?? 1,
        };
      }
    }

    case 'search_files': {
      const dir = path.resolve(args.directory || process.cwd());
      const caseFlag = args.case_sensitive ? '' : '-i';
      const maxResults = args.max_results ?? 50;

      let grepCmd;
      if (args.file_extension) {
        const ext = args.file_extension.replace(/^\./, '');
        grepCmd = `grep -rn ${caseFlag} --include="*.${ext}" -m ${maxResults} "${args.pattern}" "${dir}"`;
      } else {
        grepCmd = `grep -rn ${caseFlag} -m ${maxResults} "${args.pattern}" "${dir}"`;
      }

      // Add line limit via head
      grepCmd += ` | head -n ${maxResults}`;

      try {
        const output = execSync(grepCmd, {
          encoding: 'utf8',
          maxBuffer: 1024 * 512,
          shell: true,
        }).trim();

        if (!output) {
          return { matches: [], count: 0, pattern: args.pattern, directory: dir };
        }

        const matches = output.split('\n').map((line) => {
          const parts = line.split(':');
          return {
            file: parts[0],
            line_number: parseInt(parts[1], 10) || null,
            content: parts.slice(2).join(':').trim(),
          };
        });

        return { matches, count: matches.length, pattern: args.pattern, directory: dir };
      } catch (err) {
        // grep exits with code 1 when no matches — not an error
        if (err.status === 1 && !err.stderr) {
          return { matches: [], count: 0, pattern: args.pattern, directory: dir };
        }
        throw new Error(`Search failed: ${err.message}`);
      }
    }

    default:
      throw new Error(`Unknown shell tool: ${name}`);
  }
}