import tempfile
import unittest
from pathlib import Path

from agent import CodebaseExplorer
from tools.code_search import search_codebase
from tools.file_reader import FileTooLargeError, read_text_file
from tools.workspace import list_workspace_entries, validate_workspace


class CodebaseExplorerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_lists_files_and_directories_in_workspace(self) -> None:
        (self.workspace / "src").mkdir()
        (self.workspace / "src" / "app.py").write_text("print('hello')", encoding="utf-8")
        (self.workspace / "README.md").write_text("Project", encoding="utf-8")

        entries = list_workspace_entries(self.workspace)

        self.assertEqual(entries, ["README.md", "src", "src/app.py"])

    def test_excludes_configured_directories(self) -> None:
        (self.workspace / "vendor").mkdir()
        (self.workspace / "vendor" / "dependency.txt").write_text("hidden", encoding="utf-8")
        (self.workspace / "src").mkdir()
        (self.workspace / "src" / "main.js").write_text("visible", encoding="utf-8")

        entries = list_workspace_entries(
            self.workspace,
            excluded_dirs={".git", "vendor"},
        )

        self.assertEqual(entries, ["src", "src/main.js"])

    def test_reads_valid_text_file(self) -> None:
        (self.workspace / "notes.txt").write_text("hello\nworld\n", encoding="utf-8")

        contents = read_text_file(self.workspace, "notes.txt")

        self.assertEqual(contents, "hello\nworld\n")

    def test_missing_file_raises_file_not_found(self) -> None:
        with self.assertRaises(FileNotFoundError):
            read_text_file(self.workspace, "missing.txt")

    def test_rejects_paths_outside_workspace(self) -> None:
        with self.assertRaises(ValueError):
            read_text_file(self.workspace, "../outside.txt")

        with self.assertRaises(ValueError):
            read_text_file(self.workspace, str(self.workspace.parent / "outside.txt"))

    def test_rejects_a_filesystem_root_as_workspace(self) -> None:
        with self.assertRaisesRegex(ValueError, "filesystem root"):
            validate_workspace(self.workspace.anchor)

    def test_search_returns_matching_lines_and_line_numbers(self) -> None:
        (self.workspace / "src").mkdir()
        (self.workspace / "src" / "app.py").write_text(
            "first\nneedle here\nlast needle\n",
            encoding="utf-8",
        )

        matches = search_codebase(self.workspace, "needle")

        self.assertEqual(
            [(match.relative_path, match.line_number, match.matching_line) for match in matches],
            [
                ("src/app.py", 2, "needle here"),
                ("src/app.py", 3, "last needle"),
            ],
        )

    def test_search_can_ignore_case(self) -> None:
        (self.workspace / "app.js").write_text("Agentic IDE\n", encoding="utf-8")

        matches = search_codebase(self.workspace, "agentic ide", case_sensitive=False)

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].line_number, 1)

    def test_reader_rejects_oversized_and_invalid_text_files(self) -> None:
        (self.workspace / "large.txt").write_bytes(b"12345")
        (self.workspace / "invalid.txt").write_bytes(b"\xff")

        with self.assertRaises(FileTooLargeError):
            read_text_file(self.workspace, "large.txt", max_file_size=4)
        with self.assertRaises(UnicodeError):
            read_text_file(self.workspace, "invalid.txt")

    def test_search_skips_oversized_and_binary_files(self) -> None:
        (self.workspace / "large.txt").write_text("needle" * 5, encoding="utf-8")
        (self.workspace / "binary.bin").write_bytes(b"needle\x00binary")

        matches = search_codebase(self.workspace, "needle", max_file_size=10)

        self.assertEqual(matches, [])

    def test_explorer_requires_a_selected_workspace(self) -> None:
        explorer = CodebaseExplorer()

        with self.assertRaisesRegex(ValueError, "Select a workspace"):
            explorer.list_files()


if __name__ == "__main__":
    unittest.main()
