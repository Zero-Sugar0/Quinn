// tools/computer_use.js
//
// Desktop automation — mouse, keyboard, screen capture.
// Requires: @nut-tree/nut-js (build from source) OR the community fork:
//   npm install @nut-tree-fork/nut-js
//
// macOS: grant Accessibility + Screen Recording to your terminal app.
//   System Settings → Privacy & Security → Accessibility / Screen Recording
// Linux: X11 only. Wayland is NOT supported.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Lazy-load nut-js so Quinn still starts if
//  the package isn't installed yet.
// ─────────────────────────────────────────────
let _nut = null;
async function nut() {
  if (_nut) return _nut;
  try {
    const mod = await import('@nut-tree/nut-js');
    _nut = mod;
    return _nut;
  } catch {
    try {
      // community fork fallback
      const mod = await import('@nut-tree-fork/nut-js');
      _nut = mod;
      return _nut;
    } catch {
      throw new Error(
        'nut-js is not installed. Run: npm install @nut-tree-fork/nut-js\n' +
        'macOS users: also grant Accessibility + Screen Recording to your terminal.'
      );
    }
  }
}

// ─────────────────────────────────────────────
//  Key name → nut-js Key enum helper
// ─────────────────────────────────────────────
const KEY_ALIASES = {
  enter: 'Return', return: 'Return',
  tab: 'Tab', space: 'Space', escape: 'Escape', esc: 'Escape',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5',
  f6: 'F6', f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10',
  f11: 'F11', f12: 'F12',
  ctrl: 'LeftControl', control: 'LeftControl',
  alt: 'LeftAlt', option: 'LeftAlt',
  shift: 'LeftShift',
  cmd: 'LeftSuper', command: 'LeftSuper', meta: 'LeftSuper', super: 'LeftSuper',
  a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H',
  i: 'I', j: 'J', k: 'K', l: 'L', m: 'M', n: 'N', o: 'O', p: 'P',
  q: 'Q', r: 'R', s: 'S', t: 'T', u: 'U', v: 'V', w: 'W', x: 'X',
  y: 'Y', z: 'Z',
  '0': 'Num0', '1': 'Num1', '2': 'Num2', '3': 'Num3', '4': 'Num4',
  '5': 'Num5', '6': 'Num6', '7': 'Num7', '8': 'Num8', '9': 'Num9',
};

function resolveKeys(N, keys) {
  return keys.map((k) => {
    const lower = k.toLowerCase();
    const name = KEY_ALIASES[lower] ?? k;
    const resolved = N.Key[name];
    if (resolved === undefined) throw new Error(`Unknown key: "${k}". Try names like ctrl, alt, shift, cmd, enter, tab, a-z, f1-f12.`);
    return resolved;
  });
}

