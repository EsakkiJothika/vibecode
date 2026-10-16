import json
import re
import sys
from pathlib import Path
from typing import TextIO

from agent.agent import CodebaseExplorer, ModelAgent
from agent.model_client import ModelError, create_model_client_from_env
from tools.workspace import iter_workspace_files


MAX_REQUEST_LENGTH = 1024 * 1024
MAX_SUMMARY_PREVIEW_LINES = 8
MAX_SUMMARY_PREVIEW_LINE_LENGTH = 240


def handle_request(request: object) -> dict[str, object]:
    request_id: str | int | None = None
    if isinstance(request, dict):
        request_id = request.get("id")

    try:
        if not isinstance(request, dict):
            raise ValueError("Request must be a JSON object.")
        if request_id is not None and not isinstance(request_id, (str, int)):
            raise ValueError("Request id must be a string or integer.")

        operation = request.get("operation")
        if operation == "health":
            return {"id": request_id, "ok": True, "result": {"status": "ready"}}
        if operation == "validate-workspace":
            workspace = _required_string(request, "workspace")
            root = CodebaseExplorer().select_workspace(workspace)
            return {
                "id": request_id,
                "ok": True,
                "result": {"path": str(root)},
            }
        if operation not in {
            "list-files",
            "search-files",
            "search-text",
            "read-file",
            "summarize-file",
            "chat",
        }:
            raise ValueError("Unsupported backend operation.")

        workspace = _required_string(request, "workspace")
        explorer = CodebaseExplorer()
        root = explorer.select_workspace(workspace)

        if operation == "list-files":
            entries = explorer.list_files()
            result: object = [
                {
                    "path": entry,
                    "kind": "directory"
                    if (root / Path(entry)).is_dir()
                    else "file",
                }
                for entry in entries
            ]
        elif operation == "search-files":
            query = _required_string(request, "query")
            needle = query.casefold()
            result = [
                relative_path.as_posix()
                for relative_path, _ in iter_workspace_files(
                    root,
                    explorer.excluded_dirs,
                )
                if needle in relative_path.as_posix().casefold()
            ]
        elif operation == "search-text":
            query = _required_string(request, "query")
            case_sensitive = request.get("case_sensitive", True)
            if not isinstance(case_sensitive, bool):
                raise ValueError("case_sensitive must be a boolean.")
            result = [
                {
                    "path": match.relative_path,
                    "line": match.line_number,
                    "text": match.matching_line,
                }
                for match in explorer.search(query, case_sensitive=case_sensitive)
            ]
        elif operation == "read-file":
            relative_path = _required_string(request, "path")
            result = {
                "path": relative_path,
                "content": explorer.read_file(relative_path),
            }
        elif operation == "summarize-file":
            relative_path = _required_string(request, "path")
            content = explorer.read_file(relative_path)
            lines = content.splitlines()
            preview = [
                line[:MAX_SUMMARY_PREVIEW_LINE_LENGTH]
                for line in lines
                if line.strip()
            ][:MAX_SUMMARY_PREVIEW_LINES]
            result = {
                "path": relative_path,
                "lines": len(lines),
                "characters": len(content),
                "words": len(re.findall(r"\w+", content)),
                "preview": preview,
                "note": "Basic text statistics and preview; no LLM was used.",
            }
        else:
            prompt = _required_string(request, "prompt")
            result = {"text": ModelAgent(create_model_client_from_env()).respond(prompt)}

        return {"id": request_id, "ok": True, "result": result}
    except (OSError, UnicodeError, ValueError, ModelError) as error:
        return {
            "id": request_id,
            "ok": False,
            "error": {"message": str(error)},
        }


def serve(input_stream: TextIO, output_stream: TextIO) -> None:
    while True:
        line = input_stream.readline(MAX_REQUEST_LENGTH + 1)
        if not line:
            return
        if len(line) > MAX_REQUEST_LENGTH and not line.endswith("\n"):
            while line and not line.endswith("\n"):
                line = input_stream.readline(MAX_REQUEST_LENGTH + 1)
            response: dict[str, object] = {
                "id": None,
                "ok": False,
                "error": {"message": "Request exceeds the 1 MiB size limit."},
            }
        elif len(line) > MAX_REQUEST_LENGTH:
            response = {
                "id": None,
                "ok": False,
                "error": {"message": "Request exceeds the 1 MiB size limit."},
            }
        else:
            try:
                response = handle_request(json.loads(line))
            except (json.JSONDecodeError, UnicodeDecodeError):
                response = {
                    "id": None,
                    "ok": False,
                    "error": {"message": "Request is not valid JSON."},
                }

        output_stream.write(json.dumps(response, ensure_ascii=False) + "\n")
        output_stream.flush()


def main() -> None:
    serve(sys.stdin, sys.stdout)


def _required_string(request: dict[str, object], key: str) -> str:
    value = request.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"'{key}' must be a non-empty string.")
    return value


if __name__ == "__main__":
    main()
