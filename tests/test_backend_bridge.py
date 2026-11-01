import io
import json
import tempfile
import unittest
from pathlib import Path

from agent.bridge import handle_request, serve


class BackendBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary_directory.name)
        (self.workspace / "src").mkdir()
        (self.workspace / "src" / "hello.py").write_text(
            "def greet(name):\n    return f'Hello {name}'\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def request(self, operation: str, **fields: object) -> dict[str, object]:
        return handle_request(
            {
                "id": "test-1",
                "operation": operation,
                "workspace": str(self.workspace),
                **fields,
            }
        )

    def test_health_response(self) -> None:
        self.assertEqual(
            handle_request({"id": 1, "operation": "health"}),
            {"id": 1, "ok": True, "result": {"status": "ready"}},
        )

    def test_validates_workspace_folder(self) -> None:
        response = handle_request(
            {"id": 4, "operation": "validate-workspace", "workspace": str(self.workspace)}
        )

        self.assertTrue(response["ok"])
        self.assertEqual(Path(response["result"]["path"]), self.workspace.resolve())

    def test_lists_workspace_paths_with_types(self) -> None:
        response = self.request("list-files")

        self.assertTrue(response["ok"])
        self.assertEqual(
            response["result"],
            [
                {"path": "src", "kind": "directory"},
                {"path": "src/hello.py", "kind": "file"},
            ],
        )

    def test_searches_file_names_and_text(self) -> None:
        name_response = self.request("search-files", query="HELLO")
        text_response = self.request("search-text", query="return")

        self.assertEqual(name_response["result"], ["src/hello.py"])
        self.assertEqual(
            text_response["result"],
            [{"path": "src/hello.py", "line": 2, "text": "    return f'Hello {name}'"}],
        )

    def test_search_text_can_be_scoped_to_a_folder(self) -> None:
        (self.workspace / "other").mkdir()
        (self.workspace / "other" / "hello.py").write_text(
            "return outside\n",
            encoding="utf-8",
        )

        response = self.request(
            "search-text",
            query="return",
            directory="src",
        )

        self.assertEqual(
            response["result"],
            [{"path": "src/hello.py", "line": 2, "text": "    return f'Hello {name}'"}],
        )

    def test_creates_renames_and_deletes_workspace_paths(self) -> None:
        created = self.request("create-directory", path="src/assets")
        renamed = self.request(
            "rename-path",
            path="src/hello.py",
            new_path="src/greetings.py",
        )
        deleted = self.request("delete-path", path="src/assets")

        self.assertTrue(created["ok"])
        self.assertTrue(renamed["ok"])
        self.assertTrue(deleted["ok"])
        self.assertTrue((self.workspace / "src" / "greetings.py").exists())
        self.assertFalse((self.workspace / "src" / "hello.py").exists())
        self.assertFalse((self.workspace / "src" / "assets").exists())

    def test_resolves_only_workspace_paths_for_reveal(self) -> None:
        response = self.request("resolve-path", path="src/hello.py")
        escaped = self.request("resolve-path", path="../outside.txt")

        self.assertTrue(response["ok"])
        self.assertEqual(
            Path(response["result"]["path"]),
            self.workspace / "src" / "hello.py",
        )
        self.assertFalse(escaped["ok"])

    def test_reads_and_summarizes_file(self) -> None:
        read_response = self.request("read-file", path="src/hello.py")
        summary_response = self.request("summarize-file", path="src/hello.py")

        self.assertIn("def greet", read_response["result"]["content"])
        self.assertEqual(summary_response["result"]["lines"], 2)
        self.assertIn("no LLM", summary_response["result"]["note"])

    def test_writes_file_content_within_workspace(self) -> None:
        response = self.request(
            "write-file",
            path="src/hello.py",
            content="def greet(name):\n    return 'Hi ' + name\n",
        )

        self.assertTrue(response["ok"])
        self.assertEqual(
            (self.workspace / "src" / "hello.py").read_text(encoding="utf-8"),
            "def greet(name):\n    return 'Hi ' + name\n",
        )

    def test_creates_new_file_when_explicitly_allowed(self) -> None:
        response = self.request(
            "write-file",
            path="src/new.txt",
            content="new file\n",
            allow_create=True,
        )

        self.assertTrue(response["ok"])
        self.assertEqual(
            (self.workspace / "src" / "new.txt").read_text(encoding="utf-8"),
            "new file\n",
        )

    def test_write_file_requires_explicit_permission_to_create(self) -> None:
        response = self.request(
            "write-file",
            path="src/new.txt",
            content="must not be created",
        )

        self.assertFalse(response["ok"])
        self.assertFalse((self.workspace / "src" / "new.txt").exists())

    def test_write_file_rejects_paths_outside_workspace(self) -> None:
        response = self.request(
            "write-file",
            path="../outside.txt",
            content="must not be written",
            allow_create=True,
        )

        self.assertFalse(response["ok"])
        self.assertFalse((self.workspace.parent / "outside.txt").exists())

    def test_rejects_paths_outside_workspace_and_unknown_operations(self) -> None:
        escaped = self.request("read-file", path="../outside.txt")
        unknown = self.request("execute", workspace=str(self.workspace))

        self.assertFalse(escaped["ok"])
        self.assertFalse(unknown["ok"])

    def test_json_lines_protocol_returns_one_response_per_request(self) -> None:
        input_stream = io.StringIO(
            json.dumps({"id": "a", "operation": "health"})
            + "\nnot-json\n"
        )
        output_stream = io.StringIO()

        serve(input_stream, output_stream)

        responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]
        self.assertEqual(len(responses), 2)
        self.assertTrue(responses[0]["ok"])
        self.assertFalse(responses[1]["ok"])

    def test_json_lines_protocol_accepts_editor_content_over_one_mib(self) -> None:
        target = self.workspace / "large.txt"
        target.write_text("", encoding="utf-8")
        content = "x\n" * 350_000
        input_stream = io.StringIO(
            json.dumps(
                {
                    "id": "large-edit",
                    "operation": "write-file",
                    "workspace": str(self.workspace),
                    "path": "large.txt",
                    "content": content,
                }
            )
            + "\n"
        )
        output_stream = io.StringIO()

        serve(input_stream, output_stream)

        response = json.loads(output_stream.getvalue())
        self.assertTrue(response["ok"])
        self.assertEqual(target.read_text(encoding="utf-8"), content)


if __name__ == "__main__":
    unittest.main()
