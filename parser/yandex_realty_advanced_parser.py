from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from pipeline.chrome_driver import create_chrome_driver
from selenium.webdriver.support import expected_conditions as EC
import time
import os
import sys
import random
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

BASE_URL = os.getenv("YANDEX_REALTY_BASE_URL", "https://realty.yandex.ru/saratov/kupit/kvartira/odnokomnatnaya/")

class YandexRealtyParser:
    def __init__(
        self,
        use_proxy=False,
        proxy_url=None,
        headless=True,
        max_pages=20,
        target_listings=None,
        min_delay_ms=1200,
        max_delay_ms=2800,
        captcha_auto_wait_seconds=120,
        request_delays_ms=None,
    ):
        self.use_proxy = use_proxy
        self.proxy_url = proxy_url
        self.headless = headless
        self.max_pages = max_pages
        self.target_listings = target_listings if target_listings and target_listings > 0 else None
        self.min_delay_ms = max(0, int(min_delay_ms))
        self.max_delay_ms = max(self.min_delay_ms, int(max_delay_ms))
        self.captcha_auto_wait_seconds = captcha_auto_wait_seconds
        self.request_delays_ms = request_delays_ms or {}
        self.interactive = sys.stdin.isatty()
        self.driver = None
        self.links_file = "yandex_realty_links.txt"
        self.stats_file = "parsing_stats.json"
        self.on_status_update = None
        self.should_resume = lambda: False
        
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
    
    def random_delay(self, min_seconds=2, max_seconds=5):
        """Случайная задержка"""
        min_seconds = max(min_seconds, self.min_delay_ms / 1000.0)
        max_seconds = max(max_seconds, self.max_delay_ms / 1000.0, min_seconds)
        time.sleep(random.uniform(min_seconds, max_seconds))

    def profile_delay(self, key, fallback_min_ms, fallback_max_ms):
        low = int(self.request_delays_ms.get(f"{key}_min", fallback_min_ms)) / 1000
        high = int(self.request_delays_ms.get(f"{key}_max", fallback_max_ms)) / 1000
        if high < low:
            low, high = high, low
        self.random_delay(low, high)

    def emit_status(self, payload):
        if self.on_status_update:
            try:
                self.on_status_update(payload)
            except Exception:
                pass
    
    def human_like_scroll(self):
        """Человекоподобная прокрутка страницы"""
        print("📜 Выполняем человекоподобную прокрутку...")
        
        # Прокрутка вниз с паузами
        for i in range(random.randint(3, 6)):
            scroll_amount = random.randint(300, 800)
            self.driver.execute_script(f"window.scrollBy(0, {scroll_amount});")
            self.profile_delay("scroll", 700, 1800)
        
        # Прокрутка вверх немного
        self.driver.execute_script("window.scrollBy(0, -200);")
        self.profile_delay("scroll", 700, 1800)
        
        # Прокрутка в самый низ
        self.driver.find_element(By.TAG_NAME, "body").send_keys(Keys.END)
        self.profile_delay("scroll", 900, 2200)
    
    def check_for_captcha(self):
        """Проверяет наличие капчи на странице"""
        captcha_indicators = [
            "//*[contains(text(), 'Подтвердите, что запросы')]",
            "//*[contains(text(), 'робот')]",
            "//*[contains(text(), 'SmartCaptcha')]",
            "//*[contains(text(), 'Я не робот')]",
            "//iframe[contains(@src, 'captcha')]",
            "//div[contains(@class, 'captcha')]"
        ]
        
        for indicator in captcha_indicators:
            try:
                elements = self.driver.find_elements(By.XPATH, indicator)
                if elements:
                    print("⚠️ ОБНАРУЖЕНА КАПЧА!")
                    return True
            except:
                continue
        
        return False
    
    def handle_captcha(self):
        """Обработка капчи"""
        print("PARSER_PROGRESS_STATUS:captcha_required")
        self.emit_status({"status": "captcha_required", "step": "Обнаружена капча"})
        if self.headless:
            current_url = self.driver.current_url if self.driver else None
            print("🔁 Капча в headless: перезапускаем Chrome в режиме с окном.")
            self.headless = False
            try:
                if self.driver:
                    self.driver.quit()
            except Exception:
                pass
            self.driver = self.get_driver()
            if current_url:
                self.driver.get(current_url)
                self.profile_delay("navigation", 2500, 5000)
        print("🛡️ Обнаружена капча! Выберите действие:")
        print("1. Решить капчу вручную и продолжить")
        print("2. Пропустить страницу")
        print("3. Остановить парсинг")
        if not self.interactive:
            print("⏸️ Неживой stdin: ждём ручного прохождения капчи в браузере.")
            self.emit_status({"status": "waiting_user", "step": "Ожидание решения капчи"})
            started = time.time()
            while True:
                if self.should_resume and self.should_resume():
                    print("▶️ Получен сигнал продолжения из UI.")
                if not self.check_for_captcha():
                    self.emit_status({"status": "running", "step": "Капча решена, продолжаем"})
                    return True
                if time.time() - started >= self.captcha_auto_wait_seconds:
                    self.emit_status({"status": "waiting_user", "step": "Капча не решена, ожидание пользователя"})
                time.sleep(3)
        
        while True:
            choice = input("Введите номер действия (1-3): ").strip()
            
            if choice == "1":
                print("PARSER_PROGRESS_STATUS:waiting_user")
                self.emit_status({"status": "waiting_user", "step": "Ожидание решения капчи"})
                print("⏸️ Ожидаем решения капчи...")
                input("Нажмите Enter после решения капчи...")
                print("PARSER_PROGRESS_STATUS:running")
                self.emit_status({"status": "running", "step": "Капча решена"})
                return True
            elif choice == "2":
                print("⏭️ Пропускаем страницу...")
                return False
            elif choice == "3":
                print("🛑 Останавливаем парсинг...")
                return None
            else:
                print("❌ Неверный выбор. Попробуйте снова.")
    
    def load_existing_links(self):
        """Загружает уже собранные ссылки"""
        all_links = set()
        if os.path.exists(self.links_file):
            with open(self.links_file, "r", encoding='utf-8') as f:
                existing_links = [line.strip() for line in f if line.strip()]
                all_links.update(existing_links)
                print(f"📂 Загружено {len(existing_links)} уже собранных ссылок")
        return all_links
    
    def save_links(self, links):
        """Сохраняет ссылки в файл"""
        path = Path(self.links_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding='utf-8') as f:
            for link in sorted(links):
                f.write(link + "\n")
    
    def save_stats(self, stats):
        """Сохраняет статистику парсинга"""
        path = Path(self.stats_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
    
    def get_page_from_url(self, url=None):
        """Возвращает номер страницы из URL (?page=N), по умолчанию 1."""
        url = url or self.driver.current_url
        match = re.search(r"[?&]page=(\d+)", url)
        return int(match.group(1)) if match else 1

    def build_page_url(self, page_num):
        """Собирает URL страницы выдачи для текущего сегмента."""
        base = BASE_URL.rstrip("/")
        if page_num <= 1:
            return base + "/"
        if "?" in base:
            return f"{base}&page={page_num}"
        return f"{base}/?page={page_num}"

    def page_navigation_succeeded(self, before_url, expected_page):
        """Проверяет, что браузер действительно перешёл на нужную страницу."""
        after_url = self.driver.current_url
        actual_page = self.get_page_from_url(after_url)
        if actual_page != expected_page:
            print(
                f"⚠️ Ожидали page={expected_page}, в URL page={actual_page} "
                f"({after_url})"
            )
            return False
        if after_url == before_url and expected_page > 1:
            print("⚠️ URL не изменился после перехода")
            return False
        return True

    def find_offer_links(self):
        """Ищет ссылки на объявления на текущей странице"""
        links = []

        # Сначала карточки выдачи, затем общий fallback
        selectors = [
            "//li[contains(@class, 'OffersSerpItem')]//a[contains(@href, '/offer/')]",
            "//a[contains(@href, '/offer/')]",
            "//a[contains(@href, 'realty.yandex.ru/offer/')]",
        ]

        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.XPATH, selector)
                for element in elements:
                    href = element.get_attribute("href")
                    if href and "/offer/" in href:
                        clean_link = href.split("?")[0]
                        if clean_link not in links:
                            links.append(clean_link)
            except Exception:
                continue

            if links:
                break

        return list(set(links))
    
    def find_next_page_button(self, current_page):
        """Ищет кнопку для перехода на следующую страницу"""
        next_page = current_page + 1

        selectors = [
            f"//div[contains(@class, 'Pager')]//a[contains(@class, 'Pager__radio-link') and contains(@href, 'page={next_page}')]",
            f"//a[contains(@class, 'Pager__radio-link') and contains(@href, 'page={next_page}')]",
            f"//div[contains(@class, 'Pager')]//a[contains(@class, 'Pager__radio-link') and normalize-space(text())='{next_page}']",
            f"//a[text()='{next_page}']",
            f"//a[contains(@href, 'page={next_page}')]",
            "//div[contains(@class, 'Pager')]//a[contains(@class, 'Pager__radio-link') and contains(normalize-space(.), 'Следующая')]",
            "//div[contains(@class, 'Pager')]//a[contains(@class, 'Pager__radio-link') and contains(normalize-space(.), 'След')]",
        ]

        for selector in selectors:
            try:
                elements = self.driver.find_elements(By.XPATH, selector)
                for element in elements:
                    if not element.is_displayed():
                        continue
                    href = element.get_attribute("href") or ""
                    text = element.text.strip()
                    if f"page={next_page}" in href or text == str(next_page):
                        return element
                    if "След" in text and href and "page=" in href:
                        return element
            except Exception:
                continue

        return None
    
    def navigate_to_next_page(self, current_page):
        """Переходит на следующую страницу"""
        next_page = current_page + 1
        before_url = self.driver.current_url

        print(f"🔄 Пробуем перейти на страницу {next_page}...")

        # Метод 1: прямой переход по URL
        try:
            next_url = self.build_page_url(next_page)
            print(f"🔗 Прямой переход: {next_url}")
            self.driver.get(next_url)
            self.profile_delay("navigation", 2500, 5000)

            if self.page_navigation_succeeded(before_url, next_page):
                print(f"✅ Прямой переход на страницу {next_page} успешен")
                return True
        except Exception as e:
            print(f"❌ Ошибка при прямом переходе: {e}")

        # Метод 2: клик по кнопке пагинации
        try:
            next_button = self.find_next_page_button(current_page)

            if next_button:
                print("🖱️ Найдена кнопка пагинации, пробуем клик...")
                before_url = self.driver.current_url

                self.driver.execute_script(
                    "arguments[0].scrollIntoView({block: 'center'});", next_button
                )
                self.profile_delay("pagination_click", 900, 2200)

                wait = WebDriverWait(self.driver, 10)
                wait.until(EC.element_to_be_clickable(next_button))

                clicked = False
                for click_fn in (
                    lambda: next_button.click(),
                    lambda: self.driver.execute_script("arguments[0].click();", next_button),
                ):
                    try:
                        click_fn()
                        clicked = True
                        break
                    except Exception as e:
                        print(f"⚠️ Клик не сработал: {e}")

                if clicked:
                    self.profile_delay("navigation", 2500, 5000)
                    if self.page_navigation_succeeded(before_url, next_page):
                        print(f"✅ Переход на страницу {next_page} через пагинацию успешен")
                        return True

                href = next_button.get_attribute("href")
                if href and f"page={next_page}" in href:
                    print(f"🔗 Переход по href: {href}")
                    before_url = self.driver.current_url
                    self.driver.get(urljoin("https://realty.yandex.ru", href))
                    self.profile_delay("navigation", 2500, 5000)
                    if self.page_navigation_succeeded(before_url, next_page):
                        return True
            else:
                print("❌ Кнопка пагинации для следующей страницы не найдена")
        except Exception as e:
            print(f"❌ Ошибка при работе с кнопкой пагинации: {e}")

        actual_page = self.get_page_from_url()
        print(
            f"❌ Не удалось перейти на страницу {next_page} "
            f"(текущая page={actual_page}, URL: {self.driver.current_url})"
        )
        return False
    
    def parse_page(self, page_num, all_links):
        """Парсит одну страницу"""
        print(f"\n📄 Парсим страницу {page_num}")
        
        # Проверяем на капчу
        if self.check_for_captcha():
            result = self.handle_captcha()
            if result is None:  # Остановка парсинга
                return False, all_links, 0
            elif not result:  # Пропуск страницы
                return True, all_links, 0
        
        # Человекоподобная прокрутка
        self.human_like_scroll()
        
        # Ищем ссылки на объявления
        print("🔍 Ищем ссылки на объявления...")
        page_links = self.find_offer_links()
        found_count = len(page_links)
        print(f"🏠 На странице найдено {found_count} ссылок на объявления")

        # Добавляем новые ссылки
        new_links_count = 0
        for link in page_links:
            if link not in all_links:
                all_links.add(link)
                new_links_count += 1
                print(f"✅ Новая ссылка: {link}")
                if self.target_listings and len(all_links) >= self.target_listings:
                    print(f"🎯 Лимит ссылок достигнут внутри страницы: {len(all_links)}/{self.target_listings}")
                    break

        duplicate_count = found_count - new_links_count
        url_page = self.get_page_from_url()
        print(
            f"📊 Страница {page_num} (URL page={url_page}): "
            f"найдено {found_count}, новых {new_links_count}, дубликатов {duplicate_count}"
        )
        
        # Сохраняем промежуточные результаты
        if new_links_count > 0:
            self.save_links(all_links)
        
        return True, all_links, new_links_count
    
    def run(self):
        """Основной метод запуска парсера"""
        print("🚀 Запуск парсера Яндекс.Недвижимость")
        print(f"🎯 Целевой URL: {BASE_URL}")
        print(f"📄 Максимальное количество страниц: {self.max_pages}")
        
        start_time = datetime.now()
        stats = {
            "start_time": start_time.isoformat(),
            "base_url": BASE_URL,
            "max_pages": self.max_pages,
            "pages_parsed": 0,
            "total_links": 0,
            "new_links": 0,
            "captcha_encounters": 0,
            "errors": []
        }
        
        try:
            self.driver = self.get_driver()
            print("🌐 Браузер запущен")
            
            # Загружаем страницу
            self.driver.get(BASE_URL)
            print(f"📄 Страница загружена: {self.driver.current_url}")
            
            # Проверяем на капчу на первой странице
            if self.check_for_captcha():
                result = self.handle_captcha()
                if result is None:
                    return
                elif not result:
                    print("❌ Не удалось пройти капчу на первой странице")
                    return
            
            # Загружаем уже собранные ссылки
            all_links = self.load_existing_links()
            initial_links_count = len(all_links)
            
            # Парсим страницы
            page = 1
            empty_pages_in_row = 0
            while page <= self.max_pages:
                success, all_links, new_links_count = self.parse_page(page, all_links)
                
                if not success:
                    print("🛑 Парсинг остановлен")
                    break
                
                stats["pages_parsed"] = page
                stats["total_links"] = len(all_links)
                stats["new_links"] = len(all_links) - initial_links_count
                self.emit_status(
                    {
                        "status": "running",
                        "step": f"Страница {page}/{self.max_pages}",
                        "done": len(all_links),
                        "total": self.target_listings,
                    }
                )
                if self.target_listings and len(all_links) >= self.target_listings:
                    print(f"✅ Достигнут лимит ссылок {self.target_listings}, завершаем.")
                    break

                if new_links_count == 0:
                    empty_pages_in_row += 1
                    if empty_pages_in_row >= 3:
                        print(
                            f"⏹️ Три страницы подряд без новых ссылок — "
                            f"завершаем сегмент (вероятно, конец выдачи или дубликаты)"
                        )
                        break
                else:
                    empty_pages_in_row = 0
                
                # Переход на следующую страницу
                if page < self.max_pages:
                    if not self.navigate_to_next_page(page):
                        print(f"⏹️ Достигнут конец выдачи сегмента (после страницы {page})")
                        break
                
                page += 1
                self.profile_delay("between_pages", 4500, 9000)  # Задержка между страницами
            
            # Финальное сохранение
            self.save_links(all_links)
            stats["end_time"] = datetime.now().isoformat()
            stats["final_total_links"] = len(all_links)
            self.save_stats(stats)
            self.emit_status(
                {
                    "status": "completed",
                    "step": "Сбор ссылок завершен",
                    "done": len(all_links),
                    "total": self.target_listings,
                }
            )
            
            print(f"\n🎉 Парсинг завершён!")
            print(f"📊 Статистика:")
            print(f"   - Обработано страниц: {stats['pages_parsed']}")
            print(f"   - Всего ссылок: {len(all_links)}")
            print(f"   - Новых ссылок: {stats['new_links']}")
            print(f"   - Время работы: {datetime.now() - start_time}")
            print(f"💾 Результаты сохранены в: {self.links_file}")
            print(f"📈 Статистика сохранена в: {self.stats_file}")
            
        except Exception as e:
            error_msg = f"💥 Критическая ошибка: {e}"
            print(error_msg)
            stats["errors"].append(error_msg)
            stats["end_time"] = datetime.now().isoformat()
            self.save_stats(stats)
            self.emit_status({"status": "failed", "step": str(e)})
            
        finally:
            if self.driver:
                print("🔒 Закрываем браузер...")
                self.driver.quit()

def main():
    """Главная функция"""
    print("🏠 Парсер Яндекс.Недвижимость")
    print("=" * 50)
    
    # Настройки
    use_proxy = input("Использовать прокси? (y/n): ").lower().startswith('y')
    proxy_url = None
    if use_proxy:
        proxy_url = input("Введите URL прокси (например, http://user:pass@proxy.ru:8080): ").strip()
    
    headless = input("Запустить в фоновом режиме? (y/n): ").lower().startswith('y')
    
    try:
        max_pages = int(input("Максимальное количество страниц (по умолчанию 20): ") or "20")
    except ValueError:
        max_pages = 20
    
    # Создание и запуск парсера
    parser = YandexRealtyParser(
        use_proxy=use_proxy,
        proxy_url=proxy_url,
        headless=headless,
        max_pages=max_pages
    )
    
    parser.run()

if __name__ == "__main__":
    main() 