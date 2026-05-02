# Quinn — Terminal AI Agent

Quinn is a terminal-native AI assistant powered by Gemini 2.5 Flash, with 25+ tools to help you work on your laptop.

## Setup

**1. Install dependencies**
```bash
npm install @google/genai chalk marked marked-terminal ora figlet boxen
```

**2. Add `"type": "module"` to your `package.json`**
```json
{
  "type": "module",
  "scripts": {
    "start": "node index.js"
  }
}
```

**3. Set your API key**
```bash
export GEMINI_API_KEY="your-key-here"
```
Get a key at: https://aistudio.google.com/app/apikey

**4. Run Quinn**
```bash
node index.js
```

---

## Tools (25+ total)

| Category | Tool | Description |
|---|---|---|
| **Files** | `read_file` | Read any file |
| | `write_file` | Write/append to files |
| | `list_directory` | Browse directories |
| | `create_directory` | Make new folders |
| | `move_file` | Move or rename |
| | `delete_file` | Delete files |
| **Shell** | `run_command` | Execute shell commands |
| | `search_files` | Grep through codebases |
| **System** | `get_system_info` | CPU, memory, disk, OS |
| | `list_processes` | Running processes |
| | `get_environment_variable` | Env var lookup |
| **Network** | `fetch_url` | HTTP requests |
| **Git** | `git_operation` | Status, log, diff, commit, push... |
| **Clipboard** | `read_clipboard` | Read clipboard |
| | `write_clipboard` | Write to clipboard |
| **Search** | `web_search` | Search the web with Tavily |
| | `extract_webpage` | Extract full content from URLs |
| **Memory** | `save_memory` | Save persistent information |
| | `recall_memories` | Search saved memories |
| | `delete_memory` | Remove saved memories |
| | `write_journal` | Log entries to journal |
| **Scheduler** | `schedule_task` | Create recurring tasks |
| **Self-Mod** | `create_custom_tool` | Create new tools dynamically |
| | `list_custom_tools` | List custom tools |
| | `delete_custom_tool` | Remove custom tools |
| **Creative** | `send_notification` | Send desktop notifications |
| | `open_url_or_app` | Open URLs or applications |
| | `take_screenshot` | Capture screenshots |

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Help & tips |
| `/tools` | List all tools |
| `/history` | Preview conversation |
| `/clear` | Reset context |
| `/exit` | Quit |

## Example Prompts

- *"What's in my current directory?"*
- *"Read `./src/index.js` and find any bugs"*
- *"Run `npm test` and tell me what failed"*
- *"What's my git status and show me the last 5 commits?"*
- *"Fetch `https://api.github.com/users/octocat` and summarize it"*
- *"Search for all TODO comments in this project"*
- *"How much memory am I using right now?"*
- *"Read my clipboard and clean it up"*
- *"Search the web for the latest Node.js version"*
- *"Remember that my favorite editor is VS Code"*
- *"Schedule a daily backup at 2 AM"*
- *"Create a tool to check my server's health"*
- *"Send me a notification when this task completes"*

## File Structure

```
quinn/
├── index.js          ← CLI entry point
├── quinn.js          ← Agent core + Gemini API
├── tools/
│   ├── index.js      ← Tool registry
│   ├── filesystem.js ← 6 file tools
│   ├── shell.js      ← 2 shell tools
│   ├── system.js     ← 3 system tools
│   ├── network.js    ← 1 network tool
│   ├── git.js        ← 1 git tool
│   ├── clipboard.js  ← 2 clipboard tools
│   ├── search.js     ← 2 web search tools
│   ├── memory.js     ← 4 memory tools
│   ├── scheduler.js  ← Task scheduling
│   ├── selfmod.js    ← Self-modification tools
│   └── creative.js   ← 3 creative tools
└── ui/
    └── renderer.js   ← Terminal UI + markdown
```