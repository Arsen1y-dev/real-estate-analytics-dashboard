"""Тесты пресетов config."""
import unittest

from pipeline.config_presets import PRESETS, apply_preset


class TestConfigPresets(unittest.TestCase):
    def test_fast_merges_and_overrides(self):
        raw = apply_preset(
            {
                "preset": "fast",
                "delay_between_listings_min": 2,
            }
        )
        self.assertEqual(raw["preset"], "fast")
        self.assertTrue(raw["block_images"])
        self.assertEqual(raw["delay_between_listings_min"], 2)
        self.assertEqual(raw["delay_between_listings_max"], PRESETS["fast"]["delay_between_listings_max"])

    def test_unknown_preset_raises(self):
        with self.assertRaises(ValueError):
            apply_preset({"preset": "turbo"})


if __name__ == "__main__":
    unittest.main()
