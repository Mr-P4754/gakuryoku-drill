#!/usr/bin/env python3
"""
Playwright を用いた SPA 総合 E2E テスト & 画面スクリーンショット取得スクリプト
"""
import json
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOT_DIR = Path("/tmp/e2e_shots")
SHOT_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_server():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, port


def run_e2e():
    server, port = start_server()
    base_url = f"http://127.0.0.1:{port}"
    console_errors = []
    failed_requests = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 860})
        page = context.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))
        page.on("response", lambda res: failed_requests.append(f"{res.status} {res.url}") if res.status >= 400 and base_url in res.url else None)

        # 1. 初回アクセス＆プロフィール登録バリデーション確認
        page.goto(base_url, wait_until="networkidle")
        page.wait_for_selector("#profile-modal:not(.hidden)")
        page.fill("#prof-school", "さくら小")
        page.click("#profile-form button[type='submit']")
        page.wait_for_selector("#prof-school-error:not(.hidden)")

        page.fill("#prof-school", "Sakura")
        page.select_option("#prof-class", "2組")
        page.select_option("#prof-number", "15")
        page.click("#profile-form button[type='submit']")
        page.wait_for_selector("#profile-modal.hidden", state="attached")

        badge = page.text_content("#profile-badge-text")
        assert "sakura" in badge and "2組" in badge and "15番" in badge, f"Unexpected badge: {badge}"
        page.screenshot(path=str(SHOT_DIR / "01_home.png"))
        print("[E2E] Home + Profile OK:", badge)

        # 2. 国語：縦書き長文読解 + 漢字手書き自己採点
        page.goto(f"{base_url}/#drill?grade=4年&subject=kokugo&unit=P5JA1_009", wait_until="networkidle")
        page.wait_for_selector(".context-text.is-vertical")
        page.screenshot(path=str(SHOT_DIR / "02_kokugo_vertical.png"))
        print("[E2E] Kokugo vertical reading OK")

        page.goto(f"{base_url}/#drill?grade=4年&subject=kokugo&unit=P5JA1_002", wait_until="networkidle")
        page.wait_for_selector(".kanji-pad-box")
        page.click(".reveal-self-btn")
        page.wait_for_selector(".model-kanji-display")
        page.screenshot(path=str(SHOT_DIR / "03_kokugo_kanji.png"))
        page.click(".self-ok-btn")
        page.wait_for_selector(".feedback-area.is-correct")
        print("[E2E] Kokugo kanji self-check OK")

        # 3. 社会：地図SVG + ズームライトボックス
        page.goto(f"{base_url}/#drill?grade=4年&subject=shakai&unit=P5SH1_001", wait_until="networkidle")
        page.wait_for_selector(".problem-figure")
        page.screenshot(path=str(SHOT_DIR / "04_shakai_map.png"))
        page.click(".problem-figure")
        page.wait_for_selector("#lightbox-modal:not(.hidden)")
        page.click("#lightbox-modal [data-close-modal]")
        print("[E2E] Shakai map & lightbox OK")

        # 4. 算数：分数入力 + 方眼作図オーバーレイ + 計算メモ帳
        page.goto(f"{base_url}/#drill?grade=4年&subject=sansu&unit=P5MA1_016", wait_until="networkidle")
        page.wait_for_selector(".fraction-box")
        page.screenshot(path=str(SHOT_DIR / "05_sansu_fraction.png"))

        page.goto(f"{base_url}/#drill?grade=4年&subject=sansu&unit=P5MA1_023", wait_until="networkidle")
        page.wait_for_selector(".draw-stage")
        page.click(".reveal-self-btn")
        page.wait_for_selector(".draw-overlay-img:not(.hidden)")
        page.screenshot(path=str(SHOT_DIR / "06_sansu_draw_overlay.png"))
        print("[E2E] Sansu fraction & draw overlay OK")

        # 5. 理科：語群穴埋め + 実験SVG + 1単元完走＆結果画面
        page.goto(f"{base_url}/#drill?grade=4年&subject=rika&unit=P5RI1_020", wait_until="networkidle")
        page.wait_for_selector(".wb-chips")
        page.screenshot(path=str(SHOT_DIR / "07_rika_wordbank.png"))

        # 単元を最後まで回答して結果画面へ
        for _ in range(30):
            if page.locator(".result-hero-card").count() > 0:
                break
            if page.locator(".wb-chip").count() > 0:
                slots = page.locator(".wb-slot-btn").count()
                for _s in range(slots):
                    page.locator(".wb-chip").first.click()
                page.click("#check-answer-btn")
            elif page.locator(".choice-btn").count() > 0:
                page.locator(".choice-btn").first.click()
                page.click("#check-answer-btn")
            elif page.locator(".reveal-self-btn").count() > 0:
                page.click(".reveal-self-btn")
                page.click(".self-ok-btn")
            else:
                for inp in page.locator(".drill-input").all():
                    inp.fill("1")
                page.click("#check-answer-btn")
            page.wait_for_selector("#next-question-btn")
            page.click("#next-question-btn")
            page.wait_for_timeout(120)

        page.wait_for_selector(".result-hero-card")
        page.screenshot(path=str(SHOT_DIR / "08_result.png"))
        queue_json = page.evaluate("localStorage.getItem('gakuryoku_log_queue_v1')")
        queue = json.loads(queue_json or "[]")
        assert len(queue) >= 1 and queue[-1]["school_code"] == "sakura", f"Log queue invalid: {queue}"
        print("[E2E] Result screen & score queue OK:", queue[-1]["unit_name"], queue[-1]["school_code"])

        # 6. モバイル幅確認 (390x844)
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{base_url}/#home", wait_until="networkidle")
        page.screenshot(path=str(SHOT_DIR / "09_mobile_home.png"))

        browser.close()

    server.shutdown()

    if failed_requests:
        print("[FAIL] Failed HTTP requests:", failed_requests)
        return 1
    if console_errors:
        print("[FAIL] Console errors:", console_errors)
        return 1
    print("\n[SUCCESS] Full E2E test passed with 0 errors and 0 404s!")
    return 0


if __name__ == "__main__":
    sys.exit(run_e2e())
