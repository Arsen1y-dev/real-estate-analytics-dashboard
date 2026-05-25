#!/usr/bin/env python3
"""
Парсер детальной информации о квартирах с Яндекс.Недвижимость
Собирает данные о квартирах по ссылкам и сохраняет в CSV
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from pipeline.chrome_driver import create_chrome_driver, chromedriver_startup_hint
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import WebDriverException
import time
import os
import random
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# Порядок колонок details CSV (ETL читает подмножество; лишние поля — для аудита/расширения)
DETAILS_FIELD_ORDER = [
    "Название", "Заголовок карточки", "Класс жилья", "Тип объявления", "Цена", "Цена за метр", "Адрес", "Дата публикации",
    "Продавец", "Тип продавца", "ID объявления", "Количество комнат",
    "Общая площадь", "Жилая площадь", "Площадь кухни", "Площади комнат",
    "Этаж", "Этажей в доме", "Высота потолков", "Санузел", "Балкон или лоджия",
    "Окна", "Удобства", "Ремонт",
    "Тёплый пол", "Мебель", "Техника", "Отделка", "Тип дома", "Год постройки",
    "Серия дома", "Квартир в доме", "Отопление",
    "Пассажирский лифт", "Грузовой лифт", "Мусоропровод", "Двор", "Парковка",
    "Название новостройки", "Корпус, строение", "Застройщик", "Тип проекта",
    "Подъезды", "Охрана", "Вид сделки", "Способ продажи", "Тип участия",
    "Срок сдачи", "Дополнительно", "Геолокация", "Ссылка",
]

ADDRESS_REJECT_PHRASES = (
    "экспозиц", "в экспозиции", "просмотр", "обновлено", "средняя цена",
    "дней", "дня на", "дня.", "км ", "мин.", "пешком", "ж/д ст",
    "купить квартиру", "купить апартамент", "в новостройке", "в монолитном",
)

ADDRESS_STREET_MARKERS = (
    "ул.", "улица", "проспект", "пр-т", "пр.", "проезд", "шоссе",
    "переулок", "наб.", "набережная", "бульвар", "б-р", "пл.", "площадь",
    "аллея", "линия", "микрорайон", "квартал", "наб ",
)
ADDRESS_CITY_MARKERS = ("г.", "город", "р-н", "район", "пос.", "поселок", "с.", "дер.")
_ADDRESS_COORD_PAIR_RE = re.compile(r"^\s*[+-]?\d+(?:[.,]\d+)?\s*,\s*[+-]?\d+(?:[.,]\d+)?\s*$")
_ADDRESS_INVALID_EXACT = {"", "nan", "none", "null", "undefined", "n/a", "na", "-", "—"}

_MONTH_WORD = (
    r"январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр"
)
_PUBLICATION_DATE_RE = re.compile(
    rf"(\d{{1,2}}(?:\s|\u00a0|&nbsp;)+{_MONTH_WORD}\w*(?:\s+\d{{4}})?)\s*,\s*(\d+)\s*просмотр",
    re.I,
)

# Текст футера/навигации — не подставлять в поля карточки
FOOTER_POLLUTION_PHRASES = (
    "вся недвижимость", "реклама", "пользовательское соглашение", "политика конфиденциальности",
    "снять посуточно", "снять квартиру", "люди также ищут", "показать телефон",
    "позвоните мне", "журнал", "фан фан фан", "учебник", "новости", "аренда",
    "как polka", "я так живу", "идеи", "истории", "предложения рядом",
    "похожие объявления", "под ваш бюджет", "скачать pdf", "ещё\n", "ещё ",
    "добавить заметку",
)

# Кнопки/подписи сайдбара контакта — не подставлять в «Продавец»
SELLER_UI_POLLUTION_PHRASES = (
    "добавить заметку", "показать телефон", "написать", "позвонить",
    "заказать звонок", "чат с агентом", "на яндекс карты",
)

_SELLER_JSON_CATEGORY_MAP = {
    "AGENCY": "Агентство",
    "AGENT": "Агент",
    "OWNER": "Собственник",
    "DEVELOPER": "Застройщик",
}

# Бейджи сегмента у заголовка (Элитный, Комфорт, Бизнес, …)
_HOUSING_CLASS_RE = re.compile(
    r"^(элитн\w*|комфорт\w*|бизнес[\s-]*класс\w*|эконом\w*|премиум\w*|стандарт\w*)$",
    re.I,
)

# «Срок сдачи 3 кв. 2027» / «3 кв. 2027 г.»
_COMPLETION_TERM_RE = re.compile(
    r"(?:срок\s+сдачи\s+)?(\d+\s*кв\.?\s*\d{4}(?:\s*г\.?)?)",
    re.I,
)

# Чипы блока «О доме» (OfferCardFeature) → поле details (порядок важен: более специфичные раньше)
_DEAD_SESSION_MARKERS = (
    "no such window",
    "target window already closed",
    "web view not found",
    "invalid session id",
)


def is_dead_browser_session_error(exc: BaseException) -> bool:
    """True, если WebDriver потерял окно/сессию (закрыли Chrome, Ctrl+C на капче, вариант 2)."""
    msg = str(exc).lower()
    return any(m in msg for m in _DEAD_SESSION_MARKERS)


_CAPTCHA_URL_MARKERS = (
    "smartcaptcha",
    "showcaptcha",
    "/checkcaptcha",
    "captcha.yandex",
)
_CAPTCHA_TITLE_MARKERS = (
    "подтвердите, что запросы",
    "подтвердите что вы",
    "я не робот",
    "smartcaptcha",
)
_CAPTCHA_VISIBLE_CLASS_XPATHS = (
    "//*[contains(@class,'CheckboxCaptcha')]",
    "//div[contains(@class,'SmartCaptcha')]",
    "//div[contains(@class,'AdvancedCaptcha')]",
    "//iframe[contains(@src,'smartcaptcha')]",
)
_CAPTCHA_VISIBLE_TEXT_XPATHS = (
    "//*[contains(text(), 'Подтвердите, что запросы')]",
    "//*[contains(text(), 'Подтвердите что вы')]",
    "//*[contains(text(), 'Я не робот')]",
)


def url_indicates_captcha_page(url: str) -> bool:
    """URL страницы SmartCaptcha / checkcaptcha (не offer)."""
    u = (url or "").lower()
    return any(m in u for m in _CAPTCHA_URL_MARKERS)


def page_title_indicates_captcha(page_title: str) -> bool:
    t = (page_title or "").lower()
    return any(m in t for m in _CAPTCHA_TITLE_MARKERS)


def should_treat_as_captcha_page(
    *,
    url: str = "",
    page_title: str = "",
    offer_card_present: bool = False,
    visible_captcha_marker: bool = False,
) -> bool:
    """
    Чистая логика детектора (для unit-тестов без Selenium).
    Карточка OfferCard на нормальном /offer/ — не капча, даже если в DOM есть скрытые iframe.
    """
    if offer_card_present and not url_indicates_captcha_page(url):
        return False
    if url_indicates_captcha_page(url):
        return True
    if page_title_indicates_captcha(page_title):
        return True
    return visible_captcha_marker


# Чипы удобств квартиры (не блок «О доме»)
_AMENITY_CHIP_KEYWORDS = (
    "интернет", "мебель", "холодильник", "кондиционер", "стиральн", "посудомо",
    "телевизор", "ванна", "душ", "тёплый пол", "теплый пол",
)

# Бейджи сегмента сделки у заголовка (точное совпадение или префикс)
_DEAL_BADGE_RULES: tuple[tuple[str, str], ...] = (
    (r"^альтернатив", "альтернатива"),
    (r"переуступк", "переуступка"),
    (r"вторичн\w+\s+продаж", "вторичная продажа"),
    (r"первичн\w+\s+продаж", "первичная продажа"),
    (r"цена\s+от\s+застройщика", "первичная продажа"),
)

_ABOUT_HOUSE_FEATURE_RULES: tuple[tuple[str, str, object], ...] = (
    (r"^лифт$", "Пассажирский лифт", lambda _v: "да"),
    (r"мусоропровод\w*\s+нет|мусоропровод\w*\s+отсутств", "Мусоропровод", lambda _v: "нет"),
    (r"мусоропровод", "Мусоропровод", lambda _v: "да"),
    (r"охрана\s*/\s*консьерж|охрана", "Охрана", None),
    (r"закрыт\w*\s+территор\w*\s+нет", "Двор", lambda _v: "Закрытой территории нет"),
    (r"закрыт\w*\s+территор", "Двор", None),
    (r"отоплен", "Отопление", None),
    (r"кирпично[-\s]*монолитн\w+\s+здани\w*|монолитн\w+\s+здани\w*|кирпичн\w+\s+дом\w*|панельн\w+\s+дом\w*|блочн\w+\s+дом\w*",
     "Тип дома", None),
    (r"подземн\w+\s+парковк\w*|закрыт\w+\s+парковк\w*|открыт\w+\s+парковк\w*",
     "Парковка", None),
    (r"индивидуальный\s+проект|типовой\s+проект", "Тип проекта", None),
)


def is_polluted_text(text: str) -> bool:
    """Отсекает футер, SEO-ссылки и прочий мусор страницы."""
    if not text:
        return False
    low = re.sub(r"\s+", " ", text.lower()).strip()
    if len(low) > 180 and any(
        x in low for x in ("купить квартиру", "предложений", "недвижимость", "ипотеку")
    ):
        return True
    return any(p in low for p in FOOTER_POLLUTION_PHRASES)


def is_seller_polluted_text(text: str) -> bool:
    """UI сайдбара (заметка, телефон) и общий мусор — не имя продавца."""
    if not text:
        return True
    if is_polluted_text(text):
        return True
    low = re.sub(r"\s+", " ", text.lower()).strip()
    return any(p in low for p in SELLER_UI_POLLUTION_PHRASES)


class YandexRealtyDetailsParser:
    def __init__(
        self,
        use_proxy=False,
        proxy_url=None,
        headless=True,
        max_links=None,
        delay_between_listings_min=5,
        delay_between_listings_max=12,
        delay_after_page_load_min=4,
        delay_after_page_load_max=8,
        resume_after_captcha=True,
        max_links_per_session=None,
        block_images=False,
        request_delays_ms=None,
        target_listings=None,
        initial_successful_count=0,
        min_delay_ms=1200,
        max_delay_ms=2800,
        captcha_auto_wait_seconds=120,
    ):
        self.use_proxy = use_proxy
        self.proxy_url = proxy_url
        self.headless = headless
        self.max_links = max_links
        self.delay_between_listings_min = delay_between_listings_min
        self.delay_between_listings_max = delay_between_listings_max
        self.delay_after_page_load_min = delay_after_page_load_min
        self.delay_after_page_load_max = delay_after_page_load_max
        self.resume_after_captcha = resume_after_captcha
        self.max_links_per_session = max_links_per_session
        self.block_images = block_images
        self.request_delays_ms = request_delays_ms or {}
        self.target_listings = target_listings if target_listings and target_listings > 0 else None
        self.initial_successful_count = max(0, int(initial_successful_count))
        self.min_delay_ms = max(0, int(min_delay_ms))
        self.max_delay_ms = max(self.min_delay_ms, int(max_delay_ms))
        self.captcha_auto_wait_seconds = max(10, int(captcha_auto_wait_seconds))
        self.interactive = sys.stdin.isatty()
        self.on_checkpoint = None
        self.on_row_saved = None
        self.on_status_update = None
        self.should_resume = lambda: False
        self.driver = None
        self.stop_requested = False
        self._captcha_solved_once = False
        self._session_parsed_count = 0
        self.links_file = "yandex_realty_links.txt"
        self.output_file = "yandex_realty_details.csv"
        self.stats_file = "details_parsing_stats.json"
        
    def get_driver(self):
        """Создаёт и настраивает драйвер браузера"""
        options = webdriver.ChromeOptions()
        
        if self.headless:
            options.add_argument("--headless")
        
        # Основные настройки для обхода детекции
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-extensions")
        
        # Настройки User-Agent и заголовков
        user_agents = [
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ]
        options.add_argument(f"--user-agent={random.choice(user_agents)}")
        options.add_argument("--accept-language=ru-RU,ru;q=0.9,en;q=0.8")
        options.add_argument("--accept=text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        
        # Отключение автоматизации
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option('useAutomationExtension', False)

        if self.block_images:
            options.add_experimental_option(
                "prefs",
                {
                    "profile.managed_default_content_settings.images": 2,
                    "profile.default_content_setting_values.images": 2,
                },
            )
            print("⚡ Chrome: загрузка изображений отключена (preset fast / block_images)")

        # Дополнительные настройки
        options.add_argument("--disable-web-security")
        options.add_argument("--allow-running-insecure-content")
        options.add_argument("--disable-features=VizDisplayCompositor")
        options.add_argument("--disable-background-timer-throttling")
        options.add_argument("--disable-backgrounding-occluded-windows")
        options.add_argument("--disable-renderer-backgrounding")
        
        # Добавление прокси
        if self.use_proxy and self.proxy_url:
            options.add_argument(f'--proxy-server={self.proxy_url}')
            print(f"🔗 Используется прокси: {self.proxy_url}")
        
        # Создание драйвера (retry + очистка ~/.wdm при SIGKILL / exit -9)
        self.driver = create_chrome_driver(options)
        
        # Удаление признаков автоматизации
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        # Эмуляция человеческого поведения
        self.driver.execute_script("""
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['ru-RU', 'ru', 'en']
            });
            Object.defineProperty(navigator, 'platform', {
                get: () => 'MacIntel'
            });
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8
            });
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8
            });
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: '4g',
                    rtt: 50,
                    downlink: 10
                })
            });
        """)
        
        return self.driver

    def _safe_quit_driver(self) -> None:
        if not self.driver:
            return
        try:
            self.driver.quit()
        except Exception:
            pass
        finally:
            self.driver = None

    def _driver_is_alive(self) -> bool:
        if not self.driver:
            return False
        try:
            handles = self.driver.window_handles
            return bool(handles)
        except WebDriverException as e:
            if is_dead_browser_session_error(e):
                return False
            raise
        except Exception:
            return False

    def recreate_driver(self, reason: str = "") -> None:
        """Закрывает мёртвую сессию и поднимает новый Chrome."""
        if reason:
            print(f"🔄 Перезапуск Chrome: {reason}")
        self._safe_quit_driver()
        self.driver = self.get_driver()
        print("🌐 Браузер перезапущен")

    def ensure_driver_alive(self, reason: str = "") -> bool:
        """Проверяет окно Chrome; при закрытой сессии — quit + новый драйвер."""
        if self._driver_is_alive():
            return True
        try:
            self.recreate_driver(reason or "сессия браузера недоступна")
            return True
        except Exception as e:
            print(f"❌ Не удалось восстановить браузер: {e}")
            return False
    
    def random_delay(self, min_seconds=2, max_seconds=5):
        """Случайная задержка"""
        min_seconds = max(min_seconds, self.min_delay_ms / 1000.0)
        max_seconds = max(max_seconds, self.max_delay_ms / 1000.0, min_seconds)
        time.sleep(random.uniform(min_seconds, max_seconds))

    def emit_status(self, payload):
        if self.on_status_update:
            try:
                self.on_status_update(payload)
            except Exception:
                pass

    def profile_delay(self, key: str, fallback_min_ms: int, fallback_max_ms: int) -> None:
        details_delays = self.request_delays_ms.get("details", {})
        low = int(details_delays.get(f"{key}_min", fallback_min_ms)) / 1000
        high = int(details_delays.get(f"{key}_max", fallback_max_ms)) / 1000
        if high < low:
            low, high = high, low
        self.random_delay(low, high)
    
    def _element_is_visible(self, element) -> bool:
        try:
            if not element.is_displayed():
                return False
            rect = element.rect or {}
            return rect.get("width", 0) > 0 and rect.get("height", 0) > 0
        except Exception:
            return False

    def _element_inside_offer_card(self, element) -> bool:
        try:
            return bool(
                element.find_elements(
                    By.XPATH,
                    "./ancestor::div[contains(@class,'OfferCard')]",
                )
            )
        except Exception:
            return False

    def _url_indicates_captcha(self) -> bool:
        try:
            return url_indicates_captcha_page(self.driver.current_url or "")
        except Exception:
            return False

    def _offer_card_loaded(self) -> bool:
        """Видимая карточка объявления (OfferCard + цена или заголовок)."""
        if not self.driver:
            return False
        card_xpath = "//div[contains(@class,'OfferCard') and not(ancestor::footer)]"
        try:
            for card in self.driver.find_elements(By.XPATH, card_xpath):
                if not self._element_is_visible(card):
                    continue
                card_text = self.extract_text_safe(card)
                if "₽" in card_text:
                    return True
                for el in card.find_elements(
                    By.XPATH,
                    ".//*[contains(@class,'OfferPrice') or contains(@class,'OfferCardSummaryHeader')]",
                ):
                    if self._element_is_visible(el) and self.extract_text_safe(el):
                        return True
        except Exception:
            pass
        try:
            body = self.get_visible_page_text()
            has_h1 = bool(self.driver.find_elements(By.XPATH, "//h1"))
            if has_h1 and "₽" in body and len(body) > 80:
                return True
        except Exception:
            pass
        return False

    def _has_visible_captcha_ui(self) -> bool:
        """Видимый блок SmartCaptcha вне OfferCard (не скрытый iframe в DOM)."""
        if not self.driver:
            return False
        for xpath in _CAPTCHA_VISIBLE_CLASS_XPATHS + _CAPTCHA_VISIBLE_TEXT_XPATHS:
            try:
                for el in self.driver.find_elements(By.XPATH, xpath):
                    if not self._element_is_visible(el):
                        continue
                    if self._element_inside_offer_card(el):
                        continue
                    return True
            except Exception:
                continue
        return False

    def check_for_captcha(self):
        """Капча только при URL/title SmartCaptcha или видимом блоке без карточки offer."""
        if not self.driver:
            return False
        offer_ok = self._offer_card_loaded()
        url = ""
        title = ""
        try:
            url = self.driver.current_url or ""
            title = self.driver.title or ""
        except Exception:
            pass
        return should_treat_as_captcha_page(
            url=url,
            page_title=title,
            offer_card_present=offer_ok,
            visible_captcha_marker=self._has_visible_captcha_ui(),
        )

    def wait_captcha_cleared(
        self,
        max_attempts: int = 3,
        min_delay: float = 2,
        max_delay: float = 4,
    ) -> bool:
        """После Enter: пауза и повторные проверки; OfferCard = можно парсить."""
        for attempt in range(max_attempts):
            if attempt > 0:
                time.sleep(random.uniform(min_delay, max_delay))
            if self._offer_card_loaded():
                if attempt > 0:
                    print("ℹ️  Карточка объявления на месте — продолжаем парсинг.")
                return True
            if not self.check_for_captcha():
                return True
        return False

    def _print_captcha_banner(self, url: str = "", link_index: int | None = None) -> None:
        idx = f" ({link_index})" if link_index is not None else ""
        print("\n" + "=" * 60)
        print("⚠️  КАПЧА Яндекс.Недвижимость" + idx)
        print("=" * 60)
        if url:
            print(f"URL: {url}")
        if self.headless:
            print("ℹ️  Сейчас headless=true. При капче парсер переключит Chrome в режим с окном.")
        else:
            print("Окно Chrome должно быть на переднем плане — решите капчу там.")
        print(
            "При частых капчах: Ctrl+C в терминале, сделайте паузу 15–30 мин, "
            "запустите снова (resume подхватит прогресс)."
        )
        print("=" * 60 + "\n")
    
    def handle_captcha(self, url: str = "", link_index: int | None = None):
        """Обработка капчи"""
        print("PARSER_PROGRESS_STATUS:captcha_required")
        self.emit_status({"status": "captcha_required", "step": "Обнаружена капча"})
        self._print_captcha_banner(url, link_index)
        if self.headless:
            print("🔁 Переключаемся из headless в режим с окном для ручного решения капчи…")
            self.headless = False
            self.recreate_driver("капча в headless, требуется ручное решение")
            if url:
                self.driver.get(url)
                self.profile_delay("after_open", 2500, 5200)

        if not self.interactive:
            print("PARSER_PROGRESS_STATUS:waiting_user")
            self.emit_status({"status": "waiting_user", "step": "Ожидание решения капчи"})
            started = time.time()
            while True:
                if self.should_resume and self.should_resume():
                    print("▶️ Получен сигнал продолжения из UI.")
                if not self.check_for_captcha():
                    print("PARSER_PROGRESS_STATUS:running")
                    self.emit_status({"status": "running", "step": "Капча решена, продолжаем"})
                    return True
                if time.time() - started >= self.captcha_auto_wait_seconds:
                    self.emit_status({"status": "waiting_user", "step": "Капча не решена, ожидание пользователя"})
                time.sleep(3)

        if self.resume_after_captcha and self._captcha_solved_once:
            print("PARSER_PROGRESS_STATUS:waiting_user")
            self.emit_status({"status": "waiting_user", "step": "Ожидание решения капчи"})
            print("⏸️  Режим resume_after_captcha: решите капчу в окне Chrome и нажмите Enter здесь.")
            try:
                input("Enter — продолжить парсинг после решения капчи...")
            except KeyboardInterrupt:
                print(
                    "\n⏸️  Прервано (Ctrl+C). make moscow-details-flush, затем make moscow-details"
                )
                self.recreate_driver("прервано на Enter (resume_after_captcha, Ctrl+C)")
                raise
            if not self.ensure_driver_alive("после капчи (resume_after_captcha)"):
                return False
            time.sleep(random.uniform(2, 4))
            if not self.wait_captcha_cleared():
                print(
                    "⚠️  После Enter капча всё ещё видна — "
                    "проверьте Chrome; парсер попробует карточку ещё раз."
                )
            print("PARSER_PROGRESS_STATUS:running")
            self.emit_status({"status": "running", "step": "Капча решена"})
            return True

        print("Действие:")
        print("  1 — решить капчу вручную в Chrome и продолжить (рекомендуется)")
        print("  2 — пропустить это объявление")
        print("  3 — остановить парсинг (Ctrl+C тоже ок; прогресс сохранится при resume)")
        
        while True:
            try:
                choice = input("Введите 1, 2 или 3: ").strip()
            except KeyboardInterrupt:
                print(
                    "\n⏸️  Прервано (Ctrl+C) на капче. Сохраните прогресс: "
                    "Ctrl+C ещё раз → make moscow-details-flush → make moscow-details"
                )
                self.recreate_driver("прервано на капче (Ctrl+C)")
                raise

            if choice == "1":
                print("PARSER_PROGRESS_STATUS:waiting_user")
                self.emit_status({"status": "waiting_user", "step": "Ожидание решения капчи"})
                print("⏸️  Решите капчу в открытом окне Chrome, затем вернитесь в терминал.")
                try:
                    input("Enter — продолжить после решения капчи...")
                except KeyboardInterrupt:
                    print(
                        "\n⏸️  Прервано (Ctrl+C). make moscow-details-flush, затем make moscow-details"
                    )
                    self.recreate_driver("прервано на Enter после капчи (Ctrl+C)")
                    raise
                if not self.ensure_driver_alive("после решения капчи"):
                    return False
                self._captcha_solved_once = True
                time.sleep(random.uniform(2, 4))
                self.wait_captcha_cleared()
                print("PARSER_PROGRESS_STATUS:running")
                self.emit_status({"status": "running", "step": "Капча решена"})
                return True
            elif choice == "2":
                print(
                    "⏭️  Пропускаем объявление и перезапускаем Chrome "
                    "(вариант 2 часто оставляет мёртвую сессию)."
                )
                self.recreate_driver("пропуск капчи (вариант 2)")
                return False
            elif choice == "3":
                print("🛑  Останавливаем парсинг. При resume_details прогресс не потеряется.")
                self.stop_requested = True
                return None
            else:
                print("❌ Неверный выбор. Введите 1, 2 или 3.")

    def maybe_pause_after_session_limit(self, link_index: int, total_links: int) -> bool:
        """Пауза после max_links_per_session успешных карточек в одной сессии браузера."""
        if not self.max_links_per_session or self._session_parsed_count <= 0:
            return True
        if self._session_parsed_count % self.max_links_per_session != 0:
            return True

        print("\n" + "=" * 60)
        print(
            f"⏸️  Достигнут лимит сессии: {self.max_links_per_session} объявлений "
            f"({link_index}/{total_links})."
        )
        print(
            "Рекомендуется пауза 10–20 мин или перезапуск make moscow-details "
            "(новая сессия Chrome снижает риск капчи)."
        )
        print("  Enter — продолжить в том же окне")
        print("  3 — остановить парсинг")
        print("=" * 60)
        if not self.interactive:
            self._session_parsed_count = 0
            self.random_delay(8, 16)
            return True
        choice = input("Enter или 3: ").strip()
        if choice == "3":
            self.stop_requested = True
            return False
        self._session_parsed_count = 0
        self.random_delay(8, 16)
        return True
    
    def load_links(self):
        """Загружает ссылки из файла"""
        links = []
        if os.path.exists(self.links_file):
            with open(self.links_file, "r", encoding='utf-8') as f:
                links = [line.strip() for line in f if line.strip()]
                print(f"📂 Загружено {len(links)} ссылок из файла")
        else:
            print(f"❌ Файл {self.links_file} не найден!")
            return []
        
        if self.max_links:
            links = links[:self.max_links]
            print(f"📄 Ограничиваем до {self.max_links} ссылок")
        
        return links
    
    def extract_text_safe(self, element, default=""):
        """Безопасное извлечение текста из элемента"""
        try:
            raw = element.text if element else default
            return self.normalize_text(raw)
        except:
            return default
    
    def extract_attribute_safe(self, element, attribute, default=""):
        """Безопасное извлечение атрибута из элемента"""
        try:
            return element.get_attribute(attribute) if element else default
        except:
            return default

    def normalize_text(self, text: str) -> str:
        """Очищает текст: убирает переводы строк и лишние пробелы."""
        if not text:
            return ""
        cleaned = re.sub(r"\s+", " ", text.replace("\r", " ").replace("\n", " "))
        return cleaned.strip()

    def clean_title(self, title_text: str) -> str:
        """Возвращает краткий заголовок без цен и лишних хвостов."""
        if not title_text:
            return ""
        title_text = self.normalize_text(title_text)
        # Обрезаем по символу рубля, если вдруг попало
        parts = re.split(r"₽", title_text, maxsplit=1)
        return parts[0].strip()

    def clean_address(self, address_text: str) -> str:
        """Возвращает адрес без подсказок типа расстояний/станций."""
        if not address_text:
            return ""
        address_text = self.normalize_text(address_text).replace("\xa0", " ")
        address_text = re.sub(r"^(?:расположение|адрес)\s*[:\-]\s*", "", address_text, flags=re.I)
        address_text = address_text.strip(" \"'«»")
        # Убираем блоки про ж/д станции и расстояния
        address_text = re.split(r"ж/д\sст\.[^,]*", address_text)[0]
        address_text = re.split(r"\s*(?:до\s+метро|метро|на\s+карте)\b.*$", address_text, maxsplit=1, flags=re.I)[0]
        # Обрежем по двум пробелам и по шаблону километров, если осталось
        address_text = re.split(r"\s{2,}|\s\d+,?\d*\s?км", address_text)[0]
        address_text = address_text.strip(", ")
        low = address_text.lower().strip()
        if low in _ADDRESS_INVALID_EXACT:
            return ""
        if _ADDRESS_COORD_PAIR_RE.match(low):
            return ""
        if re.fullmatch(r"[+-]?\d+(?:[.,]\d+)?", low):
            return ""
        return address_text
    
    def parse_price(self, price_text):
        """Парсит цену из текста"""
        if not price_text:
            return None
        
        # Убираем все символы кроме цифр
        price_match = re.search(r'[\d\s]+', price_text.replace(' ', ''))
        if price_match:
            try:
                return int(price_match.group().replace(' ', ''))
            except:
                pass
        return None
    
    def parse_area(self, area_text):
        """Парсит площадь из текста"""
        if not area_text:
            return None
        
        # Ищем числа в тексте
        area_match = re.search(r'(\d+(?:[.,]\d+)?)', area_text)
        if area_match:
            try:
                return float(area_match.group().replace(',', '.'))
            except:
                pass
        return None
    
    def parse_floor(self, floor_text):
        """Парсит этаж из текста"""
        if not floor_text:
            return None
        
        text = self.normalize_text(floor_text)
        # Варианты: "X/Y", "X из Y", "этаж X из Y"
        floor_match = re.search(r'(\d+)\s*/\s*(\d+)', text)
        if not floor_match:
            floor_match = re.search(r'(\d+)\s*(?:из|ИЗ)\s*(\d+)', text)
        if floor_match:
            try:
                return int(floor_match.group(1)), int(floor_match.group(2))
            except:
                pass
        return None, None

    def get_spec_value_by_label(self, labels):
        """Ищет значение характеристики по списку возможных названий поля."""
        xpaths_templates = [
            "//*[self::div or self::span][contains(normalize-space(.), '{label}')]/following-sibling::*[1]",
            "//dt[contains(normalize-space(.), '{label}')]/following-sibling::dd[1]",
            "//tr[td[contains(normalize-space(.), '{label}')]]/td[last()]",
            "//div[contains(@class,'Parameter')][.//*[contains(normalize-space(.), '{label}')]]//*[contains(@class,'value')][1]",
        ]
        for label in labels:
            for tmpl in xpaths_templates:
                xpath = tmpl.format(label=label)
                try:
                    elems = self.driver.find_elements(By.XPATH, xpath)
                    for el in elems:
                        text = self.extract_text_safe(el)
                        if text:
                            return text
                except:
                    continue
        return ""

    def parse_json_ld(self):
        """Пытается извлечь данные из JSON-LD (schema.org) на странице."""
        result = {}
        try:
            scripts = self.driver.find_elements(By.XPATH, "//script[@type='application/ld+json']")
            for sc in scripts:
                try:
                    raw = sc.get_attribute('innerHTML') or sc.get_attribute('textContent')
                    if not raw:
                        continue
                    data = json.loads(raw)
                except Exception:
                    # иногда это массив JSON-LD
                    try:
                        data = json.loads(raw.strip())
                    except:
                        continue
                # нормализуем до списка
                if isinstance(data, dict) and isinstance(data.get("@graph"), list):
                    nodes = data.get("@graph") or []
                else:
                    nodes = data if isinstance(data, list) else [data]
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    # Offer/Apartment/RealEstate
                    # Цена
                    offer = node.get('offers') or node.get('offer')
                    if isinstance(offer, dict):
                        price = offer.get('price') or offer.get('priceSpecification', {}).get('price')
                        if price:
                            try:
                                result['price'] = int(float(price))
                            except:
                                pass
                    # Площадь
                    area = node.get('floorSize') or node.get('area')
                    if isinstance(area, dict):
                        val = area.get('value') or area.get('valueReference') or area.get('amount')
                        if val:
                            try:
                                result['area_total'] = float(val)
                            except:
                                pass
                    # Адрес
                    address = node.get('address')
                    if isinstance(address, dict):
                        street = address.get('streetAddress') or ''
                        locality = address.get('addressLocality') or ''
                        parsed_address = self.clean_address(f"{locality} {street}")
                        if self.looks_like_address(parsed_address):
                            result['address'] = parsed_address
                    elif isinstance(address, str):
                        parsed_address = self.clean_address(address)
                        if self.looks_like_address(parsed_address):
                            result['address'] = parsed_address
                    # Комнаты
                    rooms = node.get('numberOfRooms')
                    if rooms:
                        try:
                            result['rooms'] = int(rooms)
                        except:
                            pass
                    # Этажи
                    floor = node.get('floorNumber')
                    total_floors = node.get('numberOfFloors') or node.get('floorCount')
                    if floor:
                        try:
                            result['floor'] = int(floor)
                        except:
                            pass
                    if total_floors:
                        try:
                            result['floors_total'] = int(total_floors)
                        except:
                            pass
        except:
            pass
        return result

    def parse_int_from_text(self, text: str):
        """Извлекает целое число из строки (удаляя пробелы/нецифры)."""
        if not text:
            return None
        digits = re.findall(r"\d+", text.replace("\xa0", " "))
        if not digits:
            return None
        try:
            return int("".join(digits))
        except:
            return None

    def find_first_text(self, keywords, scope: str = "card"):
        """Находит первый элемент с ключевым словом; по умолчанию только внутри OfferCard."""
        roots = []
        if scope == "card":
            try:
                roots = self.driver.find_elements(
                    By.XPATH,
                    "//div[contains(@class,'OfferCard') and not(ancestor::footer)]",
                )
            except Exception:
                roots = []
        if not roots:
            roots = [self.driver.find_element(By.TAG_NAME, "body")]
        for kw in keywords:
            try:
                xpath1 = f".//*[contains(normalize-space(text()), '{kw}')]"
                xpath2 = f".//*[contains(@title, '{kw}')]"
                for root in roots[:3]:
                    elems = root.find_elements(By.XPATH, xpath1) + root.find_elements(
                        By.XPATH, xpath2
                    )
                    for el in elems:
                        txt = self.extract_text_safe(el)
                        if txt and kw.lower() in txt.lower() and not is_polluted_text(txt):
                            return txt
            except Exception:
                continue
        return ""

    def get_offer_card_text(self, max_len: int = 14000) -> str:
        """Видимый текст карточки объявления без футера/меню сайта."""
        chunks: list[str] = []
        try:
            for el in self.driver.find_elements(
                By.XPATH,
                "//div[contains(@class,'OfferCard') and not(ancestor::footer)]",
            ):
                txt = self.extract_text_safe(el)
                if txt and len(txt) > 80:
                    chunks.append(txt)
        except Exception:
            pass
        if not chunks:
            return self.get_visible_page_text()[:max_len]
        return self.normalize_text("\n".join(chunks))[:max_len]

    def extract_seller_from_offer_card(self, offer_url: str = "") -> tuple[str, str]:
        """Имя и тип продавца из OfferCardAuthorBadge (сайдбар), без UserNote/кнопок."""
        name = ""
        seller_type = ""
        card_xpath = "//div[contains(@class,'OfferCard') and not(ancestor::footer)]"

        try:
            for el in self.driver.find_elements(
                By.XPATH,
                f"{card_xpath}//span[contains(@class,'AuthorName__name')]"
                f" | {card_xpath}//*[contains(@class,'OfferCardAuthorBadge__name')]//span",
            ):
                txt = self.normalize_text(self.extract_text_safe(el))
                if txt and not is_seller_polluted_text(txt):
                    name = txt
                    break
        except Exception:
            pass

        try:
            for el in self.driver.find_elements(
                By.XPATH,
                f"{card_xpath}//*[contains(@class,'AuthorCategory__category')]"
                f" | {card_xpath}//*[contains(@class,'OfferCardAuthorBadge__category')]",
            ):
                txt = self.normalize_text(self.extract_text_safe(el))
                if txt and not is_seller_polluted_text(txt):
                    seller_type = txt
                    break
        except Exception:
            pass

        if not name:
            offer_id = self.extract_offer_id(offer_url or "")
            try:
                blob = self.driver.page_source or ""
            except Exception:
                blob = ""
            if offer_id and blob:
                window = 12000
                for pos in (m.start() for m in re.finditer(re.escape(offer_id), blob)):
                    chunk = blob[max(0, pos - window): pos + window]
                    m_name = re.search(r'"agentName"\s*:\s*"([^"]+)"', chunk)
                    if m_name and not is_seller_polluted_text(m_name.group(1)):
                        name = self.normalize_text(m_name.group(1))
                        m_cat = re.search(r'"category"\s*:\s*"([A-Z_]+)"', chunk)
                        if m_cat and not seller_type:
                            seller_type = _SELLER_JSON_CATEGORY_MAP.get(
                                m_cat.group(1), m_cat.group(1)
                            )
                        break

        return name, seller_type

    def apply_seller_fields(self, flat_data: dict) -> None:
        """Заполняет «Продавец» / «Тип продавца», перезаписывая UI-мусор."""
        current = flat_data.get("Продавец") or ""
        if current and not is_seller_polluted_text(current):
            return
        name, seller_type = self.extract_seller_from_offer_card(
            flat_data.get("Ссылка", "")
        )
        if name:
            flat_data["Продавец"] = name
        elif is_seller_polluted_text(current):
            flat_data["Продавец"] = ""
        if seller_type and not flat_data.get("Тип продавца"):
            flat_data["Тип продавца"] = seller_type

    def collect_highlight_pairs(self) -> dict[str, str]:
        """Пары label→value из OfferCardHighlight (верхняя строка характеристик)."""
        pairs: dict[str, str] = {}
        try:
            nodes = self.driver.find_elements(
                By.XPATH, "//div[contains(@class,'OfferCardHighlight__container')]",
            )
            for node in nodes:
                try:
                    label = self.extract_text_safe(
                        node.find_element(
                            By.XPATH,
                            ".//div[contains(@class,'OfferCardHighlight__label')]",
                        )
                    ).lower().strip()
                    value = self.extract_text_safe(
                        node.find_element(
                            By.XPATH,
                            ".//div[contains(@class,'OfferCardHighlight__value')]",
                        )
                    )
                    if label and value and not is_polluted_text(value):
                        pairs[label] = value
                except Exception:
                    continue
        except Exception:
            pass
        return pairs

    def parse_deal_type_from_badges(self, badges: list[str]) -> str:
        for badge in badges:
            if is_polluted_text(badge):
                continue
            low = badge.lower().strip()
            for pattern, deal in _DEAL_BADGE_RULES:
                if re.search(pattern, low, re.I):
                    return deal
        return ""

    def _building_year(self, flat_data: dict) -> int | None:
        raw = flat_data.get("Год постройки") or ""
        yr = self.parse_int_from_text(str(raw))
        if yr and 1800 < yr < 2100:
            return yr
        return None

    def _has_primary_signals(self, flat_data: dict, badges: list[str]) -> bool:
        if flat_data.get("Застройщик") or flat_data.get("Срок сдачи"):
            return True
        if self.parse_deal_type_from_badges(badges) == "первичная продажа":
            return True
        for badge in badges:
            low = badge.lower()
            if "цена от застройщика" in low or re.search(r"первичн\w+\s+продаж", low):
                return True
        return False

    def infer_listing_type(
        self,
        title: str,
        card_text: str,
        flat_data: dict,
        badges: list[str] | None = None,
    ) -> str:
        """Тип объявления: приоритет бейджей, года постройки, застройщика; не по футеру."""
        badges = badges or []
        current_year = datetime.now().year

        deal = self.parse_deal_type_from_badges(badges)
        if deal in ("альтернатива", "вторичная продажа", "переуступка"):
            return "вторичка"

        built = self._building_year(flat_data)
        if built and built <= current_year - 3:
            return "вторичка"

        if self._has_primary_signals(flat_data, badges):
            return "новостройка"

        title_low = (title or "").lower()
        if "апартамент" in title_low:
            return "апартаменты"
        if re.search(r"вторич", title_low):
            return "вторичка"

        card_low = (card_text or "")[:8000].lower()
        if re.search(r"вторичн\w+\s+продаж", card_low):
            return "вторичка"
        if (
            re.search(r"новострой", card_low)
            and self._has_primary_signals(flat_data, badges)
        ):
            return "новостройка"
        if re.search(r"от\s+застройщика", card_low) and flat_data.get("Застройщик"):
            return "новостройка"
        return ""

    def infer_deal_type(
        self,
        flat_data: dict,
        badges: list[str],
        card_text: str,
    ) -> str:
        """Вид сделки: бейджи карточки; без fallback «новостройка → первичная»."""
        deal = self.parse_deal_type_from_badges(badges)
        if deal:
            return deal

        card_low = (card_text or "")[:6000].lower()
        if re.search(r"первичн\w+\s+продаж", card_low) and self._has_primary_signals(
            flat_data, badges
        ):
            return "первичная продажа"
        if re.search(r"вторичн\w+\s+продаж", card_low):
            return "вторичная продажа"
        if re.search(r"переуступк", card_low):
            return "переуступка"
        if re.search(r"(?<![\wа-яё])альтернатив", card_low):
            return "альтернатива"

        listing = flat_data.get("Тип объявления") or ""
        if listing == "новостройка" and self._has_primary_signals(flat_data, badges):
            return "первичная продажа"
        if listing == "вторичка":
            return "вторичная продажа"
        return ""

    def apply_highlight_pairs(self, flat_data: dict, pairs: dict[str, str]) -> None:
        """Верхняя строка OfferCardHighlight → площади, этаж, год, потолки."""
        for label, value in pairs.items():
            if not value or is_polluted_text(value):
                continue
            low = label.lower()
            if "общ" in low or low == "площадь":
                if flat_data.get("Общая площадь") is None:
                    flat_data["Общая площадь"] = self.parse_area(value)
            elif "жил" in low:
                if flat_data.get("Жилая площадь") is None:
                    flat_data["Жилая площадь"] = self.parse_area(value)
            elif "кухн" in low:
                if flat_data.get("Площадь кухни") is None:
                    flat_data["Площадь кухни"] = self.parse_area(value)
            elif "этаж" in low and "из" in value.lower():
                f, t = self.parse_floor(value)
                if f and not flat_data.get("Этаж"):
                    flat_data["Этаж"] = f
                if t and not flat_data.get("Этажей в доме"):
                    flat_data["Этажей в доме"] = t
            elif "потолк" in low and not flat_data.get("Высота потолков"):
                num = re.search(r"\d+(?:[.,]\d+)?", value)
                if num:
                    flat_data["Высота потолков"] = num.group().replace(",", ".") + " м"
            elif "год постройки" in low or (low == "год" and re.search(r"\d{4}", value)):
                yr = self.parse_int_from_text(value)
                if yr and 1800 < yr < 2100:
                    flat_data["Год постройки"] = str(yr)

    def parse_room_areas(self, card_text: str) -> str:
        """Площади комнат: «19 м² 15 м² 12 м²» рядом с подписью комнат."""
        if not card_text:
            return ""
        m = re.search(
            r"(?:площад\w*\s+)?комнат\w*[^\d]{0,40}((?:\d+(?:[.,]\d+)?\s*м²\s*){2,})",
            card_text,
            re.I,
        )
        if not m:
            m = re.search(
                r"((?:\d+(?:[.,]\d+)?\s*м²\s*){3,})",
                card_text,
            )
        if not m:
            return ""
        areas = re.findall(r"(\d+(?:[.,]\d+)?)", m.group(1))
        if len(areas) >= 2:
            return ", ".join(a.replace(",", ".") for a in areas)
        return ""

    def parse_amenities_from_features(self, feature_titles: list[str]) -> str:
        found: list[str] = []
        seen: set[str] = set()
        for title in feature_titles:
            low = title.lower()
            if is_polluted_text(title):
                continue
            if any(k in low for k in _AMENITY_CHIP_KEYWORDS):
                key = self.normalize_text(title)
                if key not in seen:
                    seen.add(key)
                    found.append(key)
        return "; ".join(found)

    def apply_about_house_text_extras(self, flat_data: dict, card_text: str) -> None:
        """Серия дома, число квартир — из блока «О доме» в тексте карточки."""
        if not card_text:
            return
        if not flat_data.get("Серия дома"):
            m = re.search(
                r"(?:серия|серии)\s+(?:дома\s+)?([А-Яа-яЁё\d][А-Яа-яЁё\d\-\.]{1,12})",
                card_text,
                re.I,
            )
            if m and not is_polluted_text(m.group(1)):
                flat_data["Серия дома"] = m.group(1).strip()
        if not flat_data.get("Квартир в доме"):
            m = re.search(r"(\d{1,4})\s+квартир", card_text, re.I)
            if m:
                flat_data["Квартир в доме"] = m.group(1)
        if not flat_data.get("Подъезды"):
            m = re.search(r"(\d{1,2})\s+подъезд", card_text, re.I)
            if m:
                flat_data["Подъезды"] = m.group(1)
        if not flat_data.get("Тип дома"):
            m = re.search(
                r"(кирпично[-\s]*монолитн\w+\s+здани\w*|монолитн\w+\s+здани\w*|"
                r"кирпичн\w+\s+дом\w*|панельн\w+\s+(?:здани\w*|дом\w*)|блочн\w+\s+дом\w*)",
                card_text,
                re.I,
            )
            if m:
                flat_data["Тип дома"] = self.normalize_text(m.group(1))

    def apply_details_feature_grid(self, flat_data: dict, card_text: str) -> None:
        """Сетка OfferCardDetailsFeatures: санузел, балкон, вид, отделка, комнаты."""
        features = self.collect_offer_card_feature_titles()
        blob = "\n".join(features) + "\n" + (card_text or "")
        low = blob.lower()

        if not flat_data.get("Санузел"):
            m = re.search(r"санузел\s*[—–-]?\s*(\w+)", low, re.I)
            if m:
                flat_data["Санузел"] = m.group(1).capitalize()
            elif "раздельн" in low:
                flat_data["Санузел"] = "раздельный"
            elif "совмещ" in low:
                flat_data["Санузел"] = "совмещённый"
        if flat_data.get("Санузел"):
            su = str(flat_data["Санузел"])
            m = re.search(r"санузел\s+(\w+)", su, re.I)
            if m:
                flat_data["Санузел"] = m.group(1).lower()

        if not flat_data.get("Балкон или лоджия"):
            if "балкон" in low and "лодж" in low:
                flat_data["Балкон или лоджия"] = "балкон и лоджия"
            elif "лодж" in low:
                flat_data["Балкон или лоджия"] = "лоджия"
            elif "балкон" in low:
                flat_data["Балкон или лоджия"] = "балкон"

        if not flat_data.get("Окна"):
            m = re.search(r"вид\s+из\s+окон\s*[—–-]?\s*([^\n.;]{3,40})", blob, re.I)
            if m:
                view = self.normalize_text(m.group(1))
                view = re.sub(r"^вид\s+из\s+окон\s*", "", view, flags=re.I).strip()
                flat_data["Окна"] = view or "во двор"
            elif re.search(r"во\s+двор", low):
                flat_data["Окна"] = "во двор"
            elif re.search(r"на\s+улиц", low):
                flat_data["Окна"] = "на улицу"

        if not flat_data.get("Отделка"):
            m = re.search(r"отделка\s*[—–-]\s*([^\n.;]{2,40})", blob, re.I)
            if m:
                flat_data["Отделка"] = self.normalize_text(m.group(1))
            elif "евроремонт" in low:
                flat_data["Отделка"] = "евроремонт"

        if not flat_data.get("Площади комнат"):
            flat_data["Площади комнат"] = self.parse_room_areas(card_text or blob)

        if not flat_data.get("Удобства"):
            amenities = self.parse_amenities_from_features(features)
            if amenities:
                flat_data["Удобства"] = amenities

    def normalize_completion_term(self, raw: str) -> str:
        """Нормализует срок сдачи до «N кв. YYYY»."""
        if not raw:
            return ""
        txt = self.normalize_text(raw)
        m = _COMPLETION_TERM_RE.search(txt)
        if m:
            term = re.sub(r"\s+", " ", m.group(1).strip())
            term = re.sub(r"\s*г\.?\s*$", "", term, flags=re.I).strip()
            return term
        return txt if re.search(r"\d+\s*кв\.?\s*\d{4}", txt, re.I) else ""

    def collect_offer_card_badges(self) -> list[str]:
        """Бейджи/чипы у заголовка: OfferCardHighlight, галерея, summary chips."""
        badges: list[str] = []
        seen: set[str] = set()

        def add(raw: str) -> None:
            txt = self.normalize_text(raw)
            if not txt or txt in seen or is_polluted_text(txt):
                return
            if "₽" in txt or re.search(r"₽\s*(?:/|за)\s*м²", txt, re.I):
                return
            seen.add(txt)
            badges.append(txt)

        selectors = (
            "//div[contains(@class,'OfferCardHighlight')]//*[self::span or self::div or self::a]",
            "//div[contains(@class,'OfferCardGallery')]//*[contains(@class,'Badge') or contains(@class,'Highlight') or contains(@class,'Chip')]",
            "//div[contains(@class,'OfferCardSummary')]//*[contains(@class,'Badge') or contains(@class,'Highlight') or contains(@class,'Chip')]",
            "//div[contains(@class,'OfferCardDetailsFeatures')]//div[contains(@class,'OfferCardFeature__text')]",
        )
        for xpath in selectors:
            try:
                for el in self.driver.find_elements(By.XPATH, xpath):
                    add(el.get_attribute("title") or self.extract_text_safe(el))
            except Exception:
                continue

        try:
            for m in re.finditer(
                r'OfferCard(?:Highlight|Feature)__[^"]*"[^>]*>([^<]{2,80})<',
                self.driver.page_source or "",
            ):
                add(m.group(1))
        except Exception:
            pass
        return badges

    def extract_card_hero_title(self) -> str:
        """Полный маркетинговый заголовок («1-комнатная квартира в ЖК «МИРА»»), не строка с м²."""
        patterns = (
            r"(?:\d+-комнатн\w*|студи\w*)\s+квартир\w*\s+в\s+(?:ЖК|МФК)\s*«[^»]+»",
            r"(?:\d+-комнатн\w*|студи\w*)\s+квартир\w*\s+[^,]{4,120}",
        )
        for blob in (self.get_visible_page_text(), self.driver.page_source or ""):
            for pat in patterns:
                m = re.search(pat, blob, re.I)
                if m:
                    title = self.normalize_text(m.group(0))
                    if not is_polluted_text(title) and "м²" not in title[:12]:
                        return title

        try:
            for el in self.driver.find_elements(
                By.XPATH,
                "//h2[contains(.,'квартира') or contains(.,'апартамент')]"
                "[contains(.,'ЖК') or contains(.,'МФК')]",
            ):
                txt = self.extract_text_safe(el)
                if txt and not is_polluted_text(txt) and "м²" not in txt[:8]:
                    return txt
        except Exception:
            pass
        return ""

    def parse_housing_class(self, badges: list[str]) -> str:
        for badge in badges:
            if _HOUSING_CLASS_RE.match(badge.strip()):
                return badge.strip().capitalize()
        for word in ("Элитный", "Комфорт", "Бизнес", "Эконом", "Премиум", "Стандарт"):
            try:
                els = self.driver.find_elements(
                    By.XPATH, f"//*[normalize-space(text())='{word}']",
                )
                for el in els[:3]:
                    if el.find_elements(By.XPATH, "./ancestor::footer"):
                        continue
                    return word
            except Exception:
                continue
        blob = self.get_visible_page_text()[:2500]
        for m in re.finditer(
            r"(?<![\wа-яё])(Элитн\w+|Комфорт\w+|Бизнес[\s-]*класс\w*|Премиум\w*)(?![\wа-яё])",
            blob,
            re.I,
        ):
            val = m.group(1).strip()
            if not is_polluted_text(val):
                return val.capitalize()
        return ""

    def parse_completion_from_badges(self, badges: list[str]) -> str:
        for badge in badges:
            low = badge.lower()
            if "срок сдачи" in low or re.search(r"\d+\s*кв\.?\s*\d{4}", badge, re.I):
                term = self.normalize_completion_term(badge)
                if term:
                    return term
        return ""

    def collect_summary_spec_chips(self) -> dict[str, str]:
        """Чипы под заголовком: «Отделка — без отделки», и т.п."""
        specs: dict[str, str] = {}
        chip_patterns = (
            (r"отделка\s*[—–-]\s*(.+)", "Отделка"),
            (r"ремонт\s*[—–-]\s*(.+)", "Ремонт"),
        )
        sources: list[str] = []
        try:
            for el in self.driver.find_elements(
                By.XPATH,
                "//div[contains(@class,'OfferCardSummaryInfoItem')]"
                " | //div[contains(@class,'OfferCardDetailsFeatures')]"
                "//div[contains(@class,'OfferCardFeature')]",
            ):
                sources.append(self.extract_text_safe(el))
        except Exception:
            pass
        sources.append(self.get_visible_page_text())
        for raw in sources:
            if not raw:
                continue
            low = raw.lower()
            for pattern, field in chip_patterns:
                m = re.search(pattern, low, re.I)
                if m and not specs.get(field):
                    val = self.normalize_text(m.group(1))
                    if val and not is_polluted_text(val):
                        specs[field.lower()] = val
        return specs

    def apply_hero_and_badges(self, flat_data: dict) -> None:
        badges = self.collect_offer_card_badges()
        hero = self.extract_card_hero_title()
        if hero:
            flat_data["Заголовок карточки"] = hero
        housing = self.parse_housing_class(badges)
        if housing:
            flat_data["Класс жилья"] = housing
        completion = self.parse_completion_from_badges(badges)
        if completion:
            flat_data["Срок сдачи"] = completion

        for label, value in self.collect_summary_spec_chips().items():
            field_map = {"отделка": "Отделка", "ремонт": "Ремонт"}
            field = field_map.get(label)
            if field and value and not flat_data.get(field):
                flat_data[field] = value

        if not flat_data.get("Вид сделки"):
            deal = self.parse_deal_type_from_badges(badges)
            if deal:
                flat_data["Вид сделки"] = deal
        if not flat_data.get("Способ продажи"):
            for badge in badges:
                low = badge.lower().strip()
                if re.match(r"^альтернатив", low):
                    flat_data["Способ продажи"] = "альтернатива"
                    break

    def _normalize_date_search_blob(self, text: str) -> str:
        if not text:
            return ""
        return text.replace("&nbsp;", " ").replace("\u00a0", " ")

    def extract_publication_date(self, page_text: str = "") -> str:
        """Дата публикации: «13 мая, N просмотров» у цены, не «Обновлено …» из графиков."""
        try:
            for el in self.driver.find_elements(
                By.XPATH,
                "//div[contains(@class,'OfferCardSummaryHeader__text')]",
            ):
                txt = self.normalize_text(self.extract_text_safe(el))
                if txt and "просмотр" in txt.lower() and not re.search(r"обновлен", txt, re.I):
                    return txt
        except Exception:
            pass

        for blob in (
            self._normalize_date_search_blob(page_text or ""),
            self._normalize_date_search_blob(self.get_visible_page_text()),
            self._normalize_date_search_blob(self.driver.page_source or ""),
        ):
            m = _PUBLICATION_DATE_RE.search(blob)
            if m:
                return f"{self.normalize_text(m.group(1))}, {m.group(2)} просмотров"
        return ""

    def collect_offer_card_feature_titles(self) -> list[str]:
        """Тексты чипов OfferCardFeature (в т.ч. за «ещё N характеристик»)."""
        titles: list[str] = []
        seen: set[str] = set()
        try:
            els = self.driver.find_elements(
                By.XPATH,
                "//div[contains(@class,'OfferCardFeature__text')]",
            )
            for el in els:
                raw = (el.get_attribute("title") or "").strip() or self.extract_text_safe(el)
                txt = self.normalize_text(raw)
                if not txt or txt in seen:
                    continue
                if "₽" in txt or re.search(r"₽\s*(?:/|за)\s*м²", txt, re.I):
                    continue
                seen.add(txt)
                titles.append(txt)
        except Exception:
            pass
        if not titles:
            try:
                blob = self.driver.page_source or ""
                for m in re.finditer(
                    r'OfferCardFeature__text[^"]*"[^>]*title="([^"]+)"',
                    blob,
                ):
                    txt = self.normalize_text(m.group(1))
                    if txt and txt not in seen and "₽" not in txt:
                        seen.add(txt)
                        titles.append(txt)
            except Exception:
                pass
        return titles

    def _should_replace_with_feature(self, field: str, current, new_value: str) -> bool:
        """Чип OfferCardFeature точнее, чем усечённый regex по всей странице."""
        if not new_value or is_polluted_text(new_value):
            return False
        if not current:
            return True
        cur = self.normalize_text(str(current))
        new = self.normalize_text(new_value)
        if cur == new:
            return False
        if field == "Мусоропровод" and cur.lower() in ("мусоропровод", "да", "нет") and new in ("да", "нет"):
            return cur.lower() == "мусоропровод" or len(new) <= len(cur)
        if field in ("Тип дома", "Парковка", "Тип проекта"):
            return len(new) > len(cur) or new.lower() in cur.lower()
        return False

    def apply_about_house_features(self, flat_data: dict, feature_titles: list[str]) -> None:
        for title in feature_titles:
            if is_polluted_text(title):
                continue
            low = title.lower()
            m_finish = re.match(r"отделка\s*[—–-]\s*(.+)", title, re.I)
            if m_finish:
                val = self.normalize_text(m_finish.group(1))
                if val and not is_polluted_text(val):
                    flat_data["Отделка"] = val
            for pattern, field, transform in _ABOUT_HOUSE_FEATURE_RULES:
                if not re.search(pattern, low, re.I):
                    continue
                value = transform(title) if transform else title
                if field in ("Тип проекта", "Вид сделки") and is_polluted_text(value):
                    break
                if self._should_replace_with_feature(field, flat_data.get(field), value):
                    flat_data[field] = value
                break

    def extract_corpus_building(self, page_text: str, flat_data: dict) -> str:
        """Корпус из описания лота или строки планировки с тем же этажом."""
        if not page_text:
            return ""
        floor = flat_data.get("Этаж")
        for pattern in (
            r"в\s+корпусе\s+(\d+)",
            r"корпус(?:е|а)?\s+(\d+)\s*,?\s*на\s+\d+\s+этаж",
        ):
            m = re.search(pattern, page_text, re.I)
            if m:
                return f"Корпус {m.group(1)}"
        if floor:
            m = re.search(
                rf"корпус\s+(\d+)\s+{floor}\s+из\s+\d+",
                page_text,
                re.I,
            )
            if m:
                return f"Корпус {m.group(1)}"
        return ""

    def extract_discounted_price(self, page_text: str) -> int | None:
        """Цена после скидки, если на карточке есть «–N%» рядом с двумя суммами."""
        if not page_text:
            return None
        blob = self._normalize_date_search_blob(page_text)
        m = re.search(
            r"([\d\s\u00a0]+)\s*₽\s*[–−-]\s*\d+\s*%\s*([\d\s\u00a0]+)\s*₽",
            blob,
        )
        if m:
            prices = [
                self.parse_price(m.group(1)),
                self.parse_price(m.group(2)),
            ]
            prices = [p for p in prices if p and p > 100_000]
            if prices:
                return min(prices)
        try:
            for el in self.driver.find_elements(
                By.XPATH,
                "//div[contains(@class,'OfferCardSummary')]//*[contains(text(),'%')]",
            ):
                txt = self.extract_text_safe(el)
                if not txt or "%" not in txt:
                    continue
                prices = [
                    self.parse_price(p)
                    for p in re.findall(r"([\d\s\u00a0]+)\s*₽", txt)
                ]
                prices = [p for p in prices if p and p > 100_000]
                if len(prices) >= 2:
                    return min(prices)
        except Exception:
            pass
        return None

    def get_geolocation_from_map_script(self):
        """Пытается извлечь координаты из подключаемых скриптов Яндекс.Карт (ll=lon,lat)."""
        try:
            map_scripts = self.driver.find_elements(By.XPATH, "//script[contains(@src,'api-maps.yandex') or contains(@src,'maps.yandex') or contains(@src,'mapkit')]")
            for sc in map_scripts:
                src = sc.get_attribute("src") or ""
                if not src:
                    continue
                # ищем ll=lon,lat или pt=lon,lat
                m = re.search(r"[?&](?:ll|pt)=([\d\.,]+),([\d\.,]+)", src)
                if m:
                    lon = m.group(1).replace(',', '.')
                    lat = m.group(2).replace(',', '.')
                    return f"{lat},{lon}"
        except:
            pass
        return ""

    def empty_flat_data(self, url: str) -> dict:
        return {key: (None if key in ("Цена", "Цена за метр", "Общая площадь", "Жилая площадь", "Площадь кухни", "Этаж", "Этажей в доме") else "")
                for key in DETAILS_FIELD_ORDER} | {"Ссылка": url}

    def extract_offer_id(self, url: str) -> str:
        m = re.search(r"/offer/(\d+)", url)
        return m.group(1) if m else ""

    def looks_like_address(self, text: str) -> bool:
        if not text:
            return False
        low = self.clean_address(text).lower()
        if low in _ADDRESS_INVALID_EXACT:
            return False
        if len(low) < 12:
            return False
        if _ADDRESS_COORD_PAIR_RE.match(low):
            return False
        if "http://" in low or "https://" in low:
            return False
        if any(p in low for p in ADDRESS_REJECT_PHRASES):
            return False
        # «7 д.» без улицы — типичный ложный матч из «В экспозиции 7 д.»
        if re.search(r"(?<![\wа-яё])д\.\s*$", low) and not any(m in low for m in ("ул.", "проезд", "проспект", "шоссе", "переулок", "наб")):
            return False
        if any(m in low for m in ADDRESS_STREET_MARKERS):
            return True
        # Фоллбек: город + номер дома (например: «Саратов, 2-й Овсяной проезд, 20»).
        has_house_number = re.search(r"(?:\bд\.?\s*|\bдом\s*)\d+[а-яёa-z0-9/\-]*", low) is not None
        has_cityish_part = "," in low and any(m in low for m in ADDRESS_CITY_MARKERS)
        return bool(has_house_number and has_cityish_part)

    def parse_rooms_from_text(self, text: str) -> str:
        if not text:
            return ""
        low = text.lower()
        if "студ" in low:
            return "0"
        m = re.search(r"(\d+)\s*[-\s]*комнат", low)
        if m:
            return m.group(1)
        m = re.search(r"(\d+)\s*[-\s]*комн\.?", low)
        if m:
            return m.group(1)
        return ""

    def _is_polluted_price_per_m2_context(self, ctx: str) -> bool:
        """Отсекает «средняя цена ЖК», не блокирует ₽/м² у карточки лота."""
        low = (ctx or "").lower()
        if "динамик" in low:
            return True
        if "средн" in low and "жк" in low:
            return True
        if re.search(r"средн\w*\s+цен", low):
            return True
        return False

    def collect_price_per_m2_from_text(self, text: str) -> list[int]:
        if not text:
            return []
        patterns = (
            r"([\d\s\u00a0]+)\s*₽\s*(?:/|за)\s*м²",
            r"([\d\s\u00a0]+)\s*₽\s*м²",
        )
        seen: set[int] = set()
        ordered: list[int] = []
        for pattern in patterns:
            for m in re.finditer(pattern, text, flags=re.IGNORECASE):
                ctx = text[max(0, m.start() - 40): m.start()].lower()
                if self._is_polluted_price_per_m2_context(ctx):
                    continue
                val = self.parse_price(m.group(1))
                if val and 50_000 < val < 5_000_000 and val not in seen:
                    seen.add(val)
                    ordered.append(val)
        return ordered

    def parse_price_per_m2_from_text(self, text: str) -> int | None:
        found = self.collect_price_per_m2_from_text(text)
        if not found:
            return None
        return found[-1]

    def collect_price_per_m2_from_dom(self) -> list[int]:
        """Явные «₽ за м²» / «₽/м²» в OfferCard (сайдбар, Дополнительно)."""
        selectors = (
            "//div[contains(@class,'OfferCardDetailsFeatures__container')]"
            "//div[contains(@class,'OfferCardFeature__text') and contains(.,'₽') and contains(.,'м²')]",
            "//div[contains(@class,'OfferPrice')]//*[contains(.,'₽') and contains(.,'м²')]",
            "//span[contains(@class,'OfferPrice')]//*[contains(.,'₽') and contains(.,'м²')]",
            "//div[contains(@class,'OfferCardSummary')]//*[contains(.,'₽') and contains(.,'м²')]",
            "//*[contains(@class,'OfferCard')]//span[contains(.,'₽/м²') or contains(.,'₽ за')]",
            "//*[contains(@class,'OfferCard')]//div[contains(.,'₽/м²') or contains(.,'₽ за')]",
        )
        seen: set[int] = set()
        ordered: list[int] = []
        ppm_re = re.compile(
            r"([\d\s\u00a0]+)\s*₽\s*(?:/|за)\s*м²|([\d\s\u00a0]+)\s*₽\s*м²",
            re.I,
        )
        for selector in selectors:
            try:
                for el in self.driver.find_elements(By.XPATH, selector):
                    txt = self.extract_text_safe(el)
                    if not txt or "м²" not in txt:
                        continue
                    for m in ppm_re.finditer(txt):
                        val = self.parse_price(m.group(1) or m.group(2))
                        if val and 50_000 < val < 5_000_000 and val not in seen:
                            seen.add(val)
                            ordered.append(val)
            except Exception:
                continue
        return ordered

    def extract_price_per_m2_from_dom(self) -> int | None:
        found = self.collect_price_per_m2_from_dom()
        return found[-1] if found else None

    def pick_price_per_m2(
        self, candidates: list[int], computed: int | None
    ) -> int | None:
        unique = list(dict.fromkeys(candidates))
        if not unique:
            return computed
        if computed is not None and len(unique) > 1:
            return min(unique, key=lambda v: abs(v - computed))
        return unique[-1]

    def get_visible_page_text(self) -> str:
        try:
            return self.normalize_text(self.driver.find_element(By.TAG_NAME, "body").text)
        except Exception:
            return ""

    def extract_address_from_document_title(self) -> str:
        try:
            title = self.driver.title or ""
            for pattern in (
                r"(?:квартира|апартамент|студия)\s*,\s*([^—]{8,220}?)\s*—\s*id",
                r",\s*([^—]{8,220}?)\s*—\s*id",
                r"([^—]{8,220}?)\s*—\s*id\s*\d+",
            ):
                m = re.search(pattern, title, flags=re.IGNORECASE)
                if m:
                    addr = self.clean_address(m.group(1))
                    if self.looks_like_address(addr):
                        return addr
        except Exception:
            pass
        return ""

    def extract_address_from_location_block(self) -> str:
        selectors = (
            "//*[self::div or self::dt or self::span][normalize-space(.)='Расположение' or normalize-space(.)='Адрес']/following-sibling::*[1]",
            "//tr[td[normalize-space(.)='Расположение' or normalize-space(.)='Адрес']]/td[last()]",
            "//div[contains(@class,'OfferCard')]//*[contains(@class,'location') or contains(@class,'Location')]//*[self::span or self::a or self::div]",
            "//*[@data-testid='offer-location']//*[self::span or self::a or self::div]",
        )
        for selector in selectors:
            try:
                for el in self.driver.find_elements(By.XPATH, selector):
                    addr = self.clean_address(self.extract_text_safe(el))
                    if self.looks_like_address(addr):
                        return addr
            except Exception:
                continue
        return ""

    def extract_address_from_geopin_contact_block(self) -> str:
        selectors = (
            "//*[contains(@class,'OfferCardAuthor') or contains(@class,'OfferCardContacts') or contains(@class,'OfferCardSeller')]//*[self::span or self::a or self::div]",
            "//*[contains(@class,'Geo') or contains(@class,'geo') or contains(@class,'Pin') or contains(@class,'pin')]//*[self::span or self::a or self::div]",
        )
        for selector in selectors:
            try:
                for el in self.driver.find_elements(By.XPATH, selector):
                    txt = self.clean_address(self.extract_text_safe(el))
                    if self.looks_like_address(txt):
                        return txt
            except Exception:
                continue
        return ""

    def extract_address_from_page_text(self, page_text: str) -> str:
        if not page_text:
            return ""
        patterns = (
            r"((?:г\.\s*)?[А-ЯЁ][^,\n]{1,45},\s*[^.\n]{4,180}?(?:д\.?|дом)\s*\d+[а-яёa-z0-9/\-]*)",
            r"([А-ЯЁ][^,\n]{1,45},\s*(?:ул\.?|улица|проспект|пр-т|проезд|шоссе|переулок|наб\.?|набережная|бульвар|площадь)[^.\n]{3,180})",
        )
        for pattern in patterns:
            for m in re.finditer(pattern, page_text, flags=re.IGNORECASE):
                addr = self.clean_address(m.group(1))
                if self.looks_like_address(addr):
                    return addr
        return ""

    def extract_address_from_dom(self) -> str:
        selectors = [
            "//*[@data-testid='offer-location']//*[self::span or self::a]",
            "//div[contains(@class,'OfferCardLocation')]//*[self::span or self::a]",
            "//div[contains(@class,'Address')]//*[self::span or self::a]",
            "//div[contains(@class,'address')]//*[self::span or self::a]",
        ]
        for selector in selectors:
            try:
                for el in self.driver.find_elements(By.XPATH, selector):
                    addr = self.clean_address(self.extract_text_safe(el))
                    if self.looks_like_address(addr):
                        return addr
            except Exception:
                continue
        return ""

    def extract_address_from_breadcrumbs(self) -> str:
        selectors = [
            "//nav[contains(@class,'Breadcrumb')]//*[self::a or self::span]",
            "//*[@data-testid='breadcrumbs']//*[self::a or self::span]",
        ]
        for selector in selectors:
            try:
                parts: list[str] = []
                for el in self.driver.find_elements(By.XPATH, selector):
                    text = self.clean_address(self.extract_text_safe(el))
                    if not text:
                        continue
                    low = text.lower()
                    if any(marker in low for marker in ("метро", "мин.", "пешком", "на карте")):
                        continue
                    parts.append(text)
                    if self.looks_like_address(text):
                        return text
                if parts:
                    combined = self.clean_address(", ".join(parts[-4:]))
                    if self.looks_like_address(combined):
                        return combined
            except Exception:
                continue
        return ""

    def extract_address_from_seller_block(self) -> str:
        selectors = [
            "//div[contains(@class,'OfferCardAuthor')]//*[self::a or self::span or self::div]",
            "//div[contains(@class,'OfferCardSeller')]//*[self::a or self::span or self::div]",
            "//div[contains(@class,'Author')]//*[self::a or self::span or self::div]",
        ]
        for selector in selectors:
            try:
                for el in self.driver.find_elements(By.XPATH, selector):
                    txt = self.clean_address(self.extract_text_safe(el))
                    if self.looks_like_address(txt):
                        return txt
            except Exception:
                continue
        return ""

    def extract_address_from_structured_data(self) -> str:
        # 1) Уже существующий JSON-LD парсер
        try:
            ld = self.parse_json_ld()
            addr = self.clean_address(ld.get("address", "")) if isinstance(ld, dict) else ""
            if self.looks_like_address(addr):
                return addr
        except Exception:
            pass

        # 2) Meta/itemprop: иногда адрес есть только в структурированных meta-тегах
        try:
            meta_elements = self.driver.find_elements(By.XPATH, "//meta[@content]")
            for meta in meta_elements:
                key = (
                    (meta.get_attribute("property") or "")
                    + " "
                    + (meta.get_attribute("name") or "")
                    + " "
                    + (meta.get_attribute("itemprop") or "")
                ).lower()
                if "address" not in key and "street" not in key and "locality" not in key:
                    continue
                addr = self.clean_address(meta.get_attribute("content") or "")
                if self.looks_like_address(addr):
                    return addr
        except Exception:
            pass

        # 3) Поиск в page source: addressLocality/streetAddress и address строкой
        try:
            source = self.driver.page_source or ""
            patterns = (
                r'"addressLocality"\s*:\s*"([^"]{2,80})".{0,180}?"streetAddress"\s*:\s*"([^"]{2,180})"',
                r'"streetAddress"\s*:\s*"([^"]{2,180})".{0,180}?"addressLocality"\s*:\s*"([^"]{2,80})"',
                r'"address"\s*:\s*"([^"]{12,220})"',
            )
            for pattern in patterns:
                for m in re.finditer(pattern, source, flags=re.IGNORECASE | re.DOTALL):
                    if m.lastindex == 2:
                        raw = f"{m.group(1)}, {m.group(2)}"
                    else:
                        raw = m.group(1)
                    addr = self.clean_address(raw.replace("\\u002F", "/").replace("\\/", "/"))
                    if self.looks_like_address(addr):
                        return addr
        except Exception:
            pass
        return ""

    def resolve_address(self, page_text: str) -> str:
        """Каскад адреса: явный блок -> геопин/контакты -> structured/meta -> безопасные fallback."""
        candidates = (
            self.extract_address_from_location_block(),
            self.extract_address_from_geopin_contact_block(),
            self.extract_address_from_structured_data(),
            self.extract_address_from_dom(),
            self.extract_address_from_breadcrumbs(),
            self.extract_address_from_document_title(),
            self.extract_address_from_page_text(page_text),
            self.extract_address_from_seller_block(),
        )
        for candidate in candidates:
            if self.looks_like_address(candidate):
                return candidate
        return ""

    def collect_spec_pairs(self) -> dict:
        """Собирает пары «лейбл → значение» из карточки и текста страницы."""
        specs: dict[str, str] = {}

        try:
            items = self.driver.find_elements(
                By.XPATH,
                "//div[contains(@class,'OfferCardSummaryInfoItem')]",
            )
            for item in items:
                try:
                    parts = item.find_elements(By.XPATH, ".//*[self::div or self::span]")
                    texts = [self.extract_text_safe(p) for p in parts if self.extract_text_safe(p)]
                    if len(texts) >= 2:
                        value, label = texts[0], texts[-1].lower()
                        specs[label] = value
                except Exception:
                    continue
        except Exception:
            pass

        try:
            highlights = self.driver.find_elements(
                By.XPATH, "//div[contains(@class,'OfferCardHighlight')]",
            )
            for node in highlights:
                try:
                    label = self.extract_text_safe(
                        node.find_element(By.XPATH, ".//*[contains(@class,'label')]")
                    ).lower()
                    value = self.extract_text_safe(
                        node.find_element(By.XPATH, ".//*[contains(@class,'value')]")
                    )
                    if label and value:
                        specs[label] = value
                except Exception:
                    continue
        except Exception:
            pass

        card_text = self.get_offer_card_text()
        specs.update(self._parse_specs_from_page_text(card_text))
        return specs

    def _parse_specs_from_page_text(self, page_text: str) -> dict:
        out: dict[str, str] = {}
        if not page_text:
            return out

        m = re.search(r"([\d.,]+)\s*м²\s*жилая", page_text, re.I)
        if m:
            out["жилая площадь"] = m.group(1)
        m = re.search(r"([\d.,]+)\s*м²\s*кухн", page_text, re.I)
        if m:
            out["площадь кухни"] = m.group(1)
        m = re.search(r"(\d+)\s*этаж\s*из\s*(\d+)", page_text, re.I)
        if m:
            out["этаж"] = f"{m.group(1)}/{m.group(2)}"
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*м\s*потолк", page_text, re.I)
        if m:
            out["высота потолков"] = m.group(1).replace(",", ".") + " м"
        m = re.search(r"(\d{4})\s*год\s*постройки", page_text, re.I)
        if m:
            out["год постройки"] = m.group(1)
        m = re.search(r"(\d+)\s*подъезд", page_text, re.I)
        if m:
            out["подъезды"] = m.group(1)
        m = re.search(r"(\d{1,4})\s+квартир", page_text, re.I)
        if m:
            out["квартир в доме"] = m.group(1)
        m = re.search(
            r"(?:серия|серии)\s+(?:дома\s+)?([А-Яа-яЁё\d][А-Яа-яЁё\d\-\.]{1,12})",
            page_text,
            re.I,
        )
        if m and not is_polluted_text(m.group(1)):
            out["серия дома"] = m.group(1).strip()
        m = re.search(r"(\d+)\s*этаж(?:ей|а)?\s*(?:в доме)?", page_text, re.I)
        if m and "этаж из" not in page_text[max(0, m.start() - 5): m.end() + 5].lower():
            out["этажей в доме"] = m.group(1)

        for label, pattern in (
            ("застройщик", r"застройщик\s*[«\"]([^»\"]+)[»\"]"),
            ("название новостройки", r"(?:МФК|ЖК)\s*«[^»]+»"),
            ("вид сделки", r"(?<!снять\s)(?<!посуточно\s)(первичн\w+\s+продаж\w*|вторичн\w+\s+продаж\w*|переуступк\w*|альтернатив\w*)"),
            ("тип участия", r"(долевое участие|дду|жск)"),
            ("способ продажи", r"(свободная продажа)"),
            ("срок сдачи", r"срок\s+сдачи\s+(\d+\s*кв\.?\s*\d{4}(?:\s*г\.?)?)"),
            ("тип проекта", r"(индивидуальный\s+проект|типовой\s+проект)"),
            ("тип дома", r"(кирпично[-\s]*монолитн\w+\s+здани\w*|монолитн\w+\s+здани\w*|кирпичн\w+\s+дом\w*|панельн\w+\s+дом\w*|блочн\w+\s+дом\w*)"),
            ("мусоропровод", r"мусоропровод\w*\s+(нет|отсутств)|мусоропровод"),
            ("охрана", r"Охрана\s*/\s*консьерж"),
            ("лифт", r"(?i)(?:^|\n)\s*Лифт\s*(?:\n|$)"),
            ("парковка", r"(подземн\w+\s+парковк\w*|закрыт\w+\s+парковк\w*|открыт\w+\s+парковк\w*)"),
            ("отделка", r"отделка\s*[—–-]\s*([^\n.]{2,60})"),
            ("двор", r"закрыт\w+\s+территор\w*(?:\s+нет)?"),
            ("отопление", r"отоплен\w*[^.\n]{0,30}"),
        ):
            m = re.search(pattern, page_text, re.I)
            if m:
                val = (m.group(1) if m.lastindex else m.group(0)).strip()
                if label == "мусоропровод" and re.search(r"нет|отсутств", val, re.I):
                    out[label] = "нет"
                elif not is_polluted_text(val):
                    out[label] = val

        return out

    def apply_spec_pairs(self, flat_data: dict, specs: dict) -> None:
        label_map = {
            "общая": "Общая площадь",
            "общая площадь": "Общая площадь",
            "площадь": "Общая площадь",
            "жилая": "Жилая площадь",
            "жилая площадь": "Жилая площадь",
            "кухня": "Площадь кухни",
            "площадь кухни": "Площадь кухни",
            "этаж": "Этаж",
            "этаж/этажей": "Этаж",
            "этажей в доме": "Этажей в доме",
            "высота потолков": "Высота потолков",
            "потолки": "Высота потолков",
            "год постройки": "Год постройки",
            "санузел": "Санузел",
            "балкон": "Балкон или лоджия",
            "лоджия": "Балкон или лоджия",
            "окна": "Окна",
            "вид из окон": "Окна",
            "ремонт": "Ремонт",
            "отделка": "Отделка",
            "тип дома": "Тип дома",
            "мусоропровод": "Мусоропровод",
            "парковка": "Парковка",
            "двор": "Двор",
            "вид сделки": "Вид сделки",
            "способ продажи": "Способ продажи",
            "тип участия": "Тип участия",
            "срок сдачи": "Срок сдачи",
            "название новостройки": "Название новостройки",
            "корпус": "Корпус, строение",
            "корпус, строение": "Корпус, строение",
            "продавец": "Продавец",
            "застройщик": "Застройщик",
            "тип проекта": "Тип проекта",
            "подъезды": "Подъезды",
            "охрана": "Охрана",
            "лифт": "Пассажирский лифт",
            "отделка": "Отделка",
            "серия дома": "Серия дома",
            "квартир в доме": "Квартир в доме",
            "площади комнат": "Площади комнат",
            "удобства": "Удобства",
            "отопление": "Отопление",
        }
        for raw_label, value in specs.items():
            label = raw_label.lower().strip()
            field = label_map.get(label)
            if not field or not value:
                continue
            if field in ("Продавец", "Тип продавца"):
                if is_seller_polluted_text(value):
                    continue
            elif is_polluted_text(value):
                continue
            if field == "Корпус, строение" and re.search(r"этаж", value, re.I):
                continue
            if field in ("Общая площадь", "Жилая площадь", "Площадь кухни"):
                parsed = self.parse_area(value)
                if parsed and flat_data.get(field) in (None, "", 0):
                    flat_data[field] = parsed
            elif field == "Этаж":
                f, t = self.parse_floor(value)
                if f and not flat_data.get("Этаж"):
                    flat_data["Этаж"] = f
                if t and not flat_data.get("Этажей в доме"):
                    flat_data["Этажей в доме"] = t
            elif field == "Этажей в доме":
                n = self.parse_int_from_text(value)
                if n and not flat_data.get("Этажей в доме"):
                    flat_data["Этажей в доме"] = n
            elif field == "Год постройки":
                yr = self.parse_int_from_text(value)
                if yr and 1800 < yr < 2100:
                    flat_data["Год постройки"] = str(yr)
            elif field == "Высота потолков":
                num = re.search(r"\d+(?:[.,]\d+)?", value)
                if num:
                    flat_data["Высота потолков"] = num.group().replace(",", ".") + " м"
            elif field == "Пассажирский лифт":
                flat_data["Пассажирский лифт"] = "да" if "лифт" in value.lower() else value
            elif not flat_data.get(field):
                val = self.normalize_text(value)
                if field == "Охрана" and re.search(r"ещё\s+\d+\s+характеристик", val, re.I):
                    continue
                if field == "Срок сдачи":
                    val = self.normalize_completion_term(val) or re.split(
                        r"\s+есть\s+", val, maxsplit=1, flags=re.I
                    )[0].strip()
                if field == "Мусоропровод" and re.search(r"нет|отсутств", val, re.I):
                    val = "нет"
                flat_data[field] = val

    def _price_per_m2_rel_diff(self, a: int | None, b: int | None) -> float:
        if a is None or b is None:
            return 0.0
        return abs(int(a) - int(b)) / max(int(b), 1)

    def reconcile_price_per_meter(self, flat_data: dict, page_text: str) -> None:
        """Цена за м²: явные значения с карточки + сверка с ценой со скидкой / площадь."""
        page_text = page_text or ""
        disc = self.extract_discounted_price(page_text)
        price = flat_data.get("Цена")
        if disc:
            flat_data["Цена"] = disc
            price = disc

        computed = None
        try:
            area = flat_data.get("Общая площадь")
            if price and area and float(area) > 0:
                computed = int(round(float(price) / float(area)))
        except (TypeError, ValueError):
            pass

        candidates: list[int] = []
        candidates.extend(self.collect_price_per_m2_from_dom())
        candidates.extend(self.collect_price_per_m2_from_text(page_text))
        current = flat_data.get("Цена за метр")
        if current:
            try:
                candidates.append(int(current))
            except (TypeError, ValueError):
                pass

        chosen = self.pick_price_per_m2(candidates, computed)
        if chosen is None and computed is not None:
            chosen = computed
        if chosen is not None:
            flat_data["Цена за метр"] = chosen

    def post_process_flat_data(self, flat_data: dict, page_text: str) -> None:
        title = flat_data.get("Название") or ""
        card_text = self.get_offer_card_text()
        badges = self.collect_offer_card_badges()

        if not flat_data.get("Количество комнат"):
            rooms = (
                self.parse_rooms_from_text(title)
                or self.parse_rooms_from_text(card_text)
            )
            if rooms:
                flat_data["Количество комнат"] = rooms

        highlights = self.collect_highlight_pairs()
        self.apply_highlight_pairs(flat_data, highlights)
        self.apply_details_feature_grid(flat_data, card_text)
        self.apply_about_house_text_extras(flat_data, card_text)

        if not flat_data.get("Тип объявления"):
            flat_data["Тип объявления"] = self.infer_listing_type(
                title, card_text, flat_data, badges
            )
        if not flat_data.get("Вид сделки"):
            flat_data["Вид сделки"] = self.infer_deal_type(
                flat_data, badges, card_text
            )
        if not flat_data.get("ID объявления"):
            flat_data["ID объявления"] = self.extract_offer_id(flat_data.get("Ссылка", ""))
        jk = flat_data.get("Название новостройки") or ""
        m_jk = re.search(r"(?:МФК|ЖК)\s*«[^»]+»", jk) or re.search(
            r"(?:МФК|ЖК)\s*«[^»]+»", page_text or ""
        )
        if m_jk:
            flat_data["Название новостройки"] = m_jk.group(0).strip()
        guard = flat_data.get("Охрана") or ""
        if re.search(r"ещё\s+\d+\s+характеристик", guard, re.I) or not guard:
            blob = page_text or ""
            try:
                blob += "\n" + (self.driver.page_source or "")
            except Exception:
                pass
            m = re.search(r"Охрана\s*/\s*консьерж", blob, re.I)
            if m:
                flat_data["Охрана"] = m.group(0)
        blob = (page_text or "")
        try:
            blob += "\n" + (self.driver.page_source or "")
        except Exception:
            pass
        if not flat_data.get("Пассажирский лифт") and re.search(r"(?i)\bлифт\b", blob):
            flat_data["Пассажирский лифт"] = "да"
        if not flat_data.get("Двор"):
            if re.search(r"(?i)закрыт\w*\s+территор\w*\s+нет", blob):
                flat_data["Двор"] = "Закрытой территории нет"
            elif re.search(r"(?i)закрыт\w*\s+территор", blob):
                flat_data["Двор"] = "Закрытая территория"
        if not flat_data.get("Отопление"):
            m = re.search(r"(отоплен\w*[^.\n]{2,40})", blob, re.I)
            if m:
                flat_data["Отопление"] = self.normalize_text(m.group(1))
        pub = flat_data.get("Дата публикации") or ""
        if not pub or re.search(r"обновлен", pub, re.I) or "просмотр" not in pub.lower():
            fixed = self.extract_publication_date(page_text)
            if fixed:
                flat_data["Дата публикации"] = fixed
        self.apply_hero_and_badges(flat_data)
        features = self.collect_offer_card_feature_titles()
        self.apply_about_house_features(flat_data, features)
        if not flat_data.get("Корпус, строение"):
            corpus = self.extract_corpus_building(page_text or "", flat_data)
            if corpus:
                flat_data["Корпус, строение"] = corpus
        if not flat_data.get("Вид сделки"):
            inferred = self.infer_deal_type(flat_data, badges, card_text)
            if inferred:
                flat_data["Вид сделки"] = inferred
        if (
            flat_data.get("Тип объявления") == "вторичка"
            and (flat_data.get("Тип участия") or "").lower() in ("жск", "дду")
            and not self._has_primary_signals(flat_data, badges)
        ):
            flat_data["Тип участия"] = ""
        for polluted_field in ("Тип проекта", "Вид сделки", "Корпус, строение"):
            if is_polluted_text(flat_data.get(polluted_field) or ""):
                flat_data[polluted_field] = ""
        disc = self.extract_discounted_price(page_text or "")
        if disc:
            flat_data["Цена"] = disc
        if not flat_data.get("Срок сдачи"):
            term = self.normalize_completion_term(page_text or "")
            if term:
                flat_data["Срок сдачи"] = term
        view = flat_data.get("Окна") or ""
        if view:
            cleaned = re.sub(r"^вид\s+из\s+окон\s*", "", str(view), flags=re.I).strip()
            if cleaned:
                flat_data["Окна"] = cleaned
        self.sync_amenity_columns(flat_data)
        try:
            self.reconcile_price_per_meter(flat_data, page_text)
        except KeyboardInterrupt:
            raise
        self.apply_seller_fields(flat_data)

    def sync_amenity_columns(self, flat_data: dict) -> None:
        """Мебель/Техника/Тёплый пол из чипов «Удобства» для ETL (Мебель_есть, Техника_есть)."""
        amenities = (flat_data.get("Удобства") or "").lower()
        if not amenities:
            return
        if not flat_data.get("Мебель") and "мебель" in amenities:
            flat_data["Мебель"] = "да"
        tech_markers = (
            "холодильник",
            "стиральн",
            "посудомо",
            "кондиционер",
            "техник",
            "плит",
            "духов",
            "микроволнов",
        )
        if not flat_data.get("Техника") and any(m in amenities for m in tech_markers):
            flat_data["Техника"] = "да"
        if not flat_data.get("Тёплый пол") and "тёплый пол" in amenities:
            flat_data["Тёплый пол"] = "да"

    def extract_flat_details(self, url, link_index: int | None = None):
        """Извлекает детальную информацию о квартире (с одним повтором при мёртвой сессии)."""
        print(f"🔍 Парсим объявление: {url}")
        for attempt in (1, 2):
            if not self.ensure_driver_alive(f"перед парсингом (попытка {attempt})"):
                return {
                    "error": "Браузер недоступен — остановите парсинг, make moscow-details-flush, make moscow-details",
                    "Ссылка": url,
                }
            try:
                return self._extract_flat_details_once(url, link_index=link_index)
            except WebDriverException as e:
                if attempt == 1 and is_dead_browser_session_error(e):
                    print(
                        "⚠️  Окно Chrome закрыто (no such window). "
                        "Перезапуск браузера и повтор этой ссылки…"
                    )
                    self.recreate_driver("no such window")
                    continue
                print(f"❌ Ошибка при парсинге {url}: {e}")
                return {"error": str(e), "Ссылка": url}
            except Exception as e:
                print(f"❌ Ошибка при парсинге {url}: {e}")
                return {"error": str(e), "Ссылка": url}
        return {
            "error": "Не удалось распарсить после перезапуска браузера",
            "Ссылка": url,
        }

    def _extract_flat_details_once(self, url, link_index: int | None = None):
        """Одна попытка парсинга карточки (вызывается из extract_flat_details)."""
        try:
            # Загружаем страницу
            self.profile_delay("before_open", 600, 1400)
            self.driver.get(url)
            self.random_delay(
                self.delay_after_page_load_min,
                self.delay_after_page_load_max,
            )
            
            # Проверяем на капчу
            if self.check_for_captcha():
                print("⚠️  ОБНАРУЖЕНА КАПЧА!")
                result = self.handle_captcha(url=url, link_index=link_index)
                if result is None:  # Остановка парсинга
                    return None
                elif not result:  # Пропуск объявления (браузер уже перезапущен в handle_captcha)
                    return {"error": "Капча не решена"}
                if not self.ensure_driver_alive("после капчи"):
                    return {"error": "Браузер недоступен после капчи", "Ссылка": url}
                if not self.wait_captcha_cleared():
                    for retry in (1, 2):
                        print(
                            f"🔄 Повторная загрузка карточки ({retry}/2) после капчи…"
                        )
                        self.profile_delay("before_open", 600, 1400)
                        self.driver.get(url)
                        self.random_delay(
                            self.delay_after_page_load_min,
                            self.delay_after_page_load_max,
                        )
                        if self.wait_captcha_cleared(max_attempts=2):
                            break
                    else:
                        if self._offer_card_loaded():
                            print(
                                "ℹ️  Капча не детектируется, карточка видна — продолжаем."
                            )
                        elif self.check_for_captcha():
                            print(
                                "⚠️  Капча всё ещё на странице — пропуск объявления."
                            )
                            return {"error": "Капча не снята после решения"}
            
            flat_data = self.empty_flat_data(url)
            flat_data["ID объявления"] = self.extract_offer_id(url)
            page_text = self.get_visible_page_text()
            
            # 1. Название (краткая строка с м²) и hero-метаданные
            try:
                title_element = self.driver.find_element(By.XPATH, "//h1[contains(@class, 'title')] | //h1")
                flat_title = self.clean_title(self.extract_text_safe(title_element))
                flat_data["Название"] = flat_title
                self.apply_hero_and_badges(flat_data)
                rooms_from_title = self.parse_rooms_from_text(flat_title)
                if rooms_from_title:
                    flat_data["Количество комнат"] = rooms_from_title
                # Если общая площадь ещё не найдена — пробуем достать из заголовка (например: "33 м², 1‑комнатная квартира")
                if flat_data["Общая площадь"] is None:
                    m = re.search(r"(\d+(?:[\.,]\d+)?)\s*м²", flat_title)
                    if m:
                        try:
                            flat_data["Общая площадь"] = float(m.group(1).replace(',', '.'))
                        except:
                            pass
            except:
                pass

            # JSON-LD первичная попытка
            ld = self.parse_json_ld()
            if ld:
                if ld.get('price') and not flat_data["Цена"]:
                    flat_data["Цена"] = ld['price']
                if ld.get('area_total') and not flat_data["Общая площадь"]:
                    flat_data["Общая площадь"] = ld['area_total']
                if ld.get('rooms') and not flat_data["Количество комнат"]:
                    flat_data["Количество комнат"] = str(ld['rooms'])
                if ld.get('address'):
                    addr = self.clean_address(ld['address'])
                    if self.looks_like_address(addr):
                        flat_data["Адрес"] = addr
                if ld.get('floor') and not flat_data["Этаж"]:
                    flat_data["Этаж"] = ld['floor']
                if ld.get('floors_total') and not flat_data["Этажей в доме"]:
                    flat_data["Этажей в доме"] = ld['floors_total']
            
            # 2. Цена
            try:
                price_selectors = [
                    # Яндекс.Недвижимость специфичные селекторы
                    "//span[contains(@class, 'OfferPrice')]//span[contains(@class, 'price')]",
                    "//div[contains(@class, 'OfferPrice')]//span[contains(@class, 'price')]",
                    "//span[contains(@class, 'price') and contains(text(), '₽')]",
                    "//div[contains(@class, 'price') and contains(text(), '₽')]",
                    "//span[contains(text(), '₽') and not(contains(text(), '₽/м²'))]",
                    "//div[contains(text(), '₽') and not(contains(text(), '₽/м²'))]",
                    # Общие селекторы
                    "//span[contains(@class, 'price')]//span[contains(@class, 'value')]",
                    "//div[contains(@class, 'price')]//span[contains(@class, 'value')]",
                    "//span[contains(@class, 'price')]",
                    "//div[contains(@class, 'price')]"
                ]
                
                for selector in price_selectors:
                    try:
                        price_elements = self.driver.find_elements(By.XPATH, selector)
                        for price_element in price_elements:
                            price_text = self.extract_text_safe(price_element)
                            if price_text and '₽' in price_text and '₽/м²' not in price_text:
                                parsed_price = self.parse_price(price_text)
                                if parsed_price and parsed_price > 100000:  # Минимальная цена для квартиры
                                    flat_data["Цена"] = parsed_price
                                    print(f"💰 Найдена цена: {parsed_price} ₽")
                                    break
                        if flat_data["Цена"]:
                            break
                    except:
                        continue
            except:
                pass
            
            # 3. Цена за метр (явная в карточке; финальная сверка в post_process)
            try:
                parsed_price_meter = self.extract_price_per_m2_from_dom()
                if parsed_price_meter:
                    flat_data["Цена за метр"] = parsed_price_meter
                    print(f"📏 Найдена цена за м²: {parsed_price_meter} ₽")
            except Exception:
                pass
            
            # 4. Адрес (приоритетный каскад + защита от ложных «N д.» из экспозиции)
            if not flat_data["Адрес"]:
                flat_data["Адрес"] = self.resolve_address(page_text)
                if flat_data["Адрес"]:
                    print(f"📍 Найден адрес: {flat_data['Адрес']}")
            
            # 5. Основные характеристики
            try:
                # Ищем блок с характеристиками
                specs_selectors = [
                    # Яндекс.Недвижимость специфичные селекторы
                    "//div[contains(@class, 'OfferCard')]//div[contains(@class, 'parameters')]",
                    "//div[contains(@class, 'OfferCard')]//div[contains(@class, 'specs')]",
                    "//div[contains(@class, 'OfferCard')]//div[contains(@class, 'characteristics')]",
                    # Общие селекторы
                    "//div[contains(@class, 'specs')]",
                    "//div[contains(@class, 'parameters')]",
                    "//div[contains(@class, 'characteristics')]"
                ]
                
                for specs_selector in specs_selectors:
                    try:
                        specs_containers = self.driver.find_elements(By.XPATH, specs_selector)
                        for specs_container in specs_containers:
                            
                            # Площадь
                            area_elements = specs_container.find_elements(By.XPATH, ".//*[contains(text(), 'м²')]")
                            for area_elem in area_elements:
                                area_text = self.extract_text_safe(area_elem)
                                if "общая" in area_text.lower() or "площадь" in area_text.lower():
                                    parsed_area = self.parse_area(area_text)
                                    if parsed_area:
                                        flat_data["Общая площадь"] = parsed_area
                                        print(f"🏠 Найдена общая площадь: {parsed_area} м²")
                                elif "жилая" in area_text.lower():
                                    parsed_area = self.parse_area(area_text)
                                    if parsed_area:
                                        flat_data["Жилая площадь"] = parsed_area
                                        print(f"🛏️ Найдена жилая площадь: {parsed_area} м²")
                                elif "кухня" in area_text.lower():
                                    parsed_area = self.parse_area(area_text)
                                    if parsed_area:
                                        flat_data["Площадь кухни"] = parsed_area
                                        print(f"🍳 Найдена площадь кухни: {parsed_area} м²")
                            
                            # Этаж
                            floor_elements = specs_container.find_elements(By.XPATH, ".//*[contains(text(), 'этаж')]")
                            for floor_elem in floor_elements:
                                floor_text = self.extract_text_safe(floor_elem)
                                floor, total_floors = self.parse_floor(floor_text)
                                if floor:
                                    flat_data["Этаж"] = floor
                                    print(f"🏢 Найден этаж: {floor}")
                                if total_floors:
                                    flat_data["Этажей в доме"] = total_floors
                                    print(f"🏢 Найдено этажей в доме: {total_floors}")
                            
                            # Количество комнат
                            rooms_elements = specs_container.find_elements(By.XPATH, ".//*[contains(text(), 'комнат')]")
                            for rooms_elem in rooms_elements:
                                rooms_text = self.extract_text_safe(rooms_elem)
                                rooms_match = re.search(r'(\d+)', rooms_text)
                                if rooms_match:
                                    flat_data["Количество комнат"] = rooms_match.group(1)
                                    print(f"🚪 Найдено комнат: {rooms_match.group(1)}")
                            
                            # Если нашли хотя бы одну характеристику, выходим
                            if any([flat_data["Общая площадь"], flat_data["Этаж"], flat_data["Количество комнат"]]):
                                break
                        
                        # Если нашли характеристики, выходим из внешнего цикла
                        if any([flat_data["Общая площадь"], flat_data["Этаж"], flat_data["Количество комнат"]]):
                            break
                    except:
                        continue
            except:
                pass

            # 5.1 Дозаполнение через явные лейблы, если не нашли выше
            try:
                if flat_data["Общая площадь"] is None:
                    val = self.get_spec_value_by_label(["Общая площадь", "Площадь", "Площадь общая"])
                    flat_data["Общая площадь"] = self.parse_area(val)
                if flat_data["Жилая площадь"] is None:
                    val = self.get_spec_value_by_label(["Жилая площадь", "Площадь жилая"])
                    flat_data["Жилая площадь"] = self.parse_area(val)
                if flat_data["Площадь кухни"] is None:
                    val = self.get_spec_value_by_label(["Площадь кухни", "Кухня"])
                    flat_data["Площадь кухни"] = self.parse_area(val)
                if flat_data["Этаж"] is None or flat_data["Этажей в доме"] is None:
                    val = self.get_spec_value_by_label(["Этаж", "Этажность", "Этаж/Этажей"])
                    f, t = self.parse_floor(val)
                    if f: flat_data["Этаж"] = f
                    if t: flat_data["Этажей в доме"] = t
            except:
                pass

            # 5.2 Таблица/блок характеристик (новостройки и вторичка)
            try:
                spec_pairs = self.collect_spec_pairs()
                self.apply_spec_pairs(flat_data, spec_pairs)
                for label, keys in (
                    ("Вид сделки", ["Вид сделки", "Тип сделки"]),
                    ("Тип участия", ["Тип участия", "Участие"]),
                    ("Способ продажи", ["Способ продажи"]),
                    ("Название новостройки", ["Название новостройки", "Жилой комплекс", "ЖК"]),
                    ("Корпус, строение", ["Корпус", "Корпус, строение", "Строение"]),
                    ("Продавец", ["Продавец"]),
                    ("Тип продавца", ["Тип продавца", "Агентство"]),
                    ("Застройщик", ["Застройщик"]),
                    ("Тип проекта", ["Тип проекта", "Проект"]),
                    ("Подъезды", ["Подъезды", "Подъезд"]),
                    ("Охрана", ["Охрана", "Консьерж"]),
                ):
                    if not flat_data.get(label):
                        val = self.get_spec_value_by_label(keys)
                        if val:
                            val = self.normalize_text(val)
                            if label == "Корпус, строение" and re.search(r"этаж", val, re.I):
                                continue
                            polluted = (
                                is_seller_polluted_text(val)
                                if label in ("Продавец", "Тип продавца")
                                else is_polluted_text(val)
                            )
                            if not polluted:
                                flat_data[label] = val
            except Exception:
                pass
            
            # 6. Продавец / тип продавца (OfferCardAuthorBadge, не UserNote)
            try:
                self.apply_seller_fields(flat_data)
            except Exception:
                pass
            
            # 7. Дополнительная информация
            try:
                description_selectors = [
                    "//div[contains(@class, 'description')]",
                    "//div[contains(@class, 'text')]",
                    "//p[contains(@class, 'description')]"
                ]
                
                for selector in description_selectors:
                    try:
                        desc_element = self.driver.find_element(By.XPATH, selector)
                        description_text = self.extract_text_safe(desc_element)
                        # Чистим описание от цен/м² и сокращаем
                        description_text = re.sub(r"\d[\d\s]*₽/?м²?", " ", description_text)
                        description_text = re.sub(r"\s+", " ", description_text).strip()
                        flat_data["Дополнительно"] = description_text[:600]
                        if flat_data["Дополнительно"]:
                            break
                    except:
                        continue
            except:
                pass
            
            # 8. Геолокация (координаты)
            try:
                # Ищем координаты в мета-тегах или скриптах
                scripts = self.driver.find_elements(By.TAG_NAME, "script")
                for script in scripts:
                    script_content = self.extract_attribute_safe(script, "innerHTML")
                    if script_content:
                        # Ищем координаты в JSON
                        coord_match = re.search(r'"lat":\s*([\d.]+).*?"lng":\s*([\d.]+)', script_content)
                        if coord_match:
                            lat = coord_match.group(1)
                            lng = coord_match.group(2)
                            flat_data["Геолокация"] = f"{lat},{lng}"
                            break
                # Попытка вытащить из ссылки на Яндекс-Карты
                if not flat_data["Геолокация"]:
                    try:
                        map_link_elts = self.driver.find_elements(By.XPATH, "//a[contains(@href,'yandex.ru/maps') or contains(normalize-space(.),'На Яндекс Карты')]")
                        for a in map_link_elts:
                            href = a.get_attribute('href') or ''
                            if not href:
                                continue
                            # ищем ll=lon,lat (или pt=lon,lat)
                            m = re.search(r'[?&](?:ll|pt)=([\d\.,]+)%2C([\d\.,]+)', href)
                            if not m:
                                m = re.search(r'[?&](?:ll|pt)=([\d\.,]+),([\d\.,]+)', href)
                            if m:
                                lon = m.group(1).replace('%2C', ',').replace(',', '.')
                                lat = m.group(2).replace('%2C', ',').replace(',', '.')
                                # порядок в "ll" — lon,lat. Для CSV будем хранить lat,lon в привычном виде
                                flat_data["Геолокация"] = f"{lat},{lon}"
                                break
                    except:
                        pass
                # Попытка вытащить из src скриптов карт (ll=lon,lat)
                if not flat_data["Геолокация"]:
                    coords = self.get_geolocation_from_map_script()
                    if coords:
                        flat_data["Геолокация"] = coords
            except:
                pass
            
            # 9. Дата публикации (мета у цены, не «Обновлено» из графиков ЖК)
            try:
                flat_data["Дата публикации"] = self.extract_publication_date(page_text)
            except Exception:
                pass

            # 10. Доп. поля из карточек (год постройки / срок сдачи, потолки, санузел, балкон, окна, парковка, лифты)
            try:
                # Год постройки / Срок сдачи
                if not flat_data["Год постройки"]:
                    # Явно: блок хайлайтов с лейблом "год постройки"
                    try:
                        year_nodes = self.driver.find_elements(By.XPATH, "//div[contains(@class,'OfferCardHighlight__container')]")
                        for node in year_nodes:
                            try:
                                label = node.find_element(By.XPATH, ".//div[contains(@class,'OfferCardHighlight__label')]")
                                value = node.find_element(By.XPATH, ".//div[contains(@class,'OfferCardHighlight__value')]")
                                ltxt = self.extract_text_safe(label).lower()
                                vtxt = self.extract_text_safe(value)
                                if 'год постройки' in ltxt and vtxt:
                                    yr = self.parse_int_from_text(vtxt)
                                    if yr:
                                        flat_data["Год постройки"] = str(yr)
                                        break
                            except:
                                continue
                    except:
                        pass
                    # Фоллбек: общий поиск текста
                    if not flat_data["Год постройки"]:
                        txt = self.find_first_text(["год постройки", "Дом ", "год", "г.", "Срок сдачи"])
                        if txt and "срок" in txt.lower():
                            flat_data["Срок сдачи"] = self.normalize_completion_term(txt) or self.normalize_text(txt)
                        else:
                            year = self.parse_int_from_text(txt)
                            if year and 1800 < year < 2100:
                                flat_data["Год постройки"] = str(year)
                # Потолки
                if not flat_data["Высота потолков"]:
                    txt = self.find_first_text(["потолки", "потолок", "м потолки", "м потолок"])
                    if txt:
                        num = re.search(r"\d+(?:[\.,]\d+)?", txt)
                        if num:
                            flat_data["Высота потолков"] = num.group().replace(',', '.') + " м"
                # Санузел
                if not flat_data["Санузел"]:
                    flat_data["Санузел"] = self.find_first_text(["Санузел", "санузел", "сан.узел"]) or ""
                # Балкон/лоджия
                if not flat_data["Балкон или лоджия"]:
                    txt = self.find_first_text(["Балкон", "Лоджия", "лоджия", "балкон"])
                    flat_data["Балкон или лоджия"] = txt
                # Окна/вид
                if not flat_data["Окна"]:
                    txt = self.find_first_text(["Вид из окон", "окна во двор", "окна на улицу"])
                    flat_data["Окна"] = txt
                # Лифт
                if not flat_data["Пассажирский лифт"]:
                    txt = self.find_first_text(["Лифт", "Пассажирский лифт", "Грузовой лифт"])
                    if txt:
                        flat_data["Пассажирский лифт"] = "да" if "лифт" in txt.lower() else ""
                # Парковка / тип дома / мусоропровод — чипы «О доме»
                if not flat_data["Парковка"] or not flat_data["Тип дома"] or not flat_data["Мусоропровод"]:
                    self.apply_about_house_features(
                        flat_data, self.collect_offer_card_feature_titles()
                    )
            except:
                pass
            
            if not flat_data["Название новостройки"]:
                m = re.search(r"(?:МФК|ЖК)\s*«[^»]+»", page_text or "")
                if m:
                    flat_data["Название новостройки"] = m.group(0).strip()
                else:
                    try:
                        for el in self.driver.find_elements(
                            By.XPATH,
                            "//h2[contains(.,'ЖК') or contains(.,'МФК')]",
                        ):
                            txt = self.extract_text_safe(el)
                            m2 = re.search(r"(?:МФК|ЖК)\s*«[^»]+»", txt)
                            if m2:
                                flat_data["Название новостройки"] = m2.group(0)
                                break
                    except Exception:
                        pass

            if not page_text:
                page_text = self.get_visible_page_text()
            self.post_process_flat_data(flat_data, page_text)
            title_preview = (flat_data.get("Название") or "")[:50]
            print(f"✅ Данные извлечены: {title_preview}...")
            return flat_data
        except WebDriverException:
            raise
        except Exception as e:
            print(f"❌ Ошибка при парсинге {url}: {e}")
            return {"error": str(e), "Ссылка": url}
    
    def save_to_csv(self, data_list):
        """Сохраняет данные в CSV файл (только tmp при resume, не main)."""
        if not data_list:
            print("❌ Нет данных для сохранения")
            return

        out = Path(self.output_file)
        if out.name == "yandex_realty_details.csv" and ".tmp" not in out.name:
            raise RuntimeError(
                f"Парсер пытается писать в main CSV ({out}). "
                f"Должен быть pipeline/.tmp_details_output.csv"
            )

        # Определяем все возможные поля
        all_fields = set()
        for item in data_list:
            all_fields.update(item.keys())
        
        field_order = list(DETAILS_FIELD_ORDER)
        
        # Добавляем остальные поля
        for field in sorted(all_fields):
            if field not in field_order:
                field_order.append(field)
        
        # Сохраняем в CSV
        with open(self.output_file, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=field_order, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(data_list)
        
        print(f"💾 Данные сохранены в файл: {self.output_file}")
    
    def save_stats(self, stats):
        """Сохраняет статистику парсинга"""
        with open(self.stats_file, "w", encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    
    def run(self):
        """Основной метод запуска парсера"""
        print("🏠 Запуск парсера детальной информации Яндекс.Недвижимость")
        
        start_time = datetime.now()
        flat_data_list = []
        run_completed = False
        stats = {
            "start_time": start_time.isoformat(),
            "links_file": self.links_file,
            "output_file": self.output_file,
            "max_links": self.max_links,
            "total_links": 0,
            "processed_links": 0,
            "successful_parses": 0,
            "failed_parses": 0,
            "captcha_encounters": 0,
            "target_listings": self.target_listings,
            "initial_successful_count": self.initial_successful_count,
            "errors": []
        }
        
        try:
            # Загружаем ссылки
            links = self.load_links()
            if not links:
                print("❌ Нет ссылок для обработки")
                return
            
            stats["total_links"] = len(links)
            print(f"📄 Всего ссылок для обработки: {len(links)}")
            self.emit_status(
                {
                    "status": "running",
                    "step": "Инициализация парсинга карточек",
                    "done": self.initial_successful_count,
                    "total": self.target_listings,
                }
            )
            
            # Создаём драйвер
            self.driver = self.get_driver()
            print("🌐 Браузер запущен")
            
            # Обрабатываем каждую ссылку
            for i, link in enumerate(links, 1):
                if self.stop_requested:
                    print("🛑 Парсинг остановлен по запросу пользователя.")
                    break

                print(f"\n📊 Обрабатываем ссылку {i}/{len(links)}")
                stats["processed_links"] = i
                
                try:
                    if not self.maybe_pause_after_session_limit(i, len(links)):
                        break

                    if not self.ensure_driver_alive(f"перед ссылкой {i}/{len(links)}"):
                        print(
                            "❌ Сессия Chrome недоступна. Остановите: Ctrl+C → "
                            "make moscow-details-flush → make moscow-details"
                        )
                        break

                    flat_data = self.extract_flat_details(link, link_index=i)
                    
                    if flat_data:
                        if "error" not in flat_data:
                            flat_data_list.append(flat_data)
                            stats["successful_parses"] += 1
                            self._session_parsed_count += 1
                            if self.on_row_saved:
                                self.on_row_saved(flat_data)
                            print(f"✅ Успешно обработано: {stats['successful_parses']}")
                            total_successful = self.initial_successful_count + stats["successful_parses"]
                            stats["collected_total"] = total_successful
                            self.emit_status(
                                {
                                    "status": "running",
                                    "step": f"Карточка {i}/{len(links)}",
                                    "done": total_successful,
                                    "total": self.target_listings,
                                }
                            )
                            if self.target_listings and total_successful >= self.target_listings:
                                print(f"🎯 Достигнут лимит карточек {total_successful}/{self.target_listings}")
                                self.stop_requested = True
                        else:
                            stats["failed_parses"] += 1
                            err = flat_data.get("error", "Неизвестная ошибка")
                            print(f"❌ Ошибка: {err}")
                            if "Капча" in str(err):
                                stats["captcha_encounters"] += 1
                    else:
                        if self.stop_requested:
                            print("🛑 Парсинг остановлен (капча / выбор 3).")
                            break
                        stats["failed_parses"] += 1
                        print("❌ Не удалось извлечь данные")
                    
                    # Сохраняем промежуточные результаты каждые 10 объявлений
                    if i % 10 == 0:
                        self.save_to_csv(flat_data_list)
                        print(f"💾 Промежуточное сохранение: {len(flat_data_list)} объявлений")
                        if self.on_checkpoint:
                            self.on_checkpoint()
                            flat_data_list.clear()
                    
                    # Задержка между запросами
                    self.random_delay(
                        self.delay_between_listings_min,
                        self.delay_between_listings_max,
                    )
                    
                except WebDriverException as e:
                    error_msg = f"Ошибка при обработке {link}: {e}"
                    print(f"❌ {error_msg}")
                    stats["errors"].append(error_msg)
                    stats["failed_parses"] += 1
                    if is_dead_browser_session_error(e):
                        print(
                            "⚠️  Мёртвая сессия Chrome. Пробуем перезапуск браузера "
                            "(следующая ссылка; текущую можно перепарсить при resume)."
                        )
                        self.ensure_driver_alive("после WebDriverException в цикле run()")
                    continue
                except Exception as e:
                    error_msg = f"Ошибка при обработке {link}: {e}"
                    print(f"❌ {error_msg}")
                    stats["errors"].append(error_msg)
                    stats["failed_parses"] += 1
                    if is_dead_browser_session_error(e):
                        self.ensure_driver_alive("после ошибки сессии в цикле run()")
                    continue
            
            # Финальное сохранение
            self.save_to_csv(flat_data_list)
            run_completed = True
            stats["end_time"] = datetime.now().isoformat()
            stats["final_total_parsed"] = len(flat_data_list)
            self.save_stats(stats)
            self.emit_status(
                {
                    "status": "completed",
                    "step": "Парсинг карточек завершён",
                    "done": self.initial_successful_count + stats["successful_parses"],
                    "total": self.target_listings,
                }
            )

            print(f"\n🎉 Парсинг завершён!")
            print(f"📊 Статистика:")
            print(f"   - Всего ссылок: {stats['total_links']}")
            print(f"   - Обработано: {stats['processed_links']}")
            print(f"   - Успешно: {stats['successful_parses']}")
            print(f"   - Ошибок: {stats['failed_parses']}")
            print(f"   - Время работы: {datetime.now() - start_time}")
            print(f"💾 Результаты сохранены в: {self.output_file}")
            print(f"📈 Статистика сохранена в: {self.stats_file}")
            
        except KeyboardInterrupt:
            print(
                "\n⏸️  Прервано (Ctrl+C). Сохраняем накопленные данные в tmp; "
                "merge в основной CSV выполнит run_details (защита от потери датасета)."
            )
        except Exception as e:
            hint = chromedriver_startup_hint(e)
            error_msg = f"💥 Критическая ошибка: {e}{hint}"
            print(error_msg)
            stats["errors"].append(error_msg)
            stats["end_time"] = datetime.now().isoformat()
            self.save_stats(stats)
            self.emit_status({"status": "failed", "step": str(e)})

        finally:
            if not run_completed and flat_data_list:
                self.save_to_csv(flat_data_list)
                print(
                    f"💾 Сохранено при прерывании: {len(flat_data_list)} объявлений "
                    f"→ {self.output_file}"
                )
                stats["end_time"] = datetime.now().isoformat()
                stats["final_total_parsed"] = len(flat_data_list)
                stats["interrupted"] = True
                self.save_stats(stats)
            if self.driver:
                print("🔒 Закрываем браузер...")
                self._safe_quit_driver()

def main():
    """Главная функция"""
    print("🏠 Парсер детальной информации Яндекс.Недвижимость")
    print("=" * 60)
    
    # Настройки
    use_proxy = input("Использовать прокси? (y/n): ").lower().startswith('y')
    proxy_url = None
    if use_proxy:
        proxy_url = input("Введите URL прокси (например, http://user:pass@proxy.ru:8080): ").strip()
    
    headless = input("Запустить в фоновом режиме? (y/n): ").lower().startswith('y')
    
    try:
        max_links_input = input("Максимальное количество ссылок (Enter для всех): ").strip()
        max_links = int(max_links_input) if max_links_input else None
    except ValueError:
        max_links = None
    
    # Создание и запуск парсера
    parser = YandexRealtyDetailsParser(
        use_proxy=use_proxy,
        proxy_url=proxy_url,
        headless=headless,
        max_links=max_links
    )
    
    parser.run()

if __name__ == "__main__":
    main() 