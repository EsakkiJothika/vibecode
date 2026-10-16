from pathlib import Path

from tools.workspace import (
    DEFAULT_MAX_FILE_SIZE_BYTES,
    resolve_workspace_path,
    validate_file_size_limit,
)


class FileTooLargeError(ValueError):
    pass


def read_text_file(
    workspace_root: str | Path,
    relative_path: str | Path,
    max_file_size: int = DEFAULT_MAX_FILE_SIZE_BYTES,
) -> str:
    validate_file_size_limit(max_file_size)
    file_path = resolve_workspace_path(workspace_root, relative_path)

    if not file_path.is_file():
        raise ValueError(f"Not a file: {relative_path}")
    if file_path.stat().st_size > max_file_size:
        raise FileTooLargeError(
            f"File exceeds the {max_file_size}-byte limit: {relative_path}"
        )

    with file_path.open("rb") as source:
        contents = source.read(max_file_size + 1)
    if len(contents) > max_file_size:
        raise FileTooLargeError(
            f"File exceeds the {max_file_size}-byte limit: {relative_path}"
        )
    if b"\x00" in contents:
        raise ValueError(f"File appears to be binary, not text: {relative_path}")

    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise UnicodeError(
            f"File is not readable as UTF-8 text: {relative_path}"
        ) from error
    return text.replace("\r\n", "\n").replace("\r", "\n")