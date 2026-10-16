from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from tools.workspace import (
    DEFAULT_EXCLUDED_DIRS,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    iter_workspace_files,
    validate_file_size_limit,
    validate_workspace,
)


@dataclass(frozen=True)
class SearchMatch:
    relative_path: str
    line_number: int
    matching_line: str


def search_codebase(
    workspace_root: str | Path,
    query: str,
    case_sensitive: bool = True,
    excluded_dirs: Iterable[str] = DEFAULT_EXCLUDED_DIRS,
    max_file_size: int = DEFAULT_MAX_FILE_SIZE_BYTES,
) -> list[SearchMatch]:
    if not query:
        raise ValueError("Search text cannot be empty.")
    validate_file_size_limit(max_file_size)
    root = validate_workspace(workspace_root)
    search_term = query if case_sensitive else query.casefold()
    matches: list[SearchMatch] = []

    for relative_path, file_path in iter_workspace_files(root, excluded_dirs):
        if file_path.stat().st_size > max_file_size:
            continue

        with file_path.open("rb") as source:
            contents = source.read(max_file_size + 1)
        if len(contents) > max_file_size or b"\x00" in contents:
            continue
        try:
            text = contents.decode("utf-8-sig")
        except UnicodeDecodeError:
            continue

        for line_number, line in enumerate(text.splitlines(), start=1):
            searchable_line = line if case_sensitive else line.casefold()
            if search_term in searchable_line:
                matches.append(
                    SearchMatch(
                        relative_path=relative_path.as_posix(),
                        line_number=line_number,
                        matching_line=line,
                    )
                )

    return matches