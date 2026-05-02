import fs from 'fs';
import path from 'path';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations (sent to Gemini)
// ─────────────────────────────────────────────
export const fileSystemDeclarations = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path. Returns the file text. Use this to inspect code, configs, logs, or any text file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Absolute or relative path to the file, e.g. "/home/user/app/index.js" or "./README.md"',
        },
        max_lines: {
          type: Type.INTEGER,
          description: 'Optional: maximum number of lines to read. Omit to read the whole file.',
        },
      },
      required: ['path'],
    },
  },

  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Use for saving code, configs, notes, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Absolute or relative path to the file.',
        },
        content: {
          type: Type.STRING,
          description: 'The full text content to write to the file.',
        },
        append: {
          type: Type.BOOLEAN,
          description: 'If true, appends to the existing file instead of overwriting. Default: false.',
        },
      },
      required: ['path', 'content'],
    },
  },

  {
    name: 'list_directory',
    description: 'List the files and subdirectories inside a directory. Shows names, types, and file sizes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to the directory to list. Defaults to current working directory if omitted.',
        },
        show_hidden: {
          type: Type.BOOLEAN,
          description: 'If true, include hidden files (starting with .). Default: false.',
        },
      },
      required: [],
    },
  },

  {
    name: 'create_directory',
    description: 'Create a new directory (and any required parent directories) at the given path.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path of the directory to create.',
        },
      },
      required: ['path'],
    },
  },

  {
    name: 'move_file',
    description: 'Move or rename a file or directory from source to destination.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        source: {
          type: Type.STRING,
          description: 'Current path of the file or directory.',
        },
        destination: {
          type: Type.STRING,
          description: 'New path for the file or directory.',
        },
      },
      required: ['source', 'destination'],
    },
  },

  {
    name: 'delete_file',
    description: 'Delete a file or an empty directory at the given path. Use with caution — this is irreversible.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to the file or directory to delete.',
        },
      },
      required: ['path'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementations
// ─────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export async function executeFileSystemTool(name, args) {
  switch (name) {
    case 'read_file': {
      const filePath = path.resolve(args.path);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error(`Path is not a file: ${filePath}`);

      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n');

      if (args.max_lines && args.max_lines > 0) {
        const truncated = lines.slice(0, args.max_lines).join('\n');
        return {
          path: filePath,
          content: truncated,
          total_lines: lines.length,
          lines_returned: Math.min(args.max_lines, lines.length),
          truncated: lines.length > args.max_lines,
          size: formatBytes(stat.size),
        };
      }

      return {
        path: filePath,
        content: raw,
        lines: lines.length,
        size: formatBytes(stat.size),
      };
    }

    case 'write_file': {
      const filePath = path.resolve(args.path);
      const dir = path.dirname(filePath);

      // Ensure parent directory exists
      fs.mkdirSync(dir, { recursive: true });

      if (args.append) {
        fs.appendFileSync(filePath, args.content, 'utf8');
        return { success: true, action: 'appended', path: filePath, bytes_written: Buffer.byteLength(args.content, 'utf8') };
      } else {
        fs.writeFileSync(filePath, args.content, 'utf8');
        return { success: true, action: 'written', path: filePath, bytes_written: Buffer.byteLength(args.content, 'utf8') };
      }
    }

    case 'list_directory': {
      const dirPath = path.resolve(args.path || process.cwd());
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
      }

      const entries = fs.readdirSync(dirPath);
      const showHidden = args.show_hidden ?? false;

      const items = entries
        .filter((name) => showHidden || !name.startsWith('.'))
        .map((name) => {
          const fullPath = path.join(dirPath, name);
          try {
            const stat = fs.statSync(fullPath);
            return {
              name,
              type: stat.isDirectory() ? 'directory' : 'file',
              size: stat.isDirectory() ? null : formatBytes(stat.size),
              modified: stat.mtime.toISOString().split('T')[0],
            };
          } catch {
            return { name, type: 'unknown' };
          }
        })
        .sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });

      return { path: dirPath, items, count: items.length };
    }

    case 'create_directory': {
      const dirPath = path.resolve(args.path);
      fs.mkdirSync(dirPath, { recursive: true });
      return { success: true, path: dirPath };
    }

    case 'move_file': {
      const src = path.resolve(args.source);
      const dest = path.resolve(args.destination);
      if (!fs.existsSync(src)) throw new Error(`Source not found: ${src}`);
      fs.renameSync(src, dest);
      return { success: true, from: src, to: dest };
    }

    case 'delete_file': {
      const filePath = path.resolve(args.path);
      if (!fs.existsSync(filePath)) throw new Error(`Path not found: ${filePath}`);

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        fs.rmdirSync(filePath); // only deletes empty dirs for safety
      } else {
        fs.unlinkSync(filePath);
      }
      return { success: true, deleted: filePath };
    }

    default:
      throw new Error(`Unknown filesystem tool: ${name}`);
  }
}