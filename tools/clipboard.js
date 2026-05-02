import { execSync, spawnSync } from 'child_process';
import os from 'os';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const clipboardDeclarations = [
  {
    name: 'read_clipboard',
    description: 'Read the current contents of the system clipboard. Useful when the user says "use what I copied" or wants to process clipboard data.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  {
    name: 'write_clipboard',
    description: 'Write text to the system clipboard so the user can paste it anywhere.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: 'The text to copy to the clipboard.',
        },
      },
      required: ['content'],
    },
  },
];

// ─────────────────────────────────────────────
//  Platform detection
// ─────────────────────────────────────────────
function getClipboardCommand() {
  const platform = os.platform();
  if (platform === 'darwin') {
    return { read: 'pbpaste', write: 'pbcopy' };
  }
  if (platform === 'win32') {
    return { read: 'powershell Get-Clipboard', write: 'clip' };
  }
  // Linux — try xclip, then xsel, then wl-paste
  for (const tool of ['xclip', 'xsel', 'wl-paste']) {
    try {
      execSync(`which ${tool}`, { encoding: 'utf8', timeout: 2000 });
      if (tool === 'xclip')   return { read: 'xclip -selection clipboard -o', write: 'xclip -selection clipboard' };
      if (tool === 'xsel')    return { read: 'xsel --clipboard --output', write: 'xsel --clipboard --input' };
      if (tool === 'wl-paste') return { read: 'wl-paste', write: 'wl-copy' };
    } catch {}
  }
  return null;
}

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
export async function executeClipboardTool(name, args) {
  const cmds = getClipboardCommand();

  if (!cmds) {
    throw new Error(
      'No clipboard tool found. On Linux, install xclip: sudo apt install xclip'
    );
  }

  switch (name) {
    case 'read_clipboard': {
      try {
        const content = execSync(cmds.read, {
          encoding: 'utf8',
          timeout: 5000,
          shell: true,
        });
        return {
          success: true,
          content: content,
          length: content.length,
        };
      } catch (err) {
        throw new Error(`Failed to read clipboard: ${err.message}`);
      }
    }

    case 'write_clipboard': {
      try {
        // Pipe content to the write command
        const result = spawnSync(cmds.write, {
          input: args.content,
          encoding: 'utf8',
          timeout: 5000,
          shell: true,
        });

        if (result.error) throw result.error;

        return {
          success: true,
          bytes_written: Buffer.byteLength(args.content, 'utf8'),
          preview: args.content.length > 60 ? args.content.slice(0, 60) + '...' : args.content,
        };
      } catch (err) {
        throw new Error(`Failed to write clipboard: ${err.message}`);
      }
    }

    default:
      throw new Error(`Unknown clipboard tool: ${name}`);
  }
}