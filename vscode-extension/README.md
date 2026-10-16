# Agentic IDE VS Code Extension

This extension adds an Agentic IDE Activity Bar container, a workspace actions
tree, an Agent Chat webview, and Command Palette entries to the existing POC.
It is a UI milestone: it does not start the Python CLI or connect to the Python
backend yet.

## Requirements

- Visual Studio Code 1.90 or later
- Node.js and npm

## Install dependencies and build

Open a terminal in `vscode-extension` and run:

```powershell
npm install
npm run compile
```

The extension uses TypeScript and the official VS Code API type definitions.
The extension itself adds no runtime package dependency.

## Run in the Extension Development Host

1. Open the `vscode-extension` folder in VS Code.
2. Run `npm install` once if dependencies have not been installed.
3. Press **F5** and select **Run Agentic IDE Extension** if prompted.
4. In the new Extension Development Host window, open a project folder.
5. Select the Agentic IDE icon in the Activity Bar.

The launch configuration runs the TypeScript compile task before starting the
Extension Development Host. On Windows, the task invokes `npm.cmd` explicitly
to avoid PowerShell execution-policy failures for `npm.ps1`.

## Commands

Use **Ctrl+Shift+P** and search for **Agentic IDE**:

- **List Workspace Files** — preview message; Python backend is not connected.
- **Search Codebase** — asks for a query, then shows a preview message.
- **Read Selected File** — shows the active editor selection, or the active
  workspace file when nothing is selected. This reads locally and does not send
  file contents to a model.
- **Summarize Selected File** — preview message; summarization is not connected.
- **Open Agent Chat** — focuses the chat view. Chat replies are explicitly
  labeled previews and are not sent to a model.

The status bar and chat header indicate that the Python backend is not
connected. No workspace source code is executed, and there is no file-editing
or terminal-execution functionality.

## Backend integration plan

The Python CLI currently accepts interactive menu input rather than structured
requests, so this extension deliberately does not drive it or duplicate its
logic. A later milestone can add a dedicated Python JSON-lines entry point
that accepts a small allowlist of operations (list, search, read, summarize,
chat) and returns typed JSON responses. The extension can then launch that
backend with a configured Python executable and project root, exchange
structured messages over stdin/stdout, and report the process state. It should
never invoke commands or execute code from the workspace being explored.
