#!/usr/bin/env python3
"""Trigger a Portainer stack webhook and prune host images only after success."""

from __future__ import annotations

import json
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


POLL_INTERVAL_SECONDS = 5
REQUEST_TIMEOUT_SECONDS = 15
DEFAULT_DEPLOYMENT_TIMEOUT_SECONDS = 900


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def _urlopen_without_redirects(
    request: urllib.request.Request, timeout: int
):
    opener = urllib.request.build_opener(_NoRedirectHandler)
    return opener.open(request, timeout=timeout)


class DeploymentError(RuntimeError):
    pass


@dataclass(frozen=True)
class Config:
    webhook_url: str
    api_url: str
    api_token: str
    stack_id: str
    deploy_host: str
    deploy_user: str
    ssh_private_key: str
    ssh_known_hosts: str
    deployment_timeout_seconds: int = DEFAULT_DEPLOYMENT_TIMEOUT_SECONDS

    @classmethod
    def from_environment(cls) -> Config:
        required = (
            "PORTAINER_WEBHOOK_URL",
            "PORTAINER_API_URL",
            "PORTAINER_API_TOKEN",
            "PORTAINER_STACK_ID",
            "DEPLOY_HOST",
            "DEPLOY_USER",
            "DEPLOY_SSH_PRIVATE_KEY",
            "DEPLOY_SSH_KNOWN_HOSTS",
        )
        environment = {name: os.environ.get(name, "") for name in required}
        missing = [name for name, value in environment.items() if not value]
        if missing:
            raise DeploymentError(
                "Missing required deployment configuration: " + ", ".join(missing)
            )

        timeout = os.environ.get(
            "PORTAINER_DEPLOY_TIMEOUT_SECONDS",
            str(DEFAULT_DEPLOYMENT_TIMEOUT_SECONDS),
        )
        if not timeout.isdecimal() or int(timeout) <= 0:
            raise DeploymentError("PORTAINER_DEPLOY_TIMEOUT_SECONDS must be positive.")

        config = cls(
            webhook_url=environment["PORTAINER_WEBHOOK_URL"],
            api_url=environment["PORTAINER_API_URL"],
            api_token=environment["PORTAINER_API_TOKEN"],
            stack_id=environment["PORTAINER_STACK_ID"],
            deploy_host=environment["DEPLOY_HOST"],
            deploy_user=environment["DEPLOY_USER"],
            ssh_private_key=environment["DEPLOY_SSH_PRIVATE_KEY"],
            ssh_known_hosts=environment["DEPLOY_SSH_KNOWN_HOSTS"],
            deployment_timeout_seconds=int(timeout),
        )
        config.validate()
        return config

    def validate(self) -> None:
        for name, value in (
            ("PORTAINER_WEBHOOK_URL", self.webhook_url),
            ("PORTAINER_API_URL", self.api_url),
        ):
            parsed = urllib.parse.urlsplit(value)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.fragment
                or parsed.query
            ):
                raise DeploymentError(
                    f"{name} must be an HTTPS URL without credentials or query parameters."
                )

        if not re.fullmatch(r"[0-9]+", self.stack_id):
            raise DeploymentError("PORTAINER_STACK_ID must be numeric.")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", self.deploy_host):
            raise DeploymentError("DEPLOY_HOST must be a DNS name or IPv4 address.")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", self.deploy_user):
            raise DeploymentError("DEPLOY_USER contains unsupported characters.")


class PortainerClient:
    def __init__(self, config: Config, urlopen: Callable = _urlopen_without_redirects):
        self.config = config
        self.urlopen = urlopen
        self.api_url = config.api_url.rstrip("/")

    def _request(self, request: urllib.request.Request) -> tuple[int, bytes]:
        try:
            with self.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise DeploymentError("Portainer request failed due to a network or TLS error.") from error

    def get_stack(self) -> dict:
        request = urllib.request.Request(
            f"{self.api_url}/api/stacks/{self.config.stack_id}",
            headers={"X-API-Key": self.config.api_token},
        )
        status, body = self._request(request)
        if status != 200:
            raise DeploymentError(f"Portainer stack query failed (HTTP {status}).")
        try:
            stack = json.loads(body)
        except (TypeError, ValueError) as error:
            raise DeploymentError("Portainer returned invalid stack data.") from error
        if not isinstance(stack, dict):
            raise DeploymentError("Portainer returned invalid stack data.")
        return stack

    def trigger_webhook(self) -> None:
        request = urllib.request.Request(self.config.webhook_url, method="POST")
        status, _ = self._request(request)
        if status == 409:
            raise DeploymentError(
                "Portainer rejected the webhook with HTTP 409; no cleanup was run."
            )
        if status not in (200, 202, 204):
            raise DeploymentError(
                f"Portainer webhook was not accepted (HTTP {status}); no cleanup was run."
            )
        print(f"Portainer webhook accepted (HTTP {status}).")


