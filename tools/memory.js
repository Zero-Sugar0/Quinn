import fs from 'fs';
import path from 'path';
import os from 'os';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Storage paths
// ─────────────────────────────────────────────
const QUINN_DIR = path.join(os.homedir(), '.quinn');
const MEMORY_FILE = path.join(QUINN_DIR, 'memory.json');
const JOURNAL_FILE = path.join(QUINN_DIR, 'journal.json');

function ensureDir() {
  fs.mkdirSync(QUINN_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch {}
  return fallback;
}

function saveJSON(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const memoryDeclarations = [
  {
    name: 'save_memory',
    description:
      'Save a piece of information to persistent memory so you can remember it across conversations and sessions. Good for user preferences, important facts, project details, credentials hints, or anything worth keeping. Each memory has a key and a value.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: 'A short unique identifier for this memory, e.g. "user_preferred_editor", "project_db_host", "user_name".',
        },
        value: {
          type: Type.STRING,
          description: 'The information to remember. Can be a sentence, a JSON string, or anything useful.',
        },
        category: {
          type: Type.STRING,
          enum: ['preference', 'project', 'person', 'credential_hint', 'note', 'fact'],
          description: 'Category to organize memories. Default: note.',
        },
      },
      required: ['key', 'value'],
    },
  },

  {
    name: 'recall_memories',
    description:
      'Search and retrieve memories saved in previous sessions. Can search by key, category, or a keyword in the value. Use this at the start of a conversation to remember context about the user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        search: {
          type: Type.STRING,
          description: 'Keyword to search for across keys and values. Leave empty to retrieve all memories.',
        },
        category: {
          type: Type.STRING,
          enum: ['preference', 'project', 'person', 'credential_hint', 'note', 'fact'],
          description: 'Filter by category. Leave empty for all categories.',
        },
      },
      required: [],
    },
  },

  {
    name: 'delete_memory',
    description: 'Delete a specific memory by its key.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: {
          type: Type.STRING,
          description: 'The key of the memory to delete.',
        },
      },
      required: ['key'],
    },
  },

  {
    name: 'write_journal',
    description:
      'Write an entry to Quinn\'s persistent journal. Use this to log completed tasks, document what was done in a session, record important events, or keep notes the user wants to refer back to later.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'A short title for this journal entry.',
        },
        content: {
          type: Type.STRING,
          description: 'The full journal entry content. Markdown is supported.',
        },
        tags: {
          type: Type.STRING,
          description: 'Comma-separated tags, e.g. "work,deployment,bug-fix".',
        },
      },
      required: ['title', 'content'],
    },
  },

  {
    name: 'read_journal',
    description:
      'Read journal entries. Can retrieve the most recent entries or search by tag or keyword.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.INTEGER,
          description: 'Number of recent entries to return. Default: 10.',
        },
        search: {
          type: Type.STRING,
          description: 'Keyword to search in titles, content, or tags.',
        },
        tag: {
          type: Type.STRING,
          description: 'Filter by a specific tag.',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
export async function executeMemoryTool(name, args) {
  switch (name) {
    case 'save_memory': {
      const memories = loadJSON(MEMORY_FILE, {});
      memories[args.key] = {
        value: args.value,
        category: args.category ?? 'note',
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      saveJSON(MEMORY_FILE, memories);
      return { success: true, key: args.key, total_memories: Object.keys(memories).length };
    }

    case 'recall_memories': {
      const memories = loadJSON(MEMORY_FILE, {});
      let entries = Object.entries(memories).map(([key, data]) => ({ key, ...data }));

      if (args.category) {
        entries = entries.filter((e) => e.category === args.category);
      }

      if (args.search) {
        const q = args.search.toLowerCase();
        entries = entries.filter(
          (e) =>
            e.key.toLowerCase().includes(q) ||
            e.value.toLowerCase().includes(q)
        );
      }

      entries.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      return {
        memories: entries,
        count: entries.length,
        total_in_store: Object.keys(memories).length,
      };
    }

    case 'delete_memory': {
      const memories = loadJSON(MEMORY_FILE, {});
      if (!memories[args.key]) {
        return { success: false, error: `Memory key "${args.key}" not found.` };
      }
      delete memories[args.key];
      saveJSON(MEMORY_FILE, memories);
      return { success: true, deleted: args.key, remaining: Object.keys(memories).length };
    }

    case 'write_journal': {
      const journal = loadJSON(JOURNAL_FILE, []);
      const entry = {
        id: Date.now().toString(36),
        title: args.title,
        content: args.content,
        tags: args.tags ? args.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        created_at: new Date().toISOString(),
      };
      journal.unshift(entry); // newest first
      if (journal.length > 500) journal.splice(500); // keep max 500 entries
      saveJSON(JOURNAL_FILE, journal);
      return { success: true, entry_id: entry.id, total_entries: journal.length };
    }

    case 'read_journal': {
      const journal = loadJSON(JOURNAL_FILE, []);
      let entries = [...journal];

      if (args.tag) {
        entries = entries.filter((e) => e.tags.includes(args.tag));
      }

      if (args.search) {
        const q = args.search.toLowerCase();
        entries = entries.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.content.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q))
        );
      }

      const limit = args.limit ?? 10;
      const paged = entries.slice(0, limit);

      return {
        entries: paged,
        returned: paged.length,
        total_matching: entries.length,
        total_in_journal: journal.length,
      };
    }

    default:
      throw new Error(`Unknown memory tool: ${name}`);
  }
}