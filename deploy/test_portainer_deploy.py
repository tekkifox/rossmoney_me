import json
import subprocess
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock

from portainer_deploy import (
    Config,
    DeploymentError,
    deploy_and_prune,
    run_host_cleanup,
)


def response(status, body=b""):
    class FakeResponse:
        def __enter__(self):
            self.status = status
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return body

    return FakeResponse()


def stack(status, history):
    return json.dumps({"Status": status, "DeploymentStatus": history}).encode()


class PortainerDeployTests(unittest.TestCase):
    def setUp(self):
        self.config = Config(
            webhook_url="https://portainer.example/api/stacks/webhooks/token",
            api_url="https://portainer.example",
            api_token="not-a-real-token",
            stack_id="12",
            deploy_host="host.example",
            deploy_user="rossmoney-prune",
            ssh_private_key="private-key",
            ssh_known_hosts="host.example ssh-ed25519 host-key",
            deployment_timeout_seconds=60,
        )

    def test_prunes_only_after_a_new_deployment_is_active(self):
        baseline = stack(1, [{"Status": 1, "Time": 100}])
        deploying = stack(3, [{"Status": 3, "Time": 110}])
        active = stack(
            1,
            [{"Status": 3, "Time": 110}, {"Status": 1, "Time": 111}],
        )
        http = Mock(
            side_effect=[
                response(200, baseline),
                response(204),
                response(200, deploying),
                response(200, active),
            ]
        )
        ssh = Mock()

        deploy_and_prune(
            self.config,
            urlopen=http,
            clock=Mock(side_effect=[0, 0, 1]),
            sleep=Mock(),
            ssh_run=ssh,
        )

        self.assertEqual(http.call_count, 4)
        ssh.assert_called_once()
        command = ssh.call_args.args[0]
        self.assertEqual(command[0], "ssh")
        self.assertEqual(command[-1], "rossmoney-prune@host.example")
        self.assertNotIn("docker", command)
        self.assertTrue(command[1:2] == ["-T"])

    def test_rejected_webhook_never_prunes(self):
        baseline = stack(1, [{"Status": 1, "Time": 100}])

        def http(request, timeout):
            if request.get_method() == "GET":
                return response(200, baseline)
            raise urllib.error.HTTPError(
                request.full_url, 409, "Conflict", {}, None
            )

        ssh = Mock()
        with self.assertRaisesRegex(DeploymentError, "HTTP 409"):
            deploy_and_prune(self.config, urlopen=http, ssh_run=ssh)
        ssh.assert_not_called()

    def test_portainer_deployment_error_never_prunes(self):
        baseline = stack(1, [{"Status": 1, "Time": 100}])
        failed = stack(4, [{"Status": 3, "Time": 110}, {"Status": 4, "Time": 111}])
        http = Mock(
            side_effect=[
                response(200, baseline),
                response(202),
                response(200, failed),
            ]
        )
        ssh = Mock()

        with self.assertRaisesRegex(DeploymentError, "deployment failure"):
            deploy_and_prune(self.config, urlopen=http, ssh_run=ssh)
        ssh.assert_not_called()

    def test_old_active_status_does_not_count_as_success(self):
        baseline = stack(1, [{"Status": 1, "Time": 100}])
        http = Mock(
            side_effect=[
                response(200, baseline),
                response(204),
                response(200, baseline),
                response(200, baseline),
            ]
        )
        ssh = Mock()

        with self.assertRaisesRegex(DeploymentError, "Timed out"):
            deploy_and_prune(
                self.config,
                urlopen=http,
                clock=Mock(side_effect=[0, 0, 60]),
                sleep=Mock(),
                ssh_run=ssh,
            )
        ssh.assert_not_called()

    def test_cleanup_failure_is_reported(self):
        ssh = Mock(side_effect=subprocess.CalledProcessError(1, "ssh"))
        with self.assertRaisesRegex(DeploymentError, "exit status 1"):
            run_host_cleanup(self.config, run=ssh)
        command = ssh.call_args.args[0]
        self.assertEqual(command[-1], "rossmoney-prune@host.example")
        self.assertFalse(any("private-key" in part for part in command))

    def test_host_runner_is_limited_to_default_dangling_prune(self):
        runner = Path(__file__).with_name("prune-dangling-images").read_text()
        self.assertIn("/usr/bin/docker image prune -f", runner)
        self.assertNotIn("image prune -a", runner)
        self.assertNotIn("system prune", runner)

    def test_config_requires_https_and_numeric_stack_id(self):
        with self.assertRaisesRegex(DeploymentError, "HTTPS"):
            Config(**{**self.config.__dict__, "api_url": "http://portainer.example"}).validate()
        with self.assertRaisesRegex(DeploymentError, "numeric"):
            Config(**{**self.config.__dict__, "stack_id": "12;whoami"}).validate()


if __name__ == "__main__":
    unittest.main()
