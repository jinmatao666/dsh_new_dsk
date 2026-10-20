"""Offline checks for gateway route insertion; no Docker or live configuration is changed."""
import importlib.util
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('gateway_patch', Path(__file__).with_name('patch-gateway.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
snippet = Path(__file__).with_name('gateway-tunnel.location.conf').read_text(encoding='utf-8')


class GatewayTests(unittest.TestCase):
    def test_only_named_server_changes_and_repeated_apply_is_idempotent(self):
        default = 'server { listen 3300 default_server; server_name _; return 444; }'
        expert = 'location /experts/ { proxy_pass http://127.0.0.1:3301; }'
        source = f'http {{ {default} server {{ listen 3300; server_name ac.zjugis.com; {expert} }} }}'
        result = module.patch(source, snippet, 'ac.zjugis.com', 3300)
        self.assertIn(default, result)
        self.assertIn(expert, result)
        self.assertEqual(result.count('location = /api/desktop-resources/tunnel'), 1)
        self.assertEqual(module.patch(result, snippet, 'ac.zjugis.com', 3300), result)

    def test_comments_and_quoted_braces_do_not_change_block_matching(self):
        source = 'http { # server {\nserver { listen 3300; server_name ac.zjugis.com; set $x "}"; } }'
        self.assertIn(snippet.rstrip(), module.patch(source, snippet, 'ac.zjugis.com', 3300))

    def test_unknown_or_duplicate_server_and_unowned_route_rejected(self):
        block = 'server { listen 3300; server_name ac.zjugis.com; }'
        for source in ('http {}', 'http {' + block + block + '}', block + '# /api/desktop-resources/tunnel'):
            with self.assertRaises(ValueError):
                module.patch(source, snippet, 'ac.zjugis.com', 3300)


if __name__ == '__main__':
    unittest.main(verbosity=2)
