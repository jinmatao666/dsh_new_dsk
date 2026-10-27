import os
import unittest
from unittest import mock

import deployment


class DeploymentTests(unittest.TestCase):
    def test_ready_requires_core_configuration(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(deployment.ready())
        with mock.patch.dict(os.environ, {
            "EXPERT_PUBLIC_URL": "https://gis.zjugis.com",
            "EXPERT_PLATFORM_REDEEM_URL": "https://platform.zjugis.com/api/expert-web/redeem",
            "EXPERT_PROVIDER_CREDENTIAL": "secret-value",
        }, clear=True):
            with mock.patch.object(deployment.shutil, "which", return_value="/usr/bin/ogr2ogr"):
                self.assertTrue(deployment.ready())


if __name__ == "__main__":
    unittest.main()