def latest_deployment_time(stack: dict) -> int:
    history = stack.get("DeploymentStatus")
    if not isinstance(history, list):
        raise DeploymentError("Portainer stack response has no deployment status history.")
    times = [
        entry["Time"]
        for entry in history
        if isinstance(entry, dict)
        and type(entry.get("Time")) is int
    ]
    return max(times, default=0)


def _deployment_succeeded(stack: dict, baseline_time: int) -> bool:
    history = stack.get("DeploymentStatus")
    if not isinstance(history, list):
        return False
    started = [
        entry["Time"]
        for entry in history
        if isinstance(entry, dict)
        and type(entry.get("Status")) is int
        and entry["Status"] == 3
        and type(entry.get("Time")) is int
        and entry["Time"] > baseline_time
    ]
    completed = [
        entry["Time"]
        for entry in history
        if isinstance(entry, dict)
        and type(entry.get("Status")) is int
        and entry["Status"] == 1
        and type(entry.get("Time")) is int
        and entry["Time"] > baseline_time
    ]
    return (
        type(stack.get("Status")) is int
        and stack["Status"] == 1
        and bool(started)
        and bool(completed)
        and max(completed) >= max(started)
        and bool(history)
        and isinstance(history[-1], dict)
        and type(history[-1].get("Status")) is int
        and history[-1]["Status"] == 1
        and type(history[-1].get("Time")) is int
        and history[-1]["Time"] > baseline_time
    )


def wait_for_success(
    client: PortainerClient,
    baseline_time: int,
    timeout_seconds: int,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    deadline = clock() + timeout_seconds
    while True:
        stack = client.get_stack()
        status = stack.get("Status")
        if type(status) is int and status == 4:
            raise DeploymentError("Portainer reported deployment failure (Status 4).")
        if type(status) is not int or status not in (1, 3):
            raise DeploymentError(
                f"Portainer reported non-success stack status {status!r}; no cleanup was run."
            )
        if _deployment_succeeded(stack, baseline_time):
            print("Portainer confirmed a new deployment completed successfully.")
            return

        remaining = deadline - clock()
        if remaining <= 0:
            raise DeploymentError(
                "Timed out waiting for Portainer to confirm a new successful deployment."
            )
        sleep(min(POLL_INTERVAL_SECONDS, remaining))


def run_host_cleanup(
    config: Config,
    run: Callable = subprocess.run,
    temp_directory: Callable = tempfile.TemporaryDirectory,
) -> None:
    with temp_directory(prefix="rossmoney-deploy-") as directory:
        key_path = Path(directory) / "deploy-key"
        known_hosts_path = Path(directory) / "known-hosts"
        key_path.write_text(config.ssh_private_key, encoding="utf-8")
        known_hosts_path.write_text(config.ssh_known_hosts, encoding="utf-8")
        key_path.chmod(0o600)
        known_hosts_path.chmod(0o600)

        command = [
            "ssh",
            "-T",
            "-i",
            str(key_path),
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            f"UserKnownHostsFile={known_hosts_path}",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "ClearAllForwardings=yes",
            f"{config.deploy_user}@{config.deploy_host}",
        ]
        try:
            run(command, check=True)
        except FileNotFoundError as error:
            raise DeploymentError("SSH client is unavailable on the deployment runner.") from error
        except subprocess.CalledProcessError as error:
            raise DeploymentError(
                f"Host dangling-image cleanup failed (exit status {error.returncode})."
            ) from error
        except OSError as error:
            raise DeploymentError("Could not run host dangling-image cleanup over SSH.") from error


def deploy_and_prune(
    config: Config,
    urlopen: Callable = _urlopen_without_redirects,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    ssh_run: Callable = subprocess.run,
) -> None:
    client = PortainerClient(config, urlopen=urlopen)
    baseline = client.get_stack()
    if type(baseline.get("Status")) is not int or baseline["Status"] != 1:
        raise DeploymentError(
            f"Portainer stack is not Active before deployment (Status {baseline.get('Status')!r})."
        )
    baseline_time = latest_deployment_time(baseline)

    client.trigger_webhook()
    wait_for_success(
        client,
        baseline_time,
        config.deployment_timeout_seconds,
        clock=clock,
        sleep=sleep,
    )

    print("Running host dangling-image cleanup through the restricted SSH key.")
    run_host_cleanup(config, run=ssh_run)
    print("Host dangling-image cleanup completed.")


def main() -> int:
    try:
        config = Config.from_environment()
        deploy_and_prune(config)
    except DeploymentError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
