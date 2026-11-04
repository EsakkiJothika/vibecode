# Run Commands

This guide covers the main ways to run the project on Windows. The standalone
desktop IDE is the primary application; the Python CLI and VS Code extension
are also available.

## Standalone desktop IDE

Prerequisites:

- Windows 10 or later
- Node.js 20 or later, with npm
- Python 3.12 recommended

Open PowerShell and run:

```powershell
Set-Location 'D:\My Project\current projects\vibecode\desktop-ide'
npm.cmd install
npm.cmd run dev
```

Install dependencies only once. To build and launch the app without the
development server:

```powershell
npm.cmd start
```

The Python backend has no third-party package requirements. The desktop app
uses `..\.venv\Scripts\python.exe` if the project virtual environment exists;
otherwise it uses `python` from `PATH`. To select a specific Python executable,
set `AGENTIC_IDE_PYTHON` to its absolute path before launching:

```powershell
$env:AGENTIC_IDE_PYTHON = 'C:\Path\To\python.exe'
npm.cmd run dev
```

The app expects the Python project root to be the parent of `desktop-ide`. If
the backend is in another location, set `AGENTIC_IDE_BACKEND_ROOT` to that
project root.

## Python command-line interface

From the project root:

```powershell
Set-Location 'D:\My Project\current projects\vibecode'
python main.py
```

If a virtual environment is set up in the project, run:

```powershell
.\.venv\Scripts\python.exe main.py
```

## VS Code extension (experimental)

Open a PowerShell terminal in the extension folder, install its dependencies,
and compile:

```powershell
Set-Location 'D:\My Project\current projects\vibecode\vscode-extension'
npm.cmd install
npm.cmd run compile
```

To try it in VS Code, open the `vscode-extension` folder in VS Code and press
**F5** to launch the Extension Development Host.

## Tests

Run the Python tests from the project root:

```powershell
Set-Location 'D:\My Project\current projects\vibecode'
python -m unittest discover -v
```

Build the desktop app from its folder:

```powershell
Set-Location 'D:\My Project\current projects\vibecode\desktop-ide'
npm.cmd run build
```

Model chat is optional. It requires the model provider environment variables
documented in the root [README](../README.md); the app does not need a model
configured for browsing and reading a workspace.
