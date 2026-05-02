import { execSync, spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const creativeDeclarations = [
  {
    name: 'send_notification',
    description:
      'Send a desktop notification to the user. Useful for alerting the user when a long task completes, reminding them of something, or drawing attention to an important result. The notification appears as a native OS notification.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'The notification title, e.g. "Quinn — Build Complete" or "Reminder".',
        },
        message: {
          type: Type.STRING,
          description: 'The notification body text.',
        },
        sound: {
          type: Type.BOOLEAN,
          description: 'Whether to play a sound with the notification. Default: true.',
        },
      },
      required: ['title', 'message'],
    },
  },

  {
    name: 'open_url_or_app',
    description:
      'Open a URL in the default browser, or open an application on the laptop. Examples: open a GitHub PR in the browser, open VS Code, open a folder in Finder/Files, open a local HTML file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description: 'The URL (https://...) or application name ("code", "firefox", "finder") or file path to open.',
        },
        app: {
          type: Type.STRING,
          description: 'Optional: force open with a specific app name, e.g. "code" to open a file in VS Code.',
        },
      },
      required: ['target'],
    },
  },

  {
    name: 'take_screenshot',
    description:
      'Take a screenshot of the screen and save it as a PNG file. Returns the file path. On macOS uses screencapture; on Linux uses scrot or gnome-screenshot.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        output_path: {
          type: Type.STRING,
          description: 'Where to save the screenshot PNG. Defaults to ~/Desktop/quinn_screenshot_<timestamp>.png.',
        },
        delay_seconds: {
          type: Type.INTEGER,
          description: 'Seconds to wait before capturing. Useful for capturing menus. Default: 0.',
        },
        window_only: {
          type: Type.BOOLEAN,
          description: 'macOS only: capture only the focused window instead of the full screen. Default: false.',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
const PLATFORM = os.platform();

function sendMacNotification(title, message, sound) {
  const soundPart = sound ? `with sound` : '';
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" ${soundPart}`;
  execSync(`osascript -e '${script}'`, { timeout: 5000 });
}

function sendLinuxNotification(title, message) {
  // Try notify-send
  try {
    execSync(`notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`, {
      timeout: 5000,
      shell: true,
    });
    return;
  } catch {}
  // Fallback: just echo to terminal
  console.log(`\n  🔔 ${title}: ${message}\n`);
}

export async function executeCreativeTool(name, args) {
  switch (name) {
    case 'send_notification': {
      const sound = args.sound !== false;
      try {
        if (PLATFORM === 'darwin') {
          sendMacNotification(args.title, args.message, sound);
        } else if (PLATFORM === 'linux') {
          sendLinuxNotification(args.title, args.message);
        } else if (PLATFORM === 'win32') {
          // PowerShell toast notification
          const ps = `
            Add-Type -AssemblyName System.Windows.Forms
            $notify = New-Object System.Windows.Forms.NotifyIcon
            $notify.Icon = [System.Drawing.SystemIcons]::Information
            $notify.Visible = $true
            $notify.ShowBalloonTip(5000, '${args.title}', '${args.message}', [System.Windows.Forms.ToolTipIcon]::Info)
          `;
          execSync(`powershell -Command "${ps}"`, { timeout: 10000, shell: true });
        }
        return { success: true, title: args.title, message: args.message };
      } catch (err) {
        throw new Error(`Notification failed: ${err.message}`);
      }
    }

    case 'open_url_or_app': {
      const target = args.target;
      let cmd;

      if (PLATFORM === 'darwin') {
        cmd = args.app
          ? `open -a "${args.app}" "${target}"`
          : `open "${target}"`;
      } else if (PLATFORM === 'linux') {
        cmd = args.app
          ? `${args.app} "${target}" &`
          : `xdg-open "${target}" &`;
      } else if (PLATFORM === 'win32') {
        cmd = args.app
          ? `start "" "${args.app}" "${target}"`
          : `start "" "${target}"`;
      } else {
        throw new Error(`Unsupported platform: ${PLATFORM}`);
      }

      execSync(cmd, { shell: true, timeout: 10000 });
      return { success: true, opened: target, app: args.app ?? 'default' };
    }

    case 'take_screenshot': {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const defaultPath = path.join(os.homedir(), 'Desktop', `quinn_screenshot_${timestamp}.png`);
      const outputPath = path.resolve(args.output_path ?? defaultPath);
      const delay = args.delay_seconds ?? 0;

      // Ensure output dir exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      if (PLATFORM === 'darwin') {
        const windowFlag = args.window_only ? '-w' : '';
        const delayFlag = delay > 0 ? `-T ${delay}` : '';
        execSync(`screencapture ${windowFlag} ${delayFlag} "${outputPath}"`, {
          timeout: (delay + 15) * 1000,
          shell: true,
        });
      } else if (PLATFORM === 'linux') {
        // Try scrot, then gnome-screenshot
        try {
          execSync(`scrot "${outputPath}"`, { timeout: 15000, shell: true });
        } catch {
          execSync(`gnome-screenshot -f "${outputPath}"`, { timeout: 15000, shell: true });
        }
      } else {
        throw new Error(`Screenshot not supported on ${PLATFORM}`);
      }

      if (!fs.existsSync(outputPath)) {
        throw new Error('Screenshot was not saved — file not found after capture.');
      }

      const stat = fs.statSync(outputPath);
      return {
        success: true,
        path: outputPath,
        size: `${(stat.size / 1024).toFixed(1)} KB`,
      };
    }

    default:
      throw new Error(`Unknown creative tool: ${name}`);
  }
}