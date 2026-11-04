import base64
import shutil
from pathlib import Path

from tools.workspace import validate_workspace


IMAGE_MIME_TYPES = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024


def create_directory(workspace_root: str | Path, relative_path: str | Path) -> None:
    root = validate_workspace(workspace_root)
    target = _resolve_workspace_path(root, relative_path, allow_missing=True)
    target.mkdir()


def rename_workspace_path(
    workspace_root: str | Path,
    relative_path: str | Path,
    new_relative_path: str | Path,
) -> None:
    root = validate_workspace(workspace_root)
    source = _resolve_workspace_path(root, relative_path)
    destination = _resolve_workspace_path(root, new_relative_path, allow_missing=True)
    if source == root:
        raise ValueError("The workspace root cannot be renamed.")
    if source == destination:
        raise ValueError("Choose a different name.")
    if source.is_dir() and destination.is_relative_to(source):
        raise ValueError("A folder cannot be moved inside itself.")
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Destination already exists: {new_relative_path}")
    source.rename(destination)


def delete_workspace_path(
    workspace_root: str | Path,
    relative_path: str | Path,
) -> None:
    root = validate_workspace(workspace_root)
    target = _resolve_workspace_path(root, relative_path)
    if target == root:
        raise ValueError("The workspace root cannot be deleted.")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()


def read_image_data_url(
    workspace_root: str | Path,
    relative_path: str | Path,
) -> str:
    root = validate_workspace(workspace_root)
    target = _resolve_workspace_path(root, relative_path)
    mime_type = IMAGE_MIME_TYPES.get(target.suffix.lower())
    if mime_type is None:
        raise ValueError("Image preview supports PNG, JPEG, GIF, WebP, BMP, AVIF, and SVG files.")
    with target.open("rb") as image_file:
        image_bytes = image_file.read(MAX_IMAGE_SIZE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise ValueError("Image exceeds the 5 MiB preview limit.")
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def resolve_workspace_path(
    workspace_root: str | Path,
    relative_path: str | Path,
) -> Path:
    root = validate_workspace(workspace_root)
    return _resolve_workspace_path(root, relative_path)


def _resolve_workspace_path(
    root: Path,
    relative_path: str | Path,
    *,
    allow_missing: bool = False,
) -> Path:
    requested = Path(relative_path)
    if requested.is_absolute() or ".." in requested.parts or not requested.parts:
        raise ValueError("File paths must stay within the selected workspace.")

    unresolved = root / requested
    if unresolved.is_symlink():
        raise ValueError("File operations do not follow symbolic links.")
    parent = unresolved.parent.resolve(strict=True)
    try:
        parent.relative_to(root)
    except ValueError as error:
        raise ValueError("File paths must stay within the selected workspace.") from error

    target = parent / unresolved.name
    if target.is_symlink():
        raise ValueError("File operations do not follow symbolic links.")
    if allow_missing:
        return target

    resolved = target.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError("File paths must stay within the selected workspace.") from error
    return resolved
