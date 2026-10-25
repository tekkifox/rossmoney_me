import json
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock

from portainer_image_prune import (
    Config,
    PortainerClient,
    WorkerError,
    confirmed_new_deployment,
    poll_once,
    run_dangling_image_prune,
)


def stack(status, history):
    return {"Status": status, "DeploymentStatus": history}


def response(body, status=200):
    class FakeResponse:
        def __enter__(self):
            self.status = status
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return json.dumps(body).encode()

    return FakeResponse()


class PortainerImagePruneTests(unittest.TestCase):
    def setUp(self):
        self.config = Config(
            api_url="https://portainer.example",
            api_token="not-a-real-token",
            stack_id="12",
        )

    def test_new_deploying_to_active_transition_allows_cleanup(self):
        value = stack(1, [{"Status": 3, "Time": 110}, {"Status": 1, "Time": 111}])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state.json"
            state.write_text('{"last_active_time": 100}', encoding="utf-8")
            prune = Mock()

            poll_once(
                PortainerClient(self.config, urlopen=Mock(return_value=response(value))),
                state_path=state,
                prune=prune,
            )

            prune.assert_called_once_with()
            self.assertEqual(json.loads(state.read_text())["last_active_time"], 111)

    def test_first_start_records_baseline_without_pruning(self):
        value = stack(1, [{"Status": 3, "Time": 110}, {"Status": 1, "Time": 111}])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state.json"
            prune = Mock()

            poll_once(
                PortainerClient(self.config, urlopen=Mock(return_value=response(value))),
                state_path=state,
                prune=prune,
            )

            prune.assert_not_called()
            self.assertEqual(json.loads(state.read_text())["last_active_time"], 111)

    def test_worker_started_during_deployment_cleans_only_after_active(self):
        deploying = stack(3, [{"Status": 3, "Time": 110}])
        active = stack(1, [{"Status": 3, "Time": 110}, {"Status": 1, "Time": 111}])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state.json"
            prune = Mock()
            client = PortainerClient(
                self.config,
                urlopen=Mock(
                    side_effect=[
                        response(deploying),
                        response(active),
                    ]
                ),
            )

            poll_once(client, state_path=state, prune=prune)
            prune.assert_not_called()
            poll_once(client, state_path=state, prune=prune)

            prune.assert_called_once_with()
            self.assertEqual(json.loads(state.read_text())["last_active_time"], 111)

    def test_worker_started_on_failed_deployment_can_observe_later_success(self):
        failed = stack(4, [{"Status": 3, "Time": 110}, {"Status": 4, "Time": 111}])
        active = stack(1, [{"Status": 3, "Time": 120}, {"Status": 1, "Time": 121}])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state.json"
            prune = Mock()
            client = PortainerClient(
                self.config,
                urlopen=Mock(side_effect=[response(failed), response(active)]),
            )

            poll_once(client, state_path=state, prune=prune)
            prune.assert_not_called()
            poll_once(client, state_path=state, prune=prune)

            prune.assert_called_once_with()
            self.assertEqual(json.loads(state.read_text())["last_active_time"], 121)

    def test_non_success_and_stale_status_do_not_prune(self):
        cases = (
            stack(4, [{"Status": 3, "Time": 110}, {"Status": 4, "Time": 111}]),
            stack(3, [{"Status": 3, "Time": 110}]),
            stack(2, [{"Status": 2, "Time": 110}]),
            stack(1, [{"Status": 1, "Time": 100}]),
            stack(1, [{"Status": 3, "Time": 99}, {"Status": 1, "Time": 100}]),
            stack(1, [{"Status": 1, "Time": 111}]),
        )
        for value in cases:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / "state.json"
                state.write_text('{"last_active_time": 100}', encoding="utf-8")
                prune = Mock()
                poll_once(
                    PortainerClient(self.config, urlopen=Mock(return_value=response(value))),
                    state_path=state,
                    prune=prune,
                )
                prune.assert_not_called()

    def test_failed_prune_does_not_advance_state(self):
        value = stack(1, [{"Status": 3, "Time": 110}, {"Status": 1, "Time": 111}])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state.json"
            state.write_text('{"last_active_time": 100}', encoding="utf-8")
            prune = Mock(side_effect=WorkerError("cleanup failed"))

            with self.assertRaisesRegex(WorkerError, "cleanup failed"):
                poll_once(
                    PortainerClient(self.config, urlopen=Mock(return_value=response(value))),
                    state_path=state,
                    prune=prune,
                )

            self.assertEqual(json.loads(state.read_text())["last_active_time"], 100)

    def test_cleanup_is_exact_dangling_image_prune(self):
        run = Mock()
        run_dangling_image_prune(run=run)
        run.assert_called_once_with(
            ["/usr/bin/docker", "image", "prune", "-f"], check=True
        )

    def test_cleanup_failure_is_reported(self):
        run = Mock(side_effect=subprocess.CalledProcessError(1, "docker"))
        with self.assertRaisesRegex(WorkerError, "exit status 1"):
            run_dangling_image_prune(run=run)

    def test_api_errors_are_not_treated_as_success(self):
        opener = Mock(side_effect=urllib.error.HTTPError("https://portainer", 503, "error", {}, None))
        client = PortainerClient(self.config, urlopen=opener)
        with self.assertRaisesRegex(WorkerError, "HTTP 503"):
            client.get_stack()

    def test_config_rejects_http_and_invalid_stack_id(self):
        with self.assertRaisesRegex(WorkerError, "HTTPS"):
            Config("http://portainer.example", "token", "12").validate()
        with self.assertRaisesRegex(WorkerError, "numeric"):
            Config("https://portainer.example", "token", "12;id").validate()


if __name__ == "__main__":
    unittest.main()
