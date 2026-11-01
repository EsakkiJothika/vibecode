import json
import re
import sys
from pathlib import Path
from typing import TextIO

from agent.agent import CodebaseExplorer, ModelAgent
from agent.model_client import ModelError, create_model_client_from_env
from tools.file_writer import write_text_file
from tools.workspace import iter_workspace_files
from tools.workspace_operations import (
    create_directory,
    delete_workspace_path,
    read_image_data_url,
    resolve_workspace_path,
    rename_workspace_path,
)


MAX_REQUEST_LENGTH = 8 * 1024 * 1024
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
            "write-file",
            "summarize-file",
            "create-directory",
            "rename-path",
            "delete-path",
            "read-image",
            "resolve-path",
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
            matches = [
                {
                    "path": match.relative_path,
                    "line": match.line_number,
                    "text": match.matching_line,
                }
                for match in explorer.search(query, case_sensitive=case_sensitive)
            ]
            directory = request.get("directory")
            if directory is not None:
                if not isinstance(directory, str) or not directory.strip():
                    raise ValueError("'directory' must be a non-empty relative path.")
                resolved_directory = resolve_workspace_path(root, directory)
                if not resolved_directory.is_dir():
                    raise NotADirectoryError(f"Not a directory: {directory}")
                result = [
                    match
                    for match in matches
                    if Path(match["path"]).is_relative_to(
                        Path(directory.replace("\\", "/"))
                    )
                ]
            else:
                result = matches
        elif operation == "read-file":
            relative_path = _required_string(request, "path")
            result = {
                "path": relative_path,
                "content": explorer.read_file(relative_path),
            }
        elif operation == "write-file":
            relative_path = _required_string(request, "path")
            content = request.get("content")
            allow_create = request.get("allow_create", False)
            if not isinstance(content, str):
                raise ValueError("'content' must be text.")
            if not isinstance(allow_create, bool):
                raise ValueError("'allow_create' must be a boolean.")
            write_text_file(
                root,
                relative_path,
                content,
                allow_create=allow_create,
            )
            result = {"path": relative_path, "content": content}
        elif operation == "create-directory":
            relative_path = _required_string(request, "path")
            create_directory(root, relative_path)
            result = {"path": relative_path}
        elif operation == "rename-path":
            relative_path = _required_string(request, "path")
            new_relative_path = _required_string(request, "new_path")
            rename_workspace_path(root, relative_path, new_relative_path)
            result = {"path": new_relative_path}
        elif operation == "delete-path":
            relative_path = _required_string(request, "path")
            delete_workspace_path(root, relative_path)
            result = {"path": relative_path}
        elif operation == "read-image":
            relative_path = _required_string(request, "path")
            result = {
                "path": relative_path,
                "data_url": read_image_data_url(root, relative_path),
            }
        elif operation == "resolve-path":
            relative_path = _required_string(request, "path")
            result = {"path": str(resolve_workspace_path(root, relative_path))}
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
                "error": {"message": "Request exceeds the 8 MiB size limit."},
            }
        elif len(line) > MAX_REQUEST_LENGTH:
            response = {
                "id": None,
                "ok": False,
                "error": {"message": "Request exceeds the 8 MiB size limit."},
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
