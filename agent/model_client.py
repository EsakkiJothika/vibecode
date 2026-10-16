import json
import math
import os
from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ModelError(Exception):
    """Base error for model configuration and request failures."""


class ModelConfigurationError(ModelError):
    pass


class ModelAuthenticationError(ModelError):
    pass


class ModelRateLimitError(ModelError):
    pass


class ModelNetworkError(ModelError):
    pass


class ModelProviderError(ModelError):
    pass


class InvalidModelResponseError(ModelError):
    pass


class ModelClient(Protocol):
    def complete(self, prompt: str) -> str:
        """Send a prompt and return the model's text response."""


@dataclass(frozen=True)
class ModelConfig:
    provider: str
    base_url: str
    model: str
    api_key: str | None = None
    timeout_seconds: float = 30


def model_config_from_env(
    environ: Mapping[str, str] | None = None,
) -> ModelConfig:
    values = os.environ if environ is None else environ
    provider = values.get("AGENTIC_IDE_MODEL_PROVIDER", "").strip().casefold()
    base_url = values.get("AGENTIC_IDE_MODEL_BASE_URL", "").strip()
    model = values.get("AGENTIC_IDE_MODEL_NAME", "").strip()
    api_key = values.get("AGENTIC_IDE_MODEL_API_KEY", "").strip() or None

    missing = [
        name
        for name, value in (
            ("AGENTIC_IDE_MODEL_PROVIDER", provider),
            ("AGENTIC_IDE_MODEL_BASE_URL", base_url),
            ("AGENTIC_IDE_MODEL_NAME", model),
        )
        if not value
    ]
    if missing:
        raise ModelConfigurationError(
            "Missing model configuration: " + ", ".join(missing)
        )
    if provider != "openai_compatible":
        raise ModelConfigurationError(
            f"Unsupported model provider '{provider}'. "
            "Supported provider: openai_compatible."
        )

    try:
        parts = urlsplit(base_url)
        valid_authority = bool(parts.hostname) and parts.port != 0
    except ValueError:
        valid_authority = False
        parts = None
    if (
        parts is None
        or parts.scheme not in {"http", "https"}
        or not valid_authority
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or any(character.isspace() for character in base_url)
    ):
        raise ModelConfigurationError(
            "AGENTIC_IDE_MODEL_BASE_URL must be an HTTP(S) API base URL "
            "without embedded credentials, query, or fragment."
        )

    timeout_text = values.get("AGENTIC_IDE_MODEL_TIMEOUT_SECONDS", "30").strip()
    try:
        timeout_seconds = float(timeout_text)
    except ValueError as error:
        raise ModelConfigurationError(
            "AGENTIC_IDE_MODEL_TIMEOUT_SECONDS must be a positive number."
        ) from error
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ModelConfigurationError(
            "AGENTIC_IDE_MODEL_TIMEOUT_SECONDS must be a positive number."
        )

    return ModelConfig(
        provider=provider,
        base_url=base_url.rstrip("/"),
        model=model,
        api_key=api_key,
        timeout_seconds=timeout_seconds,
    )


class OpenAICompatibleModelClient:
    def __init__(self, config: ModelConfig) -> None:
        if config.provider != "openai_compatible":
            raise ModelConfigurationError(
                f"Unsupported model provider '{config.provider}'."
            )
        self.config = config

    def complete(self, prompt: str) -> str:
        if not prompt.strip():
            raise ValueError("Prompt cannot be empty.")

        payload = json.dumps(
            {
                "model": self.config.model,
                "messages": [{"role": "user", "content": prompt}],
            }
        ).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        request = Request(
            f"{self.config.base_url}/chat/completions",
            data=payload,
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                response_data = response.read()
        except HTTPError as error:
            if error.code in (401, 403):
                raise ModelAuthenticationError(
                    "The model provider rejected authentication. "
                    "Check the configured API key and account access."
                ) from error
            if error.code == 429:
                raise ModelRateLimitError(
                    "The model provider rate limit was reached. Try again later."
                ) from error
            raise ModelProviderError(
                f"The model provider returned HTTP {error.code}."
            ) from error
        except (URLError, TimeoutError, OSError) as error:
            raise ModelNetworkError(
                "Could not connect to the model provider. Check the endpoint "
                "and network connection."
            ) from error

        try:
            body = json.loads(response_data)
            content = body["choices"][0]["message"]["content"]
        except (json.JSONDecodeError, UnicodeDecodeError, KeyError, IndexError, TypeError) as error:
            raise InvalidModelResponseError(
                "The model provider returned an invalid response."
            ) from error
        if not isinstance(content, str) or not content.strip():
            raise InvalidModelResponseError(
                "The model provider returned an empty or non-text response."
            )
        return content


def create_model_client_from_env(
    environ: Mapping[str, str] | None = None,
) -> ModelClient:
    config = model_config_from_env(environ)
    return OpenAICompatibleModelClient(config)
