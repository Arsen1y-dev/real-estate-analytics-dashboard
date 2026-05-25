"""Минимальные тесты логики восстановления сессии Chrome (без Selenium)."""
import unittest

from yandex_realty_details_parser import is_dead_browser_session_error


class TestDeadSessionDetection(unittest.TestCase):
    def test_no_such_window(self):
        exc = Exception(
            "Message: no such window: target window already closed\n"
            "from unknown error: web view not found"
        )
        self.assertTrue(is_dead_browser_session_error(exc))

    def test_invalid_session_id(self):
        self.assertTrue(is_dead_browser_session_error(Exception("invalid session id")))

    def test_unrelated_error(self):
        self.assertFalse(is_dead_browser_session_error(Exception("timeout")))

    def test_timeout_not_dead_session(self):
        self.assertFalse(
            is_dead_browser_session_error(Exception("element click intercepted"))
        )


if __name__ == "__main__":
    unittest.main()
