import unittest

from pipeline.etl import sanitize_address


class TestAddressValidation(unittest.TestCase):
    def test_rejects_coordinate_pair(self) -> None:
        self.assertEqual(sanitize_address("51.60025,46.0232624"), "")

    def test_rejects_numeric_only(self) -> None:
        self.assertEqual(sanitize_address("12345"), "")

    def test_keeps_human_readable_address(self) -> None:
        self.assertEqual(
            sanitize_address("Саратов, 2-й Овсяной проезд, 20"),
            "Саратов, 2-й Овсяной проезд, 20",
        )

    def test_rejects_service_no_address_phrase(self) -> None:
        self.assertEqual(sanitize_address("Адрес: не указан"), "")

    def test_rejects_address_url(self) -> None:
        self.assertEqual(sanitize_address("https://example.com/address"), "")


if __name__ == "__main__":
    unittest.main()
