import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Persistence
// ─────────────────────────────────────────────
const QUINN_DIR = path.join(os.homedir(), '.quinn');
const SCHEDULES_FILE = path.join(QUINN_DIR, 'schedules.json');

function ensureDir() { fs.mkdirSync(QUINN_DIR, { recursive: true }); }

export function loadSchedules() {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

function saveSchedules(schedules) {
  ensureDir();
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf8');
}

// In-memory registry of running cron tasks: id → cron.ScheduledTask
const activeTasks = new Map();

// ─────────────────────────────────────────────
//  Boot: restore persisted schedules
// ─────────────────────────────────────────────
export function restoreSchedules() {
  const schedules = loadSchedules();
  let restored = 0;
  for (const s of schedules) {
    if (s.status !== 'active') continue;
    try {
      const task = cron.schedule(s.cron_expression, () => {
        runScheduledTask(s);
      }, { timezone: s.timezone ?? 'UTC' });
      activeTasks.set(s.id, task);
      restored++;
    } catch {}
  }
  return restored;
}

function runScheduledTask(schedule) {
  const timestamp = new Date().toISOString();
  try {
    const output = execSync(schedule.command, {
      encoding: 'utf8',
      timeout: 60000,
      shell: true,
      maxBuffer: 1024 * 256,
    }).trim();

    // Log execution to schedule history
    const schedules = loadSchedules();
    const idx = schedules.findIndex((s) => s.id === schedule.id);
    if (idx !== -1) {
      schedules[idx].last_run = timestamp;
      schedules[idx].last_result = { success: true, output: output.slice(0, 500) };
      schedules[idx].run_count = (schedules[idx].run_count ?? 0) + 1;
      saveSchedules(schedules);
    }
  } catch (err) {
    const schedules = loadSchedules();
    const idx = schedules.findIndex((s) => s.id === schedule.id);
    if (idx !== -1) {
      schedules[idx].last_run = timestamp;
      schedules[idx].last_result = { success: false, error: err.message.slice(0, 300) };
      saveSchedules(schedules);
    }
  }
}

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const schedulerDeclarations = [
  {
    name: 'schedule_task',
    description:
      'Create a scheduled task that runs a shell command on a recurring schedule (using cron syntax) or at a specific time. The schedule persists across Quinn restarts. Examples: run a backup every night, check a server every 5 minutes, send a reminder at 9am every Monday.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'A human-readable name for this schedule, e.g. "Daily git backup" or "Server health check".',
        },
        command: {
          type: Type.STRING,
          description: 'The shell command to execute on schedule, e.g. "cd ~/project && git push" or "curl https://myserver/health >> ~/logs/health.log".',
        },
        cron_expression: {
          type: Type.STRING,
          description: 'Cron expression for timing. Format: "minute hour day month weekday". Examples: "0 9 * * 1" (9am Mondays), "*/5 * * * *" (every 5 min), "0 0 * * *" (midnight daily), "30 8 * * 1-5" (8:30am weekdays).',
        },
        timezone: {
          type: Type.STRING,
          description: 'Timezone for the schedule, e.g. "America/New_York", "Europe/London", "Asia/Tokyo". Default: UTC.',
        },
        description: {
          type: Type.STRING,
          description: 'Optional description of what this task does and why.',
        },
      },
      required: ['name', 'command', 'cron_expression'],
    },
  },

  {
    name: 'list_schedules',
    description: 'List all scheduled tasks — active, paused, and completed. Shows last run time, run count, and recent results.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          enum: ['active', 'paused', 'all'],
          description: 'Filter by status. Default: all.',
        },
      },
      required: [],
    },
  },

  {
    name: 'manage_schedule',
    description: 'Pause, resume, or permanently delete a scheduled task by its ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.STRING,
          description: 'The schedule ID (shown in list_schedules).',
        },
        action: {
          type: Type.STRING,
          enum: ['pause', 'resume', 'delete', 'run_now'],
          description: 'Action to perform: pause (keep but stop running), resume (restart), delete (remove permanently), run_now (execute immediately once).',
        },
      },
      required: ['id', 'action'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
export async function executeSchedulerTool(name, args) {
  switch (name) {
    case 'schedule_task': {
      if (!cron.validate(args.cron_expression)) {
        throw new Error(`Invalid cron expression: "${args.cron_expression}". Use format: "minute hour day month weekday".`);
      }

      const id = `sch_${Date.now().toString(36)}`;
      const schedule = {
        id,
        name: args.name,
        command: args.command,
        cron_expression: args.cron_expression,
        timezone: args.timezone ?? 'UTC',
        description: args.description ?? '',
        status: 'active',
        created_at: new Date().toISOString(),
        last_run: null,
        last_result: null,
        run_count: 0,
      };

      // Start the cron task
      const task = cron.schedule(
        args.cron_expression,
        () => runScheduledTask(schedule),
        { timezone: schedule.timezone }
      );
      activeTasks.set(id, task);

      // Persist
      const schedules = loadSchedules();
      schedules.push(schedule);
      saveSchedules(schedules);

      // Calculate next run
      const nextDescription = humanizeCron(args.cron_expression);

      return {
        success: true,
        id,
        name: args.name,
        cron_expression: args.cron_expression,
        schedule_description: nextDescription,
        timezone: schedule.timezone,
        status: 'active',
      };
    }

    case 'list_schedules': {
      const schedules = loadSchedules();
      const filterStatus = args.status ?? 'all';
      const filtered = filterStatus === 'all'
        ? schedules
        : schedules.filter((s) => s.status === filterStatus);

      return {
        schedules: filtered.map((s) => ({
          id: s.id,
          name: s.name,
          command: s.command.length > 60 ? s.command.slice(0, 60) + '…' : s.command,
          cron_expression: s.cron_expression,
          timezone: s.timezone,
          status: s.status,
          run_count: s.run_count ?? 0,
          last_run: s.last_run,
          last_result: s.last_result,
          description: s.description,
        })),
        count: filtered.length,
        total: schedules.length,
      };
    }

    case 'manage_schedule': {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === args.id);
      if (idx === -1) throw new Error(`Schedule "${args.id}" not found.`);

      const schedule = schedules[idx];

      switch (args.action) {
        case 'pause': {
          activeTasks.get(args.id)?.stop();
          schedule.status = 'paused';
          saveSchedules(schedules);
          return { success: true, id: args.id, status: 'paused' };
        }
        case 'resume': {
          if (schedule.status !== 'paused') {
            return { success: false, error: 'Schedule is not paused.' };
          }
          const task = cron.schedule(
            schedule.cron_expression,
            () => runScheduledTask(schedule),
            { timezone: schedule.timezone }
          );
          activeTasks.set(args.id, task);
          schedule.status = 'active';
          saveSchedules(schedules);
          return { success: true, id: args.id, status: 'active' };
        }
        case 'delete': {
          activeTasks.get(args.id)?.stop();
          activeTasks.delete(args.id);
          schedules.splice(idx, 1);
          saveSchedules(schedules);
          return { success: true, id: args.id, deleted: true };
        }
        case 'run_now': {
          runScheduledTask(schedule);
          return { success: true, id: args.id, message: 'Task triggered immediately.' };
        }
        default:
          throw new Error(`Unknown action: ${args.action}`);
      }
    }

    default:
      throw new Error(`Unknown scheduler tool: ${name}`);
  }
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function humanizeCron(expr) {
  const parts = expr.split(' ');
  if (parts[0] === '*/5' && parts[1] === '*') return 'Every 5 minutes';
  if (parts[0] === '0' && parts[1] === '0') return 'Daily at midnight';
  if (parts[0] === '0' && parts[1] === '9' && parts[4] === '1') return 'Every Monday at 9:00 AM';
  return `Cron: ${expr}`;
}