// ─────────────────────────────────────────────
//  Declarations (sent to Gemini)
// ─────────────────────────────────────────────
export const computerUseDeclarations = [
  {
    name: 'mouse_move',
    description: 'Move the mouse cursor to an absolute screen position (x, y). Use get_screen_size first to understand coordinate bounds.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        x: { type: Type.INTEGER, description: 'Horizontal pixel coordinate from the left edge of the screen.' },
        y: { type: Type.INTEGER, description: 'Vertical pixel coordinate from the top edge of the screen.' },
      },
      required: ['x', 'y'],
    },
  },

  {
    name: 'mouse_click',
    description: 'Click the mouse at the current position or at an optional (x, y). Supports left, right, middle, and double-click.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        button: {
          type: Type.STRING,
          description: 'Which button to click: "left" (default), "right", "middle", or "double".',
        },
        x: { type: Type.INTEGER, description: 'Optional x coordinate. If provided, moves mouse here before clicking.' },
        y: { type: Type.INTEGER, description: 'Optional y coordinate. If provided, moves mouse here before clicking.' },
      },
      required: [],
    },
  },

  {
    name: 'mouse_drag',
    description: 'Click and drag from one position to another. Useful for moving windows, sliders, selecting text, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from_x: { type: Type.INTEGER, description: 'Starting x coordinate.' },
        from_y: { type: Type.INTEGER, description: 'Starting y coordinate.' },
        to_x: { type: Type.INTEGER, description: 'Ending x coordinate.' },
        to_y: { type: Type.INTEGER, description: 'Ending y coordinate.' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
  },

  {
    name: 'mouse_scroll',
    description: 'Scroll the mouse wheel up or down by a given number of clicks.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: { type: Type.STRING, description: '"up" or "down".' },
        amount: { type: Type.INTEGER, description: 'Number of scroll clicks. Default: 3.' },
        x: { type: Type.INTEGER, description: 'Optional: move mouse here before scrolling.' },
        y: { type: Type.INTEGER, description: 'Optional: move mouse here before scrolling.' },
      },
      required: ['direction'],
    },
  },

  {
    name: 'key_type',
    description: 'Type a string of text as if the user typed it on the keyboard. Use for filling in text fields, search boxes, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: 'The text to type.' },
        delay_ms: { type: Type.INTEGER, description: 'Optional delay between keystrokes in milliseconds. Default: 0 (as fast as possible).' },
      },
      required: ['text'],
    },
  },

  {
    name: 'key_press',
    description: 'Press a single key or a keyboard shortcut (key combination). Use for shortcuts like Ctrl+C, Cmd+Space, pressing Enter, etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        keys: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of key names to press simultaneously. Examples: ["enter"], ["ctrl", "c"], ["cmd", "shift", "4"], ["f5"]. Valid modifiers: ctrl, alt, shift, cmd. Valid special keys: enter, tab, escape, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1-f12.',
        },
      },
      required: ['keys'],
    },
  },

  {
    name: 'capture_screen',
    description: 'Capture the current state of the screen and save it as a PNG. Returns the file path and base64-encoded image data that can be passed to a vision model.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        output_path: {
          type: Type.STRING,
          description: 'Optional: where to save the PNG. Defaults to a temp file.',
        },
        region: {
          type: Type.OBJECT,
          description: 'Optional: capture only a specific screen region.',
          properties: {
            x: { type: Type.INTEGER, description: 'Left edge of region.' },
            y: { type: Type.INTEGER, description: 'Top edge of region.' },
            width: { type: Type.INTEGER, description: 'Width of region in pixels.' },
            height: { type: Type.INTEGER, description: 'Height of region in pixels.' },
          },
        },
      },
      required: [],
    },
  },

  {
    name: 'get_mouse_position',
    description: 'Get the current x, y coordinates of the mouse cursor.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  {
    name: 'get_screen_size',
    description: 'Get the width and height of the primary display in pixels. Call this before using coordinates to understand the screen bounds.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  {
    name: 'sleep_ms',
    description: 'Pause execution for a given number of milliseconds. Useful between UI actions to let animations or page loads finish.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        duration_ms: { type: Type.INTEGER, description: 'How many milliseconds to sleep.' },
      },
      required: ['duration_ms'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementations
// ─────────────────────────────────────────────
export async function executeComputerUseTool(name, args) {
  const N = await nut();
  const { mouse, keyboard, screen, Button, Key, Point, Region, straightTo, saveImage } = N;

  switch (name) {

    case 'mouse_move': {
      await mouse.move(straightTo(new Point(args.x, args.y)));
      return { success: true, moved_to: { x: args.x, y: args.y } };
    }

    case 'mouse_click': {
      const btn = args.button?.toLowerCase() ?? 'left';

      if (args.x !== undefined && args.y !== undefined) {
        await mouse.move(straightTo(new Point(args.x, args.y)));
      }

      if (btn === 'double') {
        await mouse.doubleClick(Button.LEFT);
      } else if (btn === 'right') {
        await mouse.click(Button.RIGHT);
      } else if (btn === 'middle') {
        await mouse.click(Button.MIDDLE);
      } else {
        await mouse.click(Button.LEFT);
      }

      const pos = await mouse.getPosition();
      return { success: true, clicked: btn, at: { x: pos.x, y: pos.y } };
    }

    case 'mouse_drag': {
      await mouse.move(straightTo(new Point(args.from_x, args.from_y)));
      await mouse.pressButton(Button.LEFT);
      await mouse.move(straightTo(new Point(args.to_x, args.to_y)));
      await mouse.releaseButton(Button.LEFT);
      return {
        success: true,
        dragged_from: { x: args.from_x, y: args.from_y },
        dragged_to: { x: args.to_x, y: args.to_y },
      };
    }

    case 'mouse_scroll': {
      const amount = args.amount ?? 3;

      if (args.x !== undefined && args.y !== undefined) {
        await mouse.move(straightTo(new Point(args.x, args.y)));
      }

      if (args.direction === 'up') {
        await mouse.scrollUp(amount);
      } else if (args.direction === 'down') {
        await mouse.scrollDown(amount);
      } else {
        throw new Error('direction must be "up" or "down"');
      }

      return { success: true, scrolled: args.direction, amount };
    }

    case 'key_type': {
      if (args.delay_ms && args.delay_ms > 0) {
        keyboard.config.autoDelayMs = args.delay_ms;
      } else {
        keyboard.config.autoDelayMs = 0;
      }
      await keyboard.type(args.text);
      return { success: true, typed: args.text };
    }

    case 'key_press': {
      if (!Array.isArray(args.keys) || args.keys.length === 0) {
        throw new Error('keys must be a non-empty array of key names.');
      }

      const resolved = resolveKeys(N, args.keys);

      if (resolved.length === 1) {
        await keyboard.type(resolved[0]);
      } else {
        // Hold all modifier keys, tap the last one
        const modifiers = resolved.slice(0, -1);
        const target = resolved[resolved.length - 1];
        await keyboard.pressKey(...modifiers, target);
        await keyboard.releaseKey(...modifiers, target);
      }

      return { success: true, pressed: args.keys };
    }

    case 'capture_screen': {
      const outPath = args.output_path
        ? path.resolve(args.output_path)
        : path.join(os.tmpdir(), `quinn-screenshot-${Date.now()}.png`);

      // Ensure parent dir exists
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      let image;
      if (args.region) {
        const { x, y, width, height } = args.region;
        const region = new Region(x, y, width, height);
        image = await screen.grabRegion(region);
      } else {
        image = await screen.grab();
      }

      await saveImage(image, outPath);

      // Read back as base64 for vision model consumption
      const base64 = fs.readFileSync(outPath).toString('base64');

      return {
        success: true,
        path: outPath,
        width: image.width,
        height: image.height,
        base64_png: base64,
        note: 'base64_png can be passed to a vision model (e.g. Gemini) as an inline image.',
      };
    }

    case 'get_mouse_position': {
      const pos = await mouse.getPosition();
      return { x: pos.x, y: pos.y };
    }

    case 'get_screen_size': {
      const width = await screen.width();
      const height = await screen.height();
      return { width, height };
    }

    case 'sleep_ms': {
      await new Promise((r) => setTimeout(r, args.duration_ms));
      return { success: true, slept_ms: args.duration_ms };
    }

    default:
      throw new Error(`Unknown computer use tool: "${name}"`);
  }
}