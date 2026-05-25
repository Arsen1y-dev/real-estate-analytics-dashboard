"""Unit-тесты детектора капчи (без Selenium)."""

import unittest

from yandex_realty_details_parser import (
    page_title_indicates_captcha,
    should_treat_as_captcha_page,
    url_indicates_captcha_page,
)


class TestCaptchaUrlAndTitle(unittest.TestCase):
    def test_offer_url_not_captcha(self):
        url = "https://realty.yandex.ru/offer/2467402442498752690/"
        self.assertFalse(url_indicates_captcha_page(url))

    def test_smartcaptcha_url(self):
        self.assertTrue(
            url_indicates_captcha_page(
                "https://yandex.ru/showcaptcha?cc=1&retpath=https%3A%2F%2Frealty.yandex.ru"
            )
        )

    def test_captcha_title(self):
        self.assertTrue(
            page_title_indicates_captcha("Подтвердите, что запросы отправляли вы, а не робот")
        )


class TestShouldTreatAsCaptcha(unittest.TestCase):
    def test_offer_card_on_normal_url_not_captcha(self):
        self.assertFalse(
            should_treat_as_captcha_page(
                url="https://realty.yandex.ru/offer/2467402442498752690/",
                page_title="Москва, ул. Пример — id 123",
                offer_card_present=True,
                visible_captcha_marker=False,
            )
        )

    def test_hidden_iframe_marker_ignored_with_offer_card(self):
        """Ложное срабатывание: captcha в DOM, но карточка уже загружена."""
        self.assertFalse(
            should_treat_as_captcha_page(
                url="https://realty.yandex.ru/offer/2467402442498752690/",
                offer_card_present=True,
                visible_captcha_marker=True,
            )
        )

    def test_real_captcha_without_offer(self):
        self.assertTrue(
            should_treat_as_captcha_page(
                url="https://yandex.ru/showcaptcha?retpath=...",
                offer_card_present=False,
                visible_captcha_marker=True,
            )
        )

    def test_robot_word_in_title_only_with_captcha_page(self):
        self.assertTrue(
            should_treat_as_captcha_page(
                url="https://realty.yandex.ru/offer/1/",
                page_title="Я не робот",
                offer_card_present=False,
                visible_captcha_marker=False,
            )
        )


if __name__ == "__main__":
    unittest.main()
