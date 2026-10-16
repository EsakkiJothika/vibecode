# Agentic IDE Desktop

Agentic IDE Desktop is a standalone Windows-first desktop application built
with Electron, TypeScript, React, and Monaco Editor. It does not open or depend
on Visual Studio Code. The Python CLI remains available separately from the
repository root.

## Requirements

- Windows 10 or later
- Node.js 20+ and npm
- Python 3.12 recommended (the standard-library backend has no package installs)

## Install and run in development

From PowerShell:

```powershell
Set-Location 'C:\path\to\vibecode\desktop-ide'
npm install
npm run dev
```

`npm run dev` starts the Vite renderer, compiles the Electron main/preload
processes, and opens an independent Agentic IDE window. This development setup
expects the Python project root to be the parent of `desktop-ide`. If it is
elsewhere, configure `AGENTIC_IDE_BACKEND_ROOT` to the Python project root.

The app uses the project's `.venv\Scripts\python.exe` when present. Otherwise
it uses `python` from `PATH`. Set `AGENTIC_IDE_PYTHON` to an existing absolute
Python executable path to override the selection.

## Build and run the renderer

```powershell
npm run build
npm start
```

`npm start` builds TypeScript and the renderer, then opens the Electron app.
This is a local development build, not a signed Windows installer. Packaging
the application and bundling the Python backend can be handled in a later
release milestone.

## Features

- Select a workspace directory using the native folder picker.
- Browse files and folders, search file names, and search text within files.
- Open UTF-8 text files in the embedded Monaco editor (read-only for now).
- See a language-agnostic summary containing line, word, and character counts
  and a short non-empty-line preview; this uses no LLM.
- Send a prompt to the existing optional model adapter when its environment
  configuration is present. Only the text you submit is sent; the app does
  not attach file contents automatically. Hosted providers may charge for use.
- View backend connection status, errors, a Problems panel, and a clearly
  non-executing Terminal placeholder.

The application does not execute workspace files, run terminal commands, or
edit project files. Search and reading inherit the Python explorer's default
excluded directories and 1 MiB file-size limit.

## Security boundary

Electron's main process owns the folder picker and Python child process. The
renderer receives only the typed operations exposed from the isolated preload
script; Node integration is disabled and context isolation is enabled. Each
filesystem request must match the folder selected through the native dialog,
and the Python backend independently validates workspace-relative paths.

The Python backend uses a newline-delimited JSON protocol:

```json
{"id":1,"operation":"list-files","workspace":"C:\\\\project"}
```

`python -m agent.bridge` is launched with the Python project root as its
working directory. Supported operations are workspace validation, file
listing, file-name and text search, safe text reading, basic summary, optional
model chat, and health checking. The existing interactive `main.py` CLI is
unchanged.

## Performance notes

Electron and Monaco use more memory than the command-line prototype. On an
8 GB machine, avoid opening very large workspaces and close other memory-heavy
applications if the IDE feels slow. The Python code has no additional runtime
dependencies; frontend and Electron packages are development dependencies.
