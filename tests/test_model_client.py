import io
import json
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import MagicMock, patch

from agent.agent import ModelAgent
from agent.model_client import (
    InvalidModelResponseError,
    ModelAuthenticationError,
    ModelConfigurationError,
    ModelNetworkError,
    ModelRateLimitError,
    ModelConfig,
    OpenAICompatibleModelClient,
    create_model_client_from_env,
    model_config_from_env,
)


class MockModelClient:
    def __init__(self, response: str) -> None:
        self.response = response
        self.prompts: list[str] = []

    def complete(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return self.response


class ModelClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = ModelConfig(
            provider="openai_compatible",
            base_url="https://api.example.test/v1",
            model="test-model",
            api_key="test-secret",
            timeout_seconds=4,
        )

    def test_model_agent_uses_injected_client(self) -> None:
        client = MockModelClient("A response")
        agent = ModelAgent(client)

        response = agent.respond("Explain this code")

        self.assertEqual(response, "A response")
        self.assertEqual(client.prompts, ["Explain this code"])

    def test_model_agent_rejects_empty_prompt_and_response(self) -> None:
        with self.assertRaises(ValueError):
            ModelAgent(MockModelClient("unused")).respond("  ")
        with self.assertRaises(InvalidModelResponseError):
            ModelAgent(MockModelClient("  ")).respond("A prompt")

    def test_environment_configuration_requires_provider_url_and_model(self) -> None:
        with self.assertRaisesRegex(ModelConfigurationError, "AGENTIC_IDE_MODEL_PROVIDER"):
            create_model_client_from_env({})

        config = model_config_from_env(
            {
                "AGENTIC_IDE_MODEL_PROVIDER": "openai_compatible",
                "AGENTIC_IDE_MODEL_BASE_URL": "https://api.example.test/v1/",
                "AGENTIC_IDE_MODEL_NAME": "test-model",
            }
        )

        self.assertEqual(config.base_url, "https://api.example.test/v1")
        self.assertIsNone(config.api_key)

    def test_environment_configuration_rejects_unsupported_provider(self) -> None:
        with self.assertRaisesRegex(ModelConfigurationError, "Unsupported model provider"):
            model_config_from_env(
                {
                    "AGENTIC_IDE_MODEL_PROVIDER": "unknown",
                    "AGENTIC_IDE_MODEL_BASE_URL": "https://api.example.test/v1",
                    "AGENTIC_IDE_MODEL_NAME": "test-model",
                }
            )

    def test_environment_configuration_rejects_invalid_url_and_timeout(self) -> None:
        environment = {
            "AGENTIC_IDE_MODEL_PROVIDER": "openai_compatible",
            "AGENTIC_IDE_MODEL_BASE_URL": "https://[invalid",
            "AGENTIC_IDE_MODEL_NAME": "test-model",
        }
        with self.assertRaisesRegex(ModelConfigurationError, "BASE_URL"):
            model_config_from_env(environment)

        environment["AGENTIC_IDE_MODEL_BASE_URL"] = "https://api.example.test/v1"
        environment["AGENTIC_IDE_MODEL_TIMEOUT_SECONDS"] = "nan"
        with self.assertRaisesRegex(ModelConfigurationError, "TIMEOUT_SECONDS"):
            model_config_from_env(environment)

    @patch("agent.model_client.urlopen")
    def test_openai_compatible_request_parses_response(
        self,
        mock_urlopen: MagicMock,
    ) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"choices": [{"message": {"content": "Model response"}}]}
        ).encode("utf-8")
        mock_urlopen.return_value = response

        result = OpenAICompatibleModelClient(self.config).complete("Hello")

        self.assertEqual(result, "Model response")
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.example.test/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-secret")
        self.assertEqual(json.loads(request.data)["messages"][0]["content"], "Hello")
        mock_urlopen.assert_called_once_with(request, timeout=4)

    @patch("agent.model_client.urlopen")
    def test_maps_authentication_and_rate_limit_errors(
        self,
        mock_urlopen: MagicMock,
    ) -> None:
        for status, error_type in (
            (401, ModelAuthenticationError),
            (403, ModelAuthenticationError),
            (429, ModelRateLimitError),
        ):
            with self.subTest(status=status):
                mock_urlopen.side_effect = HTTPError(
                    "https://api.example.test",
                    status,
                    "provider error",
                    None,
                    io.BytesIO(b"provider details are not displayed"),
                )
                with self.assertRaises(error_type):
                    OpenAICompatibleModelClient(self.config).complete("Hello")

    @patch("agent.model_client.urlopen", side_effect=URLError("offline"))
    def test_maps_network_errors(self, _mock_urlopen: MagicMock) -> None:
        with self.assertRaises(ModelNetworkError):
            OpenAICompatibleModelClient(self.config).complete("Hello")

    @patch("agent.model_client.urlopen")
    def test_rejects_invalid_provider_responses(self, mock_urlopen: MagicMock) -> None:
        bodies = (
            b"not json",
            b'{"choices":[]}',
            b'{"choices":[{"message":{"content":null}}]}',
        )
        for body in bodies:
            with self.subTest(body=body):
                response = MagicMock()
                response.__enter__.return_value.read.return_value = body
                mock_urlopen.return_value = response
                with self.assertRaises(InvalidModelResponseError):
                    OpenAICompatibleModelClient(self.config).complete("Hello")


if __name__ == "__main__":
    unittest.main()
