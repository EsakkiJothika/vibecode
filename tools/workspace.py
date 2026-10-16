import os
from pathlib import Path
from typing import Iterable, Iterator


DEFAULT_EXCLUDED_DIRS = frozenset(
    {".git", ".venv", "node_modules", "vendor", "dist", "build", "__pycache__"}
)
DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024


def validate_file_size_limit(max_file_size: int) -> None:
    if max_file_size < 0:
        raise ValueError("The maximum file size cannot be negative.")


def validate_workspace(path: str | Path) -> Path:
    workspace = Path(path).expanduser().resolve(strict=True)
    if workspace == Path(workspace.anchor):
        raise ValueError("Select a project directory, not a filesystem root.")
    if not workspace.is_dir():
        raise NotADirectoryError(f"Workspace is not a directory: {workspace}")

    with os.scandir(workspace):
        pass
    return workspace


def resolve_workspace_path(
    workspace_root: str | Path,
    relative_path: str | Path,
) -> Path:
    root = validate_workspace(workspace_root)
    requested_path = Path(relative_path)
    if requested_path.is_absolute() or ".." in requested_path.parts:
        raise ValueError("File paths must stay within the selected workspace.")

    resolved_path = (root / requested_path).resolve(strict=True)
    try:
        resolved_path.relative_to(root)
    except ValueError as error:
        raise ValueError("File paths must stay within the selected workspace.") from error
    return resolved_path


def list_workspace_entries(
    workspace_root: str | Path,
    excluded_dirs: Iterable[str] = DEFAULT_EXCLUDED_DIRS,
) -> list[str]:
    root = validate_workspace(workspace_root)
    excluded = {directory.casefold() for directory in excluded_dirs}
    entries: list[str] = []

    def raise_walk_error(error: OSError) -> None:
        raise error

    for current_root, directories, files in os.walk(
        root,
        topdown=True,
        onerror=raise_walk_error,
        followlinks=False,
    ):
        directories[:] = sorted(
            directory
            for directory in directories
            if directory.casefold() not in excluded
        )
        current_path = Path(current_root)
        entries.extend(
            (current_path / directory).relative_to(root).as_posix()
            for directory in directories
        )
        entries.extend(
            (current_path / filename).relative_to(root).as_posix()
            for filename in sorted(files)
        )

    return sorted(entries)


def iter_workspace_files(
    workspace_root: str | Path,
    excluded_dirs: Iterable[str] = DEFAULT_EXCLUDED_DIRS,
) -> Iterator[tuple[Path, Path]]:
    root = validate_workspace(workspace_root)
    excluded = {directory.casefold() for directory in excluded_dirs}

    def raise_walk_error(error: OSError) -> None:
        raise error

    for current_root, directories, files in os.walk(
        root,
        topdown=True,
        onerror=raise_walk_error,
        followlinks=False,
    ):
        directories[:] = sorted(
            directory
            for directory in directories
            if directory.casefold() not in excluded
        )
        current_path = Path(current_root)
        for filename in sorted(files):
            file_path = current_path / filename
            try:
                resolved_path = file_path.resolve(strict=True)
                resolved_path.relative_to(root)
            except (OSError, ValueError):
                continue
            if resolved_path.is_file():
                yield file_path.relative_to(root), resolved_path
