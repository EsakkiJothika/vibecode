import base64
import tempfile
import unittest
from pathlib import Path

from tools.workspace_operations import (
    create_directory,
    delete_workspace_path,
    read_image_data_url,
    rename_workspace_path,
)


class WorkspaceOperationsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary_directory.name)
        (self.workspace / "src").mkdir()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_creates_directory_and_renames_file(self) -> None:
        create_directory(self.workspace, "src/assets")
        source = self.workspace / "src" / "before.txt"
        source.write_text("content", encoding="utf-8")

        rename_workspace_path(self.workspace, "src/before.txt", "src/after.txt")

        self.assertTrue((self.workspace / "src" / "assets").is_dir())
        self.assertEqual(
            (self.workspace / "src" / "after.txt").read_text(encoding="utf-8"),
            "content",
        )
        self.assertFalse(source.exists())

    def test_deletes_file_and_directory(self) -> None:
        nested = self.workspace / "src" / "nested"
        nested.mkdir()
        (nested / "sample.txt").write_text("content", encoding="utf-8")

        delete_workspace_path(self.workspace, "src/nested")

        self.assertFalse(nested.exists())

    def test_rejects_traversal_without_touching_outside_file(self) -> None:
        outside = self.workspace.parent / "outside-vibecode-test.txt"
        outside.write_text("preserve", encoding="utf-8")
        try:
            with self.assertRaisesRegex(ValueError, "within the selected workspace"):
                delete_workspace_path(self.workspace, "../outside-vibecode-test.txt")
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")
        finally:
            outside.unlink(missing_ok=True)

    def test_rejects_symbolic_link_escape(self) -> None:
        outside = self.workspace.parent / "outside-vibecode-folder"
        outside.mkdir(exist_ok=True)
        try:
            try:
                (self.workspace / "external").symlink_to(
                    outside,
                    target_is_directory=True,
                )
            except OSError as error:
                self.skipTest(f"Creating a symbolic link is unavailable: {error}")
            with self.assertRaisesRegex(ValueError, "within the selected workspace"):
                delete_workspace_path(self.workspace, "external/keep.txt")
        finally:
            (outside / "keep.txt").unlink(missing_ok=True)
            outside.rmdir()

    def test_image_preview_returns_limited_data_url(self) -> None:
        image_bytes = b"\x89PNG\r\n\x1a\nexample"
        (self.workspace / "sample.png").write_bytes(image_bytes)

        data_url = read_image_data_url(self.workspace, "sample.png")

        self.assertTrue(data_url.startswith("data:image/png;base64,"))
        self.assertEqual(
            base64.b64decode(data_url.split(",", maxsplit=1)[1]),
            image_bytes,
        )

    def test_image_preview_rejects_non_images_and_oversized_images(self) -> None:
        (self.workspace / "notes.txt").write_text("text", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "supports PNG"):
            read_image_data_url(self.workspace, "notes.txt")

        (self.workspace / "large.png").write_bytes(b"x" * (5 * 1024 * 1024 + 1))
        with self.assertRaisesRegex(ValueError, "5 MiB"):
            read_image_data_url(self.workspace, "large.png")


if __name__ == "__main__":
    unittest.main()
