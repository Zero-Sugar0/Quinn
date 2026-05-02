import os from 'os';
import { execSync } from 'child_process';
import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const systemDeclarations = [
  {
    name: 'get_system_info',
    description:
      'Get detailed information about the current system: OS, CPU, memory usage, disk usage, uptime, hostname, and current working directory. Useful for understanding the environment.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: [],
    },
  },

  {
    name: 'list_processes',
    description:
      'List currently running processes on the system. Can filter by name. Shows PID, CPU%, memory%, and command.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: {
          type: Type.STRING,
          description: 'Optional process name filter, e.g. "node", "python", "chrome". Returns all processes if omitted.',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Maximum number of processes to return. Default: 20.',
        },
      },
      required: [],
    },
  },

  {
    name: 'get_environment_variable',
    description:
      'Read an environment variable by name. Can also list all environment variable names (without values) for discovery.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'The name of the environment variable to read, e.g. "PATH" or "HOME". If omitted, lists all variable names.',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementations
// ─────────────────────────────────────────────
function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(1)} MB`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export async function executeSystemTool(name, args) {
  switch (name) {
    case 'get_system_info': {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      // Disk usage (cross-platform best effort)
      let disk = null;
      try {
        const dfOut = execSync('df -h / 2>/dev/null || df -h .', {
          encoding: 'utf8',
          timeout: 5000,
          shell: true,
        });
        const lines = dfOut.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          disk = { total: parts[1], used: parts[2], available: parts[3], use_percent: parts[4] };
        }
      } catch {
        disk = 'unavailable';
      }

      // Node/npm versions
      let nodeVersion = process.version;
      let npmVersion = 'unknown';
      try {
        npmVersion = execSync('npm --version', { encoding: 'utf8', timeout: 3000 }).trim();
      } catch {}

      const cpus = os.cpus();

      return {
        hostname: os.hostname(),
        platform: os.platform(),
        os_type: os.type(),
        os_release: os.release(),
        architecture: os.arch(),
        cpu: {
          model: cpus[0]?.model ?? 'unknown',
          cores: cpus.length,
          speed_mhz: cpus[0]?.speed ?? 0,
        },
        memory: {
          total: formatBytes(totalMem),
          used: formatBytes(usedMem),
          free: formatBytes(freeMem),
          use_percent: `${((usedMem / totalMem) * 100).toFixed(1)}%`,
        },
        disk,
        uptime: formatUptime(os.uptime()),
        home_directory: os.homedir(),
        current_directory: process.cwd(),
        node_version: nodeVersion,
        npm_version: npmVersion,
        shell: process.env.SHELL ?? 'unknown',
        user: os.userInfo().username,
      };
    }

    case 'list_processes': {
      const limit = args.limit ?? 20;
      const filter = args.filter ?? '';

      // Use ps with sorting by CPU
      const psCmd = 'ps aux --sort=-%cpu 2>/dev/null || ps aux';

      try {
        const output = execSync(psCmd, { encoding: 'utf8', timeout: 5000, shell: true });
        const lines = output.trim().split('\n').slice(1); // skip header

        let processes = lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0],
            pid: parseInt(parts[1]),
            cpu_percent: parseFloat(parts[2]),
            mem_percent: parseFloat(parts[3]),
            command: parts.slice(10).join(' '),
          };
        });

        if (filter) {
          const f = filter.toLowerCase();
          processes = processes.filter((p) => p.command.toLowerCase().includes(f));
        }

        processes = processes.slice(0, limit);

        return {
          processes,
          count: processes.length,
          filter: filter || null,
        };
      } catch (err) {
        throw new Error(`Failed to list processes: ${err.message}`);
      }
    }

    case 'get_environment_variable': {
      if (!args.name) {
        // Return just the names for discovery (not values, for privacy)
        const names = Object.keys(process.env).sort();
        return { variable_names: names, count: names.length };
      }

      const value = process.env[args.name];
      if (value === undefined) {
        return { name: args.name, value: null, exists: false };
      }
      return { name: args.name, value, exists: true };
    }

    default:
      throw new Error(`Unknown system tool: ${name}`);
  }
}