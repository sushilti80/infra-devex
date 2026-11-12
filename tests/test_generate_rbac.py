import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / ".github/workflows/scripts/generate_rbac.sh"


class GenerateRbacTests(unittest.TestCase):
    def test_empty_relationships_clear_generated_rbac_state(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository = Path(temporary_directory)
            target = repository / "infrastructure/testapp/devsand/rbac/terragrunt.hcl"
            target.parent.mkdir(parents=True)
            target.write_text(
                'terraform { source = "example" }\n\n'
                '# --- RBAC DEPS: BEGIN AUTO-GENERATED - DO NOT EDIT ---\n'
                'dependency "keyvault" { config_path = "../keyvault" }\n'
                '# --- RBAC DEPS: END AUTO-GENERATED ---\n\n'
                'generate "rbac_inputs" {\n'
                '  path = "rbac.auto.tfvars.json"\n'
                '  contents = jsonencode({ roleAssignment = [{ stale = true }] })\n'
                '}\n',
                encoding="utf-8",
            )

            result = subprocess.run(
                ["bash", str(SCRIPT), "testapp", "devsand", ""],
                cwd=repository,
                text=True,
                capture_output=True,
            )

            self.assertEqual(0, result.returncode, result.stderr)
            generated = target.read_text(encoding="utf-8")
            self.assertNotIn('dependency "keyvault"', generated)
            self.assertNotIn("stale = true", generated)
            self.assertIn("roleAssignment = [\n    ]", generated)


if __name__ == "__main__":
    unittest.main()
