"""Надёжный запуск Chrome WebDriver (webdriver-manager + retry, подсказки при exit -9)."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path
from typing import Optional

from selenium import webdriver
from selenium.common.exceptions import SessionNotCreatedException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

_WDM_CHROME_ROOT = Path.home() / ".wdm" / "drivers" / "chromedriver"
_DRIVER_CRASH_MARKERS = (
    "unexpectedly exited",
    "status code was: -9",
    "status code was: 137",
    "killed",
    "sigkill",
)


def is_chromedriver_crash_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(m in msg for m in _DRIVER_CRASH_MARKERS)


def chromedriver_startup_hint(exc: BaseException) -> str:
    """Подсказка для macOS, когда chromedriver убит сразу после старта (SIGKILL / -9)."""
    if not is_chromedriver_crash_error(exc):
        return ""
    return (
        "\n\n💡 ChromeDriver завершился с кодом -9 (SIGKILL). Частые причины на macOS:\n"
        "   • битый кэш webdriver-manager (~/.wdm/drivers/chromedriver);\n"
        "   • quarantine / Gatekeeper на скачанном chromedriver;\n"
        "   • несовместимый chromedriver в PATH (например Homebrew 135 при Chrome 148).\n"
        "   Попробуйте:\n"
        "   1) Закрыть все окна Google Chrome\n"
        "   2) rm -rf ~/.wdm/drivers/chromedriver\n"
        "   3) cd Kursach3 && ./venv/bin/python -c \"from webdriver_manager.chrome import ChromeDriverManager; "
        "p=ChromeDriverManager().install(); import subprocess; subprocess.run(['xattr','-cr',p])\"\n"
        "   4) Проверка: ~/.wdm/.../chromedriver --version\n"
        "   5) При необходимости: xattr -d com.apple.quarantine <путь к chromedriver>\n"
        "   6) Удалить устаревший драйвер: brew uninstall chromedriver (если установлен)\n"
        "   7) make moscow-test-offer — smoke одной карточки"
    )


def _clear_wdm_chromedriver_cache() -> None:
    if _WDM_CHROME_ROOT.exists():
        shutil.rmtree(_WDM_CHROME_ROOT, ignore_errors=True)


def _prepare_chromedriver_binary(path: str) -> None:
    p = Path(path)
    if not p.is_file():
        return
    mode = p.stat().st_mode
    p.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    subprocess.run(["xattr", "-cr", str(p)], capture_output=True, check=False)


def _verify_chromedriver_binary(path: str, timeout: float = 15.0) -> None:
    result = subprocess.run(
        [path, "--version"],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode in (-9, 137) or (result.returncode is not None and result.returncode > 128):
        raise WebDriverException(
            f"chromedriver --version завершился с кодом {result.returncode} "
            f"(возможен SIGKILL / -9). stderr: {result.stderr.strip()}"
        )
    if result.returncode != 0:
        raise WebDriverException(
            f"chromedriver --version failed (code {result.returncode}): {result.stderr.strip()}"
        )


def _resolve_chromedriver_path(*, refresh_cache: bool = False) -> str:
    if refresh_cache:
        _clear_wdm_chromedriver_cache()
    path = ChromeDriverManager().install()
    _prepare_chromedriver_binary(path)
    _verify_chromedriver_binary(path)
    return path


def _path_without_chromedriver() -> str:
    parts = os.environ.get("PATH", "").split(os.pathsep)
    kept: list[str] = []
    for directory in parts:
        if directory and shutil.which("chromedriver", path=directory):
            continue
        kept.append(directory)
    return os.pathsep.join(kept)


def create_chrome_driver(
    options: Options,
    *,
    max_attempts: int = 3,
    use_selenium_manager_fallback: bool = True,
) -> webdriver.Chrome:
    """
    Создаёт Chrome WebDriver с повторными попытками при падении chromedriver на старте.
    """
    last_error: Optional[BaseException] = None

    for attempt in range(1, max_attempts + 1):
        refresh = attempt > 1
        try:
            driver_path = _resolve_chromedriver_path(refresh_cache=refresh)
            if refresh:
                print("🔄 Повторная установка ChromeDriver (очищен кэш ~/.wdm)")
            return webdriver.Chrome(service=Service(driver_path), options=options)
        except (WebDriverException, SessionNotCreatedException, OSError) as exc:
            last_error = exc
            if attempt < max_attempts and is_chromedriver_crash_error(exc):
                print(f"⚠️ ChromeDriver не стартовал (попытка {attempt}/{max_attempts}), повтор...")
                continue
            break

    if use_selenium_manager_fallback and last_error is not None:
        try:
            print("🔄 Fallback: Selenium Manager (без chromedriver из PATH)...")
            old_path = os.environ.get("PATH")
            os.environ["PATH"] = _path_without_chromedriver()
            try:
                return webdriver.Chrome(service=Service(), options=options)
            finally:
                if old_path is None:
                    os.environ.pop("PATH", None)
                else:
                    os.environ["PATH"] = old_path
        except (WebDriverException, SessionNotCreatedException, OSError) as exc:
            last_error = exc

    hint = chromedriver_startup_hint(last_error) if last_error else ""
    raise WebDriverException(f"{last_error}{hint}") from last_error
