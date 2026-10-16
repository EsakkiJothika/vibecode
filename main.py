from collections.abc import Callable

from agent import CodebaseExplorer, ModelAgent
from agent.model_client import ModelError, create_model_client_from_env
from tools.file_reader import FileTooLargeError


def _show_menu() -> None:
    print(
        "\nCodebase Explorer\n"
        "1. Select or change workspace\n"
        "2. List files\n"
        "3. Read a file\n"
        "4. Search the codebase\n"
        "5. Display the current workspace\n"
        "6. Exit\n"
        "7. Ask the model"
    )


def _ask_case_sensitivity(input_fn: Callable[[str], str]) -> bool:
    while True:
        answer = input_fn("Case-sensitive search? [Y/n]: ").strip().casefold()
        if answer in ("", "y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        print("Enter y or n.")


def main() -> None:
    explorer = CodebaseExplorer()

    while True:
        _show_menu()
        choice = input("Choose an option: ").strip()

        if choice == "1":
            path = input("Workspace directory: ").strip().strip('"')
            try:
                workspace = explorer.select_workspace(path)
                print(f"Workspace set to: {workspace}")
            except (OSError, ValueError) as error:
                print(f"Could not select workspace: {error}")
        elif choice == "2":
            try:
                entries = explorer.list_files()
                if entries:
                    print("\n".join(entries))
                else:
                    print("No files or directories found.")
            except (OSError, ValueError) as error:
                print(f"Could not list workspace: {error}")
        elif choice == "3":
            relative_path = input("Workspace-relative file path: ").strip()
            try:
                print(explorer.read_file(relative_path))
            except (OSError, UnicodeError, ValueError, FileTooLargeError) as error:
                print(f"Could not read file: {error}")
        elif choice == "4":
            query = input("Text to search for: ")
            case_sensitive = _ask_case_sensitivity(input)
            try:
                matches = explorer.search(query, case_sensitive=case_sensitive)
                if matches:
                    for match in matches:
                        print(
                            f"{match.relative_path}:{match.line_number}: "
                            f"{match.matching_line}"
                        )
                else:
                    print("No matches found.")
            except (OSError, ValueError) as error:
                print(f"Could not search workspace: {error}")
        elif choice == "5":
            if explorer.workspace is None:
                print("No workspace selected.")
            else:
                print(f"Current workspace: {explorer.workspace}")
        elif choice == "6":
            print("Goodbye.")
            return
        elif choice == "7":
            prompt = input("Prompt: ")
            try:
                model_agent = ModelAgent(create_model_client_from_env())
                print(model_agent.respond(prompt))
            except (ModelError, OSError, ValueError) as error:
                print(f"Could not get a model response: {error}")
        else:
            print("Invalid option. Choose a number from 1 to 7.")


if __name__ == "__main__":
    main()