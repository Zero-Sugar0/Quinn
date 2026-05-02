// tools/computer_use.js
//
// Desktop automation — mouse, keyboard, screen capture, and vision analysis.
// Requires: @nut-tree/nut-js (build from source) OR the community fork:
//   npm install @nut-tree-fork/nut-js
//
// macOS: grant Accessibility + Screen Recording to your terminal app.
//   System Settings → Privacy & Security → Accessibility / Screen Recording
// Linux: X11 only. Wayland is NOT supported.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleGenAI } from '@google/genai';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Lazy-load nut-js so Quinn still starts if
//  the package isn't installed yet.
// ─────────────────────────────────────────────
let _nut = null;
async function nut() {
  if (_nut) return _nut;
  try {
    _nut = await import('@nut-tree/nut-js');
    return _nut;
  } catch {
    try {
      _nut = await import('@nut-tree-fork/nut-js');
      return _nut;
    } catch {
      throw new Error(
        'nut-js is not installed. Run: npm install @nut-tree-fork/nut-js\n' +
        'macOS: also grant Accessibility + Screen Recording to your terminal.'
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
    const lower    = k.toLowerCase();
    const name     = KEY_ALIASES[lower] ?? k;
    const resolved = N.Key[name];
    if (resolved === undefined)
      throw new Error(`Unknown key: "${k}". Try: ctrl, alt, shift, cmd, enter, tab, a-z, f1-f12.`);
    return resolved;
  });
}

// ─────────────────────────────────────────────
//  Vision helper — calls Gemini with an image
// ─────────────────────────────────────────────
async function callVision(imagePart, question) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set.');

  const ai       = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model    : 'gemini-2.5-flash',
    contents : [{ parts: [imagePart, { text: question }] }],
  });

  const candidate = response.candidates?.[0];
  if (!candidate?.content) throw new Error('Vision model returned no content.');
  return candidate.content?.parts?.find((p) => p.text)?.text ?? '*(no description returned)*';
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
        x: { type: Type.INTEGER, description: 'Horizontal pixel coordinate from the left edge.' },
        y: { type: Type.INTEGER, description: 'Vertical pixel coordinate from the top edge.' },
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
        button: { type: Type.STRING, description: '"left" (default), "right", "middle", or "double".' },
        x: { type: Type.INTEGER, description: 'Optional x coordinate — moves here before clicking.' },
        y: { type: Type.INTEGER, description: 'Optional y coordinate — moves here before clicking.' },
      },
      required: [],
    },
  },

  {
    name: 'mouse_drag',
    description: 'Click and drag from one position to another. Useful for moving windows, sliders, selecting text.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from_x: { type: Type.INTEGER, description: 'Starting x coordinate.' },
        from_y: { type: Type.INTEGER, description: 'Starting y coordinate.' },
        to_x:   { type: Type.INTEGER, description: 'Ending x coordinate.' },
        to_y:   { type: Type.INTEGER, description: 'Ending y coordinate.' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
  },

  {
    name: 'mouse_scroll',
    description: 'Scroll the mouse wheel up or down.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: { type: Type.STRING, description: '"up" or "down".' },
        amount:    { type: Type.INTEGER, description: 'Number of scroll clicks. Default: 3.' },
        x: { type: Type.INTEGER, description: 'Optional: move mouse here before scrolling.' },
        y: { type: Type.INTEGER, description: 'Optional: move mouse here before scrolling.' },
      },
      required: ['direction'],
    },
  },

  {
    name: 'key_type',
    description: 'Type a string of text as if the user typed it on the keyboard.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text:     { type: Type.STRING,  description: 'The text to type.' },
        delay_ms: { type: Type.INTEGER, description: 'Delay between keystrokes in ms. Default: 0.' },
      },
      required: ['text'],
    },
  },

  {
    name: 'key_press',
    description: 'Press a single key or keyboard shortcut. Examples: ["enter"], ["ctrl","c"], ["cmd","space"], ["f5"].',
    parameters: {
      type: Type.OBJECT,
      properties: {
        keys: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Key names to press simultaneously. Modifiers: ctrl, alt, shift, cmd. Special: enter, tab, escape, backspace, delete, arrow keys, f1-f12.',
        },
      },
      required: ['keys'],
    },
  },

  {
    name: 'capture_screen',
    description: 'Capture the current screen or a region and save as PNG. Returns the file path and base64 data. Chain with analyze_image to understand what is on screen.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        output_path: { type: Type.STRING, description: 'Where to save the PNG. Defaults to a temp file.' },
        region: {
          type: Type.OBJECT,
          description: 'Capture only a region of the screen.',
          properties: {
            x:      { type: Type.INTEGER },
            y:      { type: Type.INTEGER },
            width:  { type: Type.INTEGER },
            height: { type: Type.INTEGER },
          },
        },
      },
      required: [],
    },
  },

  {
    name: 'analyze_image',
    description: 'Send an image to Gemini vision and ask a question about it. Works with: (1) a path returned by take_screenshot, (2) any local image file, (3) a public image URL. Use this after take_screenshot to understand what is on screen before deciding where to click or type.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: 'What to ask about the image. Be specific — e.g. "Where is the Submit button and what are its approximate pixel coordinates?", "What error message is shown?", "List all UI elements visible."',
        },
        path: {
          type: Type.STRING,
          description: 'Local file path to the image (PNG, JPEG, GIF, WEBP). Use the path returned by take_screenshot.',
        },
        base64: {
          type: Type.STRING,
          description: 'Base64-encoded image data. Use base64_png from take_screenshot if already available — avoids re-reading from disk.',
        },
        mime_type: {
          type: Type.STRING,
          description: 'MIME type when providing base64. Default: "image/png".',
        },
        url: {
          type: Type.STRING,
          description: 'Public URL of an image to fetch and analyze.',
        },
      },
      required: ['question'],
    },
  },

  {
    name: 'get_mouse_position',
    description: 'Get the current x, y pixel coordinates of the mouse cursor.',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },

  {
    name: 'get_screen_size',
    description: 'Get the width and height of the primary display in pixels. Call this before using coordinates.',
    parameters: { type: Type.OBJECT, properties: {}, required: [] },
  },

  {
    name: 'sleep_ms',
    description: 'Pause for a number of milliseconds. Use between UI actions to let animations or page loads finish.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        duration_ms: { type: Type.INTEGER, description: 'Milliseconds to sleep.' },
      },
      required: ['duration_ms'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementations
// ─────────────────────────────────────────────
export async function executeComputerUseTool(name, args) {

  // analyze_image does NOT need nut-js — handle it first
  if (name === 'analyze_image') {
    const { question, path: filePath, base64, mime_type, url } = args;

    if (!question) throw new Error('question is required for analyze_image.');

    let imagePart;

    if (base64) {
      // Fastest path: caller already has base64 (e.g. from take_screenshot)
      imagePart = { inlineData: { mimeType: mime_type ?? 'image/png', data: base64 } };

    } else if (filePath) {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) throw new Error(`Image file not found: ${resolved}`);

      const ext  = path.extname(resolved).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                     '.gif': 'image/gif', '.webp': 'image/webp' }[ext] ?? 'image/png';
      const data = fs.readFileSync(resolved, { encoding: 'base64' });
      imagePart = { inlineData: { mimeType: mime, data } };

    } else if (url) {
      const res             = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch image URL: ${res.status} ${res.statusText}`);
      const arrayBuffer     = await res.arrayBuffer();
      const data            = Buffer.from(arrayBuffer).toString('base64');
      const contentType     = res.headers.get('content-type') ?? 'image/jpeg';
      const mime            = contentType.split(';')[0].trim();
      imagePart = { inlineData: { mimeType: mime, data } };

    } else {
      throw new Error('analyze_image requires one of: path, base64, or url.');
    }

    const answer = await callVision(imagePart, question);
    return { question, answer };
  }

  // All other tools need nut-js
  const N = await nut();
  const { mouse, keyboard, screen, Button, Key, Point, Region, straightTo, saveImage } = N;

  switch (name) {

    case 'mouse_move': {
      await mouse.move(straightTo(new Point(args.x, args.y)));
      return { success: true, moved_to: { x: args.x, y: args.y } };
    }

    case 'mouse_click': {
      const btn = args.button?.toLowerCase() ?? 'left';
      if (args.x !== undefined && args.y !== undefined)
        await mouse.move(straightTo(new Point(args.x, args.y)));

      if      (btn === 'double') await mouse.doubleClick(Button.LEFT);
      else if (btn === 'right')  await mouse.click(Button.RIGHT);
      else if (btn === 'middle') await mouse.click(Button.MIDDLE);
      else                       await mouse.click(Button.LEFT);

      const pos = await mouse.getPosition();
      return { success: true, clicked: btn, at: { x: pos.x, y: pos.y } };
    }

    case 'mouse_drag': {
      await mouse.move(straightTo(new Point(args.from_x, args.from_y)));
      await mouse.pressButton(Button.LEFT);
      await mouse.move(straightTo(new Point(args.to_x, args.to_y)));
      await mouse.releaseButton(Button.LEFT);
      return { success: true, from: { x: args.from_x, y: args.from_y }, to: { x: args.to_x, y: args.to_y } };
    }

    case 'mouse_scroll': {
      const amount = args.amount ?? 3;
      if (args.x !== undefined && args.y !== undefined)
        await mouse.move(straightTo(new Point(args.x, args.y)));
      if      (args.direction === 'up')   await mouse.scrollUp(amount);
      else if (args.direction === 'down') await mouse.scrollDown(amount);
      else throw new Error('direction must be "up" or "down"');
      return { success: true, scrolled: args.direction, amount };
    }

    case 'key_type': {
      keyboard.config.autoDelayMs = args.delay_ms ?? 0;
      await keyboard.type(args.text);
      return { success: true, typed: args.text };
    }

    case 'key_press': {
      if (!Array.isArray(args.keys) || args.keys.length === 0)
        throw new Error('keys must be a non-empty array.');
      const resolved = resolveKeys(N, args.keys);
      if (resolved.length === 1) {
        await keyboard.type(resolved[0]);
      } else {
        const mods   = resolved.slice(0, -1);
        const target = resolved[resolved.length - 1];
        await keyboard.pressKey(...mods, target);
        await keyboard.releaseKey(...mods, target);
      }
      return { success: true, pressed: args.keys };
    }

    case 'capture_screen': {
      const outPath = args.output_path
        ? path.resolve(args.output_path)
        : path.join(os.tmpdir(), `quinn-screenshot-${Date.now()}.png`);

      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      let image;
      if (args.region) {
        const { x, y, width, height } = args.region;
        image = await screen.grabRegion(new Region(x, y, width, height));
      } else {
        image = await screen.grab();
      }

      await saveImage(image, outPath);
      const base64 = fs.readFileSync(outPath).toString('base64');

      return {
        success    : true,
        path       : outPath,
        width      : image.width,
        height     : image.height,
        base64_png : base64,
        note       : 'Pass base64_png to analyze_image to understand what is on screen.',
      };
    }

    case 'get_mouse_position': {
      const pos = await mouse.getPosition();
      return { x: pos.x, y: pos.y };
    }

    case 'get_screen_size': {
      const width  = await screen.width();
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