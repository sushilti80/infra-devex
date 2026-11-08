import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import resolve_vault


class ResolverExpressions(unittest.TestCase):
    def test_shared_vault_name_expression(self) -> None:
        expression = (
            'contains(["shared"], "${local.envName}") '
            '? "example-shared-services-kv-1" '
            ': "example-${local.spokeEnv}-kv-${local.region}-${local.kvintsuffix}"'
        )
        config = object.__new__(resolve_vault.HclConfig)
        config.local = lambda name: "shared"

        result = config._eval_node(resolve_vault._Parser(expression).parse())

        self.assertEqual(result, "example-shared-services-kv-1")

    def test_contains_empty_list(self) -> None:
        self.assertFalse(resolve_vault._pure_function("contains", [[], "shared"]))


if __name__ == "__main__":
    unittest.main()
