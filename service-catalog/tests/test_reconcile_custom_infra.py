import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / ".github/workflows/scripts/reconcile_custom_infra.py"
SPEC = importlib.util.spec_from_file_location("reconcile_custom_infra", SCRIPT)
reconcile_custom_infra = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(reconcile_custom_infra)


class ReconcileCustomInfraTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repository = Path(self.temporary_directory.name)
        self.environment = self.repository / "infrastructure/testapp/devsand"
        self.environment.mkdir(parents=True)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def create_module(self, name):
        module = self.environment / name
        module.mkdir()
        (module / "terragrunt.hcl").write_text("terraform {}\n", encoding="utf-8")

    def reconcile(self, modules):
        return reconcile_custom_infra.reconcile(
            self.repository,
            "TestApp",
            "DevSand",
            modules,
            "a" * 40,
            "12345",
            "cid-123",
        )

    def test_removes_only_absent_managed_modules_and_writes_request(self):
        for module in ("resourcegroups", "storagev2", "keyvault", "rbac"):
            self.create_module(module)
        (self.environment / "notes").mkdir()

        removed, request_path = self.reconcile("KeyVault,RBAC")

        self.assertEqual(["storagev2"], removed)
        self.assertFalse((self.environment / "storagev2").exists())
        self.assertTrue((self.environment / "resourcegroups").exists())
        self.assertTrue((self.environment / "notes").exists())
        self.assertEqual(
            {
                "version": 1,
                "project": "testapp",
                "environment": "devsand",
                "source_commit": "a" * 40,
                "removed_modules": ["storagev2"],
                "correlation_id": "cid-123",
            },
            json.loads(request_path.read_text(encoding="utf-8")),
        )

    def test_preserves_multiple_desired_instances_and_is_noop(self):
        for module in ("resourcegroups", "appservicelinux-api", "appservicelinux-web"):
            self.create_module(module)

        removed, request_path = self.reconcile(
            "appServiceLinux-API, appservicelinux-web,appservicelinux-api"
        )

        self.assertEqual([], removed)
        self.assertIsNone(request_path)
        self.assertFalse((self.environment / ".module-removals").exists())

    def test_protects_resourcegroups_when_optional_modules_are_empty(self):
        self.create_module("resourcegroups")
        self.create_module("rbac")

        removed, _ = self.reconcile("")

        self.assertEqual(["rbac"], removed)
        self.assertTrue((self.environment / "resourcegroups").exists())

    def test_rejects_unsafe_names(self):
        self.create_module("resourcegroups")

        with self.assertRaisesRegex(ValueError, "Invalid module"):
            self.reconcile("../storagev2")
        with self.assertRaisesRegex(ValueError, "Invalid project"):
            reconcile_custom_infra.reconcile(
                self.repository,
                "../app",
                "devsand",
                "",
                "a" * 40,
                "12345",
                "none",
            )

    def test_writes_github_outputs(self):
        output_path = self.repository / "github-output"
        request_path = self.environment / ".module-removals/12345.json"

        reconcile_custom_infra.write_github_output(
            output_path, ["rbac", "storagev2"], request_path
        )

        self.assertEqual(
            "removed_modules=rbac,storagev2\n"
            f"removal_request={request_path}\n",
            output_path.read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
