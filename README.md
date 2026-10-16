# Agentic IDE POC

Milestones 1 and 2 provide a language-agnostic command-line codebase explorer
and a configurable model integration layer. The explorer lists workspace
files, reads bounded UTF-8 text files, and searches text with line-numbered
results. The model adapter sends a user-provided prompt to an OpenAI-compatible
chat-completions endpoint. No model weights or third-party packages are
required. Workspace contents are never executed.

## Run

From the project root:

```powershell
python main.py
```

To use the project virtual environment on Windows:

```powershell
.\.venv\Scripts\python.exe main.py
```

The menu lets you select a workspace, list entries, read a workspace-relative
file, search the workspace, display the selected directory, exit, or ask the
configured model. The workspace must be a project directory rather than a
filesystem root. The default excluded directory names are `.git`, `.venv`,
`node_modules`, `vendor`, `dist`, `build`, and `__pycache__`. These exclusions
and the 1 MiB per-file limit can be customized through the Python API.

## Model configuration

The model option is optional and makes no request until selected. Configure
these environment variables before starting the CLI:

- `AGENTIC_IDE_MODEL_PROVIDER`: currently `openai_compatible`.
- `AGENTIC_IDE_MODEL_BASE_URL`: provider API base URL (for example, a provider's
  documented API base URL). Do not put credentials in this URL.
- `AGENTIC_IDE_MODEL_NAME`: model identifier recognized by that endpoint.
- `AGENTIC_IDE_MODEL_API_KEY`: optional for local endpoints; required by most
  hosted providers. Store it in your environment or a secret manager, never in
  source code.
- `AGENTIC_IDE_MODEL_TIMEOUT_SECONDS`: optional positive timeout; defaults to
  30 seconds.

The adapter uses Python's standard library and an OpenAI-compatible
`/chat/completions` endpoint. Other provider protocols can be added behind the
`ModelClient` interface without coupling them to `ModelAgent`. Missing
configuration, authentication failures, rate limits, network failures, and
invalid responses are reported as model errors. No live endpoint is configured
or tested by this project.

Hosted APIs require an account and internet access, send the submitted prompt
to the provider, and may charge for use. A local compatible server can keep
prompts on-device and avoid per-request hosted charges, but requires a runtime
and downloaded model; on an 8 GB Windows laptop it may also compete with VS
Code and the OS for memory. This project does not install a runtime or download
weights.

## Test

```powershell
python -m unittest discover -v
```

Tests use temporary directories and mocked model/network responses. They do
not access a real application workspace, API key, network, or running model.

## Current limitations

- Text files are decoded as UTF-8 (with an optional UTF-8 BOM); other encodings
  are reported as unreadable.
- Search skips binary, undecodable, and over-limit files.
- The CLI uses the default exclusion list and file-size limit; customization is
  available through the Python API.
- Only OpenAI-compatible chat-completions APIs are supported at present.
- Live model use remains unverified until a supported endpoint and credentials
  are configured.

## Standalone desktop IDE

The primary desktop UI is in `desktop-ide/` and is a standalone Electron,
TypeScript, React, and Monaco application. It launches in its own window and
does not require VS Code. See [desktop-ide/README.md](./desktop-ide/README.md)
for Windows installation and launch steps. The earlier `vscode-extension/`
folder is retained as experimental historical work and is not used by the
desktop application.

## Next milestone

Continue hardening the standalone app, then package a Windows installer with
the Python backend. Keep workspace boundaries and tests in place; do not allow
model responses to execute automatically.
