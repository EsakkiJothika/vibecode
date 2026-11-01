# vibeCode

vibeCode is a standalone Windows-first desktop application built
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
processes, and opens an independent vibeCode window. This development setup
expects the Python project root to be the parent of `desktop-ide`. If it is
elsewhere, configure `AGENTIC_IDE_BACKEND_ROOT` to the Python project root.

The app uses the project's `.venv\Scripts\python.exe` when present. Otherwise
it uses `python` from `PATH`. Set `AGENTIC_IDE_PYTHON` to an existing absolute
Python executable path to override the selection.
The backend starts on the first workspace operation, not when the IDE window
opens. Startup errors, captured Python stderr, and connection status are shown
in the Agent panel and status bar.

## Build and run the renderer

```powershell
npm run build
npm start
```

`npm start` builds TypeScript and the renderer, then opens the Electron app.
This is a local development build, not a signed Windows installer. Packaging
the application and bundling the Python backend can be handled in a later
release milestone.

Run the Python backend lifecycle integration tests with:

```powershell
npm run test:backend
```

The tests use temporary workspaces and a deliberately unavailable Python
executable. They do not require a model provider or network access.

## Features

- Select a workspace directory using the native folder picker.
- Use the native File menu to create/open text files and folders, save, save
  as, save all, close the active editor, or exit. Common shortcuts are
  available for these actions.
- Browse files and folders, search file names, and search text within files.
- Use the Explorer toolbar or File/View menus to create files/folders, reload
  the workspace tree, and collapse all folders. Shortcuts: `Ctrl+N` (new file),
  `Ctrl+Shift+N` (new folder), `Ctrl+R` (reload Explorer), and `Ctrl+Alt+0`
  (collapse all folders).
- Right-click files or folders in Explorer for safe workspace actions:
  create a file/folder, find text in a folder, reveal a path in File Explorer,
  copy absolute/relative paths, rename, and delete with confirmation. File
  actions also include open, basic summary, image preview, and attach-to-chat.
- Chat file attachments are limited to the first 16,000 characters and are
  included with the prompt only when you explicitly send it to the configured
  model. Binary/image files cannot be attached as text.
- Terminal, clipboard file operations, sharing, and test/debug actions appear
  disabled until those capabilities are implemented. The integrated terminal
  does not execute commands. Attaching an entire folder to chat is also not
  supported; attach individual text files instead.
- Edit opened UTF-8 text files in Monaco and save with the toolbar button or
  `Ctrl+S`. New text files can be created from the File menu and saved into the
  workspace. Unsaved changes are marked in their tabs, and closing an edited
  tab, switching workspaces, or exiting asks before discarding them.
- See a language-agnostic summary containing line, word, and character counts
  and a short non-empty-line preview; this uses no LLM.
- Send a prompt to the existing optional model adapter when its environment
  configuration is present. Only the text you submit is sent; the app does
  not attach file contents automatically. Hosted providers may charge for use.
- View backend connection status, errors, a Problems panel, and a clearly
  non-executing Terminal placeholder.

The application does not execute workspace files or run terminal commands.
File edits are written only after an explicit save and are restricted to an
files inside the selected workspace. Save As and new-file creation use the
native save dialog, and Python validates the final path, including symlinks.
Search, reading, and writing
inherit the Python explorer's default excluded directories and 1 MiB file-size
limit.
Image previews support common image types up to 5 MiB. File and folder
renames/deletions are limited to workspace-relative paths; deletes require
confirmation and remove folders recursively.

## Security boundary

Electron's main process owns the folder picker and Python child process. The
renderer receives only the typed operations exposed from the isolated preload
script; Node integration is disabled and context isolation is enabled. Each
filesystem request must match the folder selected through the native dialog,
and the Python backend independently validates workspace-relative paths. Save
uses an atomic replacement after confirming the target is a readable UTF-8
text file; it preserves UTF-8 BOMs and the file's detected newline style.

The Python backend uses a newline-delimited JSON protocol:

```json
{"id":1,"operation":"list-files","workspace":"C:\\\\project"}
```

`python -m agent.bridge` is launched with the Python project root as its
working directory. Supported operations are workspace validation, file
listing, file-name and text search, safe text reading, basic summary, optional
model chat, explicit file saving, and health checking. The bridge accepts
requests up to 8 MiB so JSON-encoded editor contents can stay within the
1 MiB-per-file limit. The existing interactive `main.py` CLI is unchanged.

## Performance notes

Electron and Monaco use more memory than the command-line prototype. On an
8 GB machine, avoid opening very large workspaces and close other memory-heavy
applications if the IDE feels slow. The Python code has no additional runtime
dependencies; frontend and Electron packages are development dependencies.
