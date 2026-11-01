import tempfile
import unittest
from pathlib import Path

from tools.file_writer import write_text_file


class FileWriterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_writes_text_and_preserves_crlf_and_utf8_bom(self) -> None:
        target = self.workspace / "sample.txt"
        target.write_bytes(b"\xef\xbb\xbfbefore\r\n")

        write_text_file(self.workspace, "sample.txt", "after\nline\n")

        self.assertEqual(
            target.read_bytes(),
            b"\xef\xbb\xbfafter\r\nline\r\n",
        )

    def test_creates_file_only_when_allowed(self) -> None:
        with self.assertRaises(FileNotFoundError):
            write_text_file(self.workspace, "new.txt", "content")

        write_text_file(
            self.workspace,
            "new.txt",
            "content\n",
            allow_create=True,
        )

        self.assertEqual(
            (self.workspace / "new.txt").read_text(encoding="utf-8"),
            "content\n",
        )

    def test_rejects_paths_outside_workspace_without_changing_files(self) -> None:
        outside = self.workspace.parent / "outside.txt"
        outside.write_text("unchanged", encoding="utf-8")
        try:
            with self.assertRaisesRegex(ValueError, "within the selected workspace"):
                write_text_file(self.workspace, "../outside.txt", "overwrite")
            self.assertEqual(outside.read_text(encoding="utf-8"), "unchanged")
        finally:
            outside.unlink(missing_ok=True)

    def test_rejects_binary_and_oversized_content(self) -> None:
        binary = self.workspace / "binary.dat"
        binary.write_bytes(b"\x00binary")
        text = self.workspace / "text.txt"
        text.write_text("small", encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "binary"):
            write_text_file(self.workspace, "binary.dat", "replacement")
        with self.assertRaisesRegex(ValueError, "1-byte limit"):
            write_text_file(self.workspace, "text.txt", "larger", max_file_size=1)

        self.assertEqual(text.read_text(encoding="utf-8"), "small")


if __name__ == "__main__":
    unittest.main()
