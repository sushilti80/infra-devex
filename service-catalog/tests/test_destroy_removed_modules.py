import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).parents[1]
    / ".pipelines/infrastructure/deploy/destroy_removed_modules.sh"
)


@unittest.skipUnless(shutil.which("git") and shutil.which("jq"), "git and jq required")
class DestroyRemovedModulesTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.repository = self.root / "repository"
        self.repository.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repository, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=self.repository,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"], cwd=self.repository, check=True
        )

        environment = self.repository / "infrastructure/testapp/devsand"
        for module in ("resourcegroups", "storagev2"):
            module_path = environment / module
            module_path.mkdir(parents=True)
            (module_path / "terragrunt.hcl").write_text(
                "terraform {}\n", encoding="utf-8"
            )
        subprocess.run(["git", "add", "."], cwd=self.repository, check=True)
        subprocess.run(["git", "commit", "-qm", "source"], cwd=self.repository, check=True)
        self.source_commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=self.repository, text=True
        ).strip()
        shutil.rmtree(environment / "storagev2")

        self.request_path = Path(
            "infrastructure/testapp/devsand/.module-removals/12345.json"
        )
        request_file = self.repository / self.request_path
        request_file.parent.mkdir()
        self.request = {
            "version": 1,
            "project": "testapp",
            "environment": "devsand",
            "source_commit": self.source_commit,
            "removed_modules": ["storagev2"],
            "correlation_id": "cid-123",
        }
        request_file.write_text(json.dumps(self.request), encoding="utf-8")
        self.request_list = self.root / "requests.txt"
        self.request_list.write_text(f"{self.request_path}\n", encoding="utf-8")

        self.bin_directory = self.root / "bin"
        self.bin_directory.mkdir()
        self.terragrunt_log = self.root / "terragrunt.log"
        fake_terragrunt = self.bin_directory / "terragrunt"
        fake_terragrunt.write_text(
            '#!/bin/sh\n'
            'if [ "$1" = "run" ] && [ "$2" = "--help" ]; then\n'
            '  echo "--queue-include-dir"\n'
            "  exit 0\n"
            "fi\n"
            'printf "%s\\n" "$PWD" "$*" >> "$TERRAGRUNT_LOG"\n',
            encoding="utf-8",
        )
        fake_terragrunt.chmod(fake_terragrunt.stat().st_mode | stat.S_IXUSR)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def run_script(self):
        environment = os.environ.copy()
        environment["PATH"] = f"{self.bin_directory}:{environment['PATH']}"
        environment["TERRAGRUNT_LOG"] = str(self.terragrunt_log)
        return subprocess.run(
            ["bash", str(SCRIPT), str(self.request_list), str(self.repository)],
            text=True,
            capture_output=True,
            env=environment,
        )

    def test_targets_only_manifest_modules_from_source_commit(self):
        result = self.run_script()

        self.assertEqual(0, result.returncode, result.stderr)
        log_lines = self.terragrunt_log.read_text(encoding="utf-8").splitlines()
        self.assertTrue(log_lines[0].endswith("/infrastructure/testapp/devsand"))
        self.assertEqual(
            "run --all --non-interactive --parallelism 1 --queue-strict-include "
            "--queue-include-dir ./storagev2 -- destroy -lock=false",
            log_lines[1],
        )
        self.assertEqual([], list(self.repository.parent.glob("module-destroy.*")))

    def test_rejects_protected_resourcegroups_module(self):
        self.request["removed_modules"] = ["resourcegroups"]
        (self.repository / self.request_path).write_text(
            json.dumps(self.request), encoding="utf-8"
        )

        result = self.run_script()

        self.assertNotEqual(0, result.returncode)
        self.assertIn("Invalid removed module", result.stderr)
        self.assertFalse(self.terragrunt_log.exists())


if __name__ == "__main__":
    unittest.main()
