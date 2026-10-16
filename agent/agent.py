from pathlib import Path
from typing import Iterable

from agent.model_client import InvalidModelResponseError, ModelClient
from tools.code_search import SearchMatch, search_codebase
from tools.file_reader import read_text_file
from tools.workspace import (
    DEFAULT_EXCLUDED_DIRS,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    list_workspace_entries,
    validate_workspace,
)


class CodebaseExplorer:
    def __init__(
        self,
        excluded_dirs: Iterable[str] = DEFAULT_EXCLUDED_DIRS,
        max_file_size: int = DEFAULT_MAX_FILE_SIZE_BYTES,
    ) -> None:
        if max_file_size < 0:
            raise ValueError("The maximum file size cannot be negative.")
        self.excluded_dirs = frozenset(excluded_dirs)
        self.max_file_size = max_file_size
        self.workspace: Path | None = None

    def select_workspace(self, path: str | Path) -> Path:
        self.workspace = validate_workspace(path)
        return self.workspace

    def _require_workspace(self) -> Path:
        if self.workspace is None:
            raise ValueError("Select a workspace before using this option.")
        return self.workspace

    def list_files(self) -> list[str]:
        return list_workspace_entries(
            self._require_workspace(),
            excluded_dirs=self.excluded_dirs,
        )

    def read_file(self, relative_path: str | Path) -> str:
        return read_text_file(
            self._require_workspace(),
            relative_path,
            max_file_size=self.max_file_size,
        )

    def search(
        self,
        query: str,
        case_sensitive: bool = True,
    ) -> list[SearchMatch]:
        return search_codebase(
            self._require_workspace(),
            query,
            case_sensitive=case_sensitive,
            excluded_dirs=self.excluded_dirs,
            max_file_size=self.max_file_size,
        )


class ModelAgent:
    def __init__(self, model_client: ModelClient) -> None:
        self.model_client = model_client

    def respond(self, prompt: str) -> str:
        if not prompt.strip():
            raise ValueError("Prompt cannot be empty.")
        response = self.model_client.complete(prompt)
        if not isinstance(response, str) or not response.strip():
            raise InvalidModelResponseError(
                "The model client returned an empty or non-text response."
            )
        return response