#!/usr/bin/env python3
"""Prune dangling Docker images after observing a successful Portainer deployment."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


POLL_INTERVAL_SECONDS = 15
REQUEST_TIMEOUT_SECONDS = 15
STATE_DIRECTORY = Path("/var/lib/rossmoney-image-prune")
LOGGER = logging.getLogger("rossmoney-image-prune")


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def _urlopen_without_redirects(request: urllib.request.Request, timeout: int):
    opener = urllib.request.build_opener(_NoRedirectHandler)
    return opener.open(request, timeout=timeout)


class WorkerError(RuntimeError):
    pass


@dataclass(frozen=True)
class Config:
    api_url: str
    api_token: str
    stack_id: str
    poll_interval_seconds: int = POLL_INTERVAL_SECONDS

    @classmethod
    def from_environment(cls) -> Config:
        api_url = os.environ.get("PORTAINER_API_URL", "")
        api_token = os.environ.get("PORTAINER_API_TOKEN", "")
        stack_id = os.environ.get("PORTAINER_STACK_ID", "")
        interval = os.environ.get(
            "PORTAINER_POLL_INTERVAL_SECONDS", str(POLL_INTERVAL_SECONDS)
        )
        if not api_url or not api_token or not stack_id:
            raise WorkerError(
                "PORTAINER_API_URL, PORTAINER_API_TOKEN, and PORTAINER_STACK_ID are required."
            )
        if not interval.isdecimal() or int(interval) <= 0:
            raise WorkerError("PORTAINER_POLL_INTERVAL_SECONDS must be positive.")

        config = cls(api_url, api_token, stack_id, int(interval))
        config.validate()
        return config

    def validate(self) -> None:
        parsed = urllib.parse.urlsplit(self.api_url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise WorkerError(
                "PORTAINER_API_URL must be HTTPS without credentials or query parameters."
            )
        if not re.fullmatch(r"[0-9]+", self.stack_id):
            raise WorkerError("PORTAINER_STACK_ID must be numeric.")


class PortainerClient:
    def __init__(self, config: Config, urlopen: Callable = _urlopen_without_redirects):
        self.config = config
        self.urlopen = urlopen

    def get_stack(self) -> dict:
        request = urllib.request.Request(
            f"{self.config.api_url.rstrip('/')}/api/stacks/{self.config.stack_id}",
            headers={"X-API-Key": self.config.api_token},
        )
        try:
            with self.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                if response.status != 200:
                    raise WorkerError(f"Portainer stack query failed (HTTP {response.status}).")
                stack = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise WorkerError(f"Portainer stack query failed (HTTP {error.code}).") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise WorkerError("Portainer request failed due to a network or TLS error.") from error
        except (TypeError, ValueError) as error:
            raise WorkerError("Portainer returned invalid stack data.") from error
        if not isinstance(stack, dict):
            raise WorkerError("Portainer returned invalid stack data.")
        return stack


def state_path_for(config: Config) -> Path:
    identity = f"{config.api_url.rstrip('/')}/api/stacks/{config.stack_id}"
    state_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return STATE_DIRECTORY / f"{state_id}.json"


def deployment_history(stack: dict) -> list[dict]:
    history = stack.get("DeploymentStatus")
    if not isinstance(history, list) or any(not isinstance(item, dict) for item in history):
        raise WorkerError("Portainer stack response has invalid deployment status history.")
    return history


def latest_active_time(stack: dict) -> int:
    times = [
        item["Time"]
        for item in deployment_history(stack)
        if type(item.get("Status")) is int
        and item["Status"] == 1
        and type(item.get("Time")) is int
    ]
    return max(times, default=0)


def confirmed_new_deployment(stack: dict, last_active_time: int) -> int | None:
    if type(stack.get("Status")) is not int or stack["Status"] != 1:
        return None
    history = deployment_history(stack)
    if not history:
        return None

    completed = history[-1]
    if (
        type(completed.get("Status")) is not int
        or completed["Status"] != 1
        or type(completed.get("Time")) is not int
        or completed["Time"] <= last_active_time
    ):
        return None

    has_new_deploying_status = any(
        type(item.get("Status")) is int
        and item["Status"] == 3
        and type(item.get("Time")) is int
        and item["Time"] > last_active_time
        and item["Time"] <= completed["Time"]
        for item in history[:-1]
    )
    return completed["Time"] if has_new_deploying_status else None


def load_state(path: Path) -> int | None:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as error:
        raise WorkerError("Could not read the persisted cleanup state.") from error
    if (
        not isinstance(state, dict)
        or type(state.get("last_active_time")) is not int
        or state["last_active_time"] < 0
    ):
        raise WorkerError("Persisted cleanup state has an invalid format.")
    return state["last_active_time"]


def save_state(path: Path, active_time: int) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as temporary:
            json.dump({"last_active_time": active_time}, temporary)
            temporary.write("\n")
            temporary_path = Path(temporary.name)
        temporary_path.chmod(0o600)
        temporary_path.replace(path)
    except OSError as error:
        raise WorkerError("Could not persist the cleanup state.") from error


def run_dangling_image_prune(run: Callable = subprocess.run) -> None:
    try:
        run(["/usr/bin/docker", "image", "prune", "-f"], check=True)
    except FileNotFoundError as error:
        raise WorkerError("Docker CLI is unavailable on this host.") from error
    except subprocess.CalledProcessError as error:
        raise WorkerError(
            f"Dangling-image cleanup failed (exit status {error.returncode})."
        ) from error
    except OSError as error:
        raise WorkerError("Could not run dangling-image cleanup.") from error


def poll_once(
    client: PortainerClient,
    state_path: Path,
    prune: Callable = run_dangling_image_prune,
) -> None:
    stack = client.get_stack()
    last_active_time = load_state(state_path)
    if last_active_time is None:
        last_active_time = latest_active_time(stack)
        save_state(state_path, last_active_time)
        LOGGER.info("Initialized cleanup state from the current Portainer stack.")
        if stack.get("Status") != 1:
            if stack.get("Status") == 4:
                LOGGER.error("Portainer reports a deployment error; cleanup was skipped.")
            return

    if stack.get("Status") == 4:
        LOGGER.error("Portainer reports a deployment error; cleanup was skipped.")
        return

    deployment_time = confirmed_new_deployment(stack, last_active_time)
    if deployment_time is None:
        return

    LOGGER.info("Portainer confirmed a new successful deployment; pruning dangling images.")
    prune()
    save_state(state_path, deployment_time)
    LOGGER.info("Dangling-image cleanup completed.")


def run_worker(
    config: Config,
    state_path: Path | None = None,
    urlopen: Callable = _urlopen_without_redirects,
    sleep: Callable[[float], None] = time.sleep,
    prune: Callable = run_dangling_image_prune,
) -> None:
    client = PortainerClient(config, urlopen=urlopen)
    if state_path is None:
        state_path = state_path_for(config)
    while True:
        try:
            poll_once(client, state_path=state_path, prune=prune)
        except WorkerError as error:
            LOGGER.error("%s", error)
        sleep(config.poll_interval_seconds)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        config = Config.from_environment()
        run_worker(config)
    except WorkerError as error:
        LOGGER.error("%s", error)
        return 1
    except KeyboardInterrupt:
        LOGGER.info("Stopping worker.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
