import os
import stat
import tempfile
from pathlib import Path

from tools.workspace import (
    DEFAULT_MAX_FILE_SIZE_BYTES,
    validate_workspace,
    validate_file_size_limit,
)


def write_text_file(
    workspace_root: str | Path,
    relative_path: str | Path,
    content: str,
    max_file_size: int = DEFAULT_MAX_FILE_SIZE_BYTES,
    allow_create: bool = False,
) -> None:
    validate_file_size_limit(max_file_size)
    if not isinstance(content, str):
        raise ValueError("File content must be text.")

    root = validate_workspace(workspace_root)
    requested_path = Path(relative_path)
    if requested_path.is_absolute() or ".." in requested_path.parts:
        raise ValueError("File paths must stay within the selected workspace.")

    unresolved_path = root / requested_path
    parent = unresolved_path.parent.resolve(strict=True)
    try:
        parent.relative_to(root)
    except ValueError as error:
        raise ValueError("File paths must stay within the selected workspace.") from error
    if not parent.is_dir():
        raise NotADirectoryError(f"Parent directory does not exist: {parent}")

    file_path = parent / unresolved_path.name
    exists = file_path.exists() or file_path.is_symlink()
    if exists:
        file_path = file_path.resolve(strict=True)
        try:
            file_path.relative_to(root)
        except ValueError as error:
            raise ValueError(
                "File paths must stay within the selected workspace."
            ) from error
        if not file_path.is_file():
            raise ValueError(f"Not a file: {relative_path}")
    elif not allow_create:
        raise FileNotFoundError(f"File does not exist: {relative_path}")

    if exists and file_path.stat().st_size > max_file_size:
        raise ValueError(
            f"File exceeds the {max_file_size}-byte limit: {relative_path}"
        )

    if exists:
        with file_path.open("rb") as source:
            original = source.read(max_file_size + 1)
    else:
        original = b""
    if len(original) > max_file_size:
        raise ValueError(
            f"File exceeds the {max_file_size}-byte limit: {relative_path}"
        )
    if b"\x00" in original:
        raise ValueError(f"File appears to be binary, not text: {relative_path}")
    try:
        original.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise UnicodeError(
            f"File is not writable as UTF-8 text: {relative_path}"
        ) from error

    newline = "\r\n" if b"\r\n" in original else "\r" if b"\r" in original else "\n"
    normalized_content = content.replace("\r\n", "\n").replace("\r", "\n")
    encoded_content = normalized_content.replace("\n", newline).encode("utf-8")
    if original.startswith(b"\xef\xbb\xbf"):
        encoded_content = b"\xef\xbb\xbf" + encoded_content
    if len(encoded_content) > max_file_size:
        raise ValueError(
            f"File exceeds the {max_file_size}-byte limit: {relative_path}"
        )

    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=file_path.parent,
            prefix=f".{file_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = temporary_file.name
            temporary_file.write(encoded_content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        if exists:
            os.chmod(temporary_path, stat.S_IMODE(file_path.stat().st_mode))
        os.replace(temporary_path, file_path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)