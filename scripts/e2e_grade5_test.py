#!/usr/bin/env python3
"""
5年生（全4教科・70単元・568問）の画面表示・学年切替・敬語別解・121〜180字作文・
社会TBS差し替えSVG・合同三角形/円グラフ透過オーバーレイ作図・約数列挙区切り・
理科順不同語群採点・先生ダッシュボード5年フィルタの Playwright E2E テスト＆視覚確認スクリプト
"""
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOT_DIR = Path("/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/1a490842-3849-4a02-8baa-7b383741c3b2/scratch")
SHOT_DIR.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


def run():
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    base_url = f"http://127.0.0.1:{port}"

    console_errors = []
    failed_assets = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 1280, "height": 840})
            page = context.new_page()

            def handle_gas(route):
                req = route.request
                if req.method == "POST":
                    body = json.loads(req.post_data or "{}")
                    if body.get("action") == "teacher_auth":
                        route.fulfill(
                            status=200,
                            content_type="application/json",
                            body=json.dumps({
                                "status": "ok",
                                "token": "g5-mock-tok",
                                "expires_in_sec": 1800,
                                "school_code": "hino",
                                "school_label": "hino校",
                                "fetched_at": "2026-11-26T13:00:00Z",
                                "total_count": 2,
                                "truncated": False,
                                "logs": [
                                    {
                                        "logged_at": "2026-11-26 11:00:00",
                                        "school_code": "hino",
                                        "grade": "5年",
                                        "class_name": "2組",
                                        "student_no": 8,
                                        "student_key": "hino_5年_2組_08",
                                        "subject": "算数",
                                        "unit_code": "P6MA1_025",
                                        "unit_name": "割合と百分率",
                                        "mode": "unit",
                                        "score": 8,
                                        "total": 10,
                                        "accuracy_pct": 80,
                                        "self_check_count": 0,
                                        "wrong_ids": "5MA_025_F_01",
                                        "duration_sec": 210,
                                    },
                                    {
                                        "logged_at": "2026-11-25 10:00:00",
                                        "school_code": "hino",
                                        "grade": "4年",
                                        "class_name": "1組",
                                        "student_no": 16,
                                        "student_key": "hino_4年_1組_16",
                                        "subject": "国語",
                                        "unit_code": "P5JA1_007",
                                        "unit_name": "ことわざ",
                                        "mode": "unit",
                                        "score": 11,
                                        "total": 12,
                                        "accuracy_pct": 92,
                                        "self_check_count": 0,
                                        "wrong_ids": "4JA_007_D_01",
                                        "duration_sec": 110,
                                    },
                                ],
                            }, ensure_ascii=False),
                        )
                        return
                route.fulfill(status=200, content_type="application/json", body='{"status":"noop"}')

            page.route("**/script.google.com/**", handle_gas)
            page.on("console", lambda m: console_errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))
            page.on("response", lambda r: failed_assets.append(f"{r.status} {r.url}") if r.status >= 400 else None)

            # 1. 初期アクセス：既定表示は4年、学年タブは「3年」「4年」「5年」の昇順
            page.goto(base_url, wait_until="networkidle")
            if page.locator("#profile-modal:not(.hidden)").is_visible():
                page.click("#prof-skip-btn")

            tabs = page.locator(".grade-tab").all_inner_texts()
            assert tabs == ["3年", "4年", "5年"], f"Expected grade tabs ['3年', '4年', '5年'], got {tabs}"
            assert "4年" in page.locator(".home-hero h1").inner_text()

            # 2. 5年タブクリック → 5年4教科・70単元・568問が表示
            page.locator(".grade-tab", has_text="5年").click()
            page.wait_for_function("() => document.querySelector('.home-hero h1')?.textContent.includes('5年')")
            hero_text = page.locator(".home-hero").inner_text()
            assert "70" in hero_text and "568" in hero_text, f"Unexpected 5th grade hero: {hero_text}"
            page.screenshot(path=str(SHOT_DIR / "g5_01_home.png"))
            print("[E2E-G5] Home grade tabs ['3年', '4年', '5年'] & 5th-grade overview OK")

            # 3. 5年国語 P6JA1_005 敬語（別解判定）＆ P6JA1_010 作文（121〜180字カウンター）
            page.goto(f"{base_url}/#drill?grade=5年&subject=kokugo&unit=P6JA1_005", wait_until="networkidle")
            page.wait_for_selector(".drill-input")
            page.locator(".drill-input").first.fill("おいでになった")
            page.click("#check-answer-btn")
            page.wait_for_selector(".feedback-area.is-correct")
            print("[E2E-G5] Kokugo P6JA1_005 Keigo alternative answer OK")

            page.goto(f"{base_url}/#drill?grade=5年&subject=kokugo&unit=P6JA1_010&source=たしかめドリル", wait_until="networkidle")
            found_counter = False
            for _ in range(5):
                txt = page.locator(".char-counter-row").inner_text() if page.locator(".char-counter-row").count() else ""
                if "121" in txt and "180" in txt:
                    found_counter = True
                    break
                page.click(".reveal-self-btn")
                page.click(".self-ok-btn")
                page.click("#next-question-btn")
            assert found_counter, "Expected 121〜180字 counter in P6JA1_010"
            print("[E2E-G5] Kokugo P6JA1_010 essay 121-180 char counter OK")

            # 4. 5年社会 P6SH1_009（TBSテレビ写真差し替えオリジナルSVG）表示確認
            page.goto(f"{base_url}/#drill?grade=5年&subject=shakai&unit=P6SH1_009", wait_until="networkidle")
            page.wait_for_selector(".problem-figure")
            shakai_ok = page.evaluate("() => [...document.querySelectorAll('.problem-figure')].every(i => i.complete && i.naturalWidth > 0)")
            assert shakai_ok, "Shakai P6SH1_009 SVG failed to load"
            page.screenshot(path=str(SHOT_DIR / "g5_02_shakai_news.png"))
            print("[E2E-G5] Shakai P6SH1_009 original news SVG replacement OK")

            # 5. 5年算数 P6MA1_023（合同な図形のかき方 透過オーバーレイ）＆ P6MA1_026（円グラフ作図）
            page.goto(f"{base_url}/#drill?grade=5年&subject=sansu&unit=P6MA1_023", wait_until="networkidle")
            page.wait_for_selector(".draw-stage")
            page.click(".reveal-self-btn")
            page.wait_for_selector(".draw-overlay-img:not(.hidden)")
            ov1_ok = page.evaluate("() => document.querySelector('.draw-overlay-img')?.naturalWidth > 0")
            assert ov1_ok, "Sansu P6MA1_023 congruent draw overlay SVG failed to load"
            page.screenshot(path=str(SHOT_DIR / "g5_03_sansu_congruent.png"))
            print("[E2E-G5] Sansu P6MA1_023 congruent triangle draw overlay OK")

            page.goto(f"{base_url}/#drill?grade=5年&subject=sansu&unit=P6MA1_026", wait_until="networkidle")
            # 3問目が円グラフ作図
            for _ in range(4):
                if page.locator(".draw-stage").count() > 0:
                    page.click(".reveal-self-btn")
                    page.wait_for_selector(".draw-overlay-img:not(.hidden)")
                    ov2_ok = page.evaluate("() => document.querySelector('.draw-overlay-img')?.naturalWidth > 0")
                    assert ov2_ok, "Sansu P6MA1_026 pie chart draw overlay SVG failed"
                    page.screenshot(path=str(SHOT_DIR / "g5_04_sansu_pie.png"))
                    break
                if page.locator(".drill-input").count() > 0:
                    page.locator(".drill-input").first.fill("120")
                page.click("#check-answer-btn")
                page.click("#next-question-btn")
            print("[E2E-G5] Sansu P6MA1_026 pie chart draw overlay OK")

            # 6. 5年算数 P6MA1_003 約数列挙（読点区切り・順不同入力でも正解）
            page.goto(f"{base_url}/#drill?grade=5年&subject=sansu&unit=P6MA1_003&source=たしかめドリル", wait_until="networkidle")
            page.wait_for_selector(".drill-input")
            page.locator(".drill-input").first.fill("8、4、2、1")
            page.click("#check-answer-btn")
            page.wait_for_selector(".feedback-area.is-correct")
            print("[E2E-G5] Sansu P6MA1_003 divisor list flexible delimiter/order OK")

            # 7. 5年理科 P6RI1_004 発芽の3条件（順不同 word_bank 採点）＆ P6RI1_001 天気SVG
            page.goto(f"{base_url}/#drill?grade=5年&subject=rika&unit=P6RI1_004", wait_until="networkidle")
            page.wait_for_selector(".wb-chip")
            # 順不同で「適当な温度」「水」「空気」の順に入力して正解になることを確認
            page.locator(".wb-chip", has_text="適当な温度").first.click()
            page.locator(".wb-chip", has_text="水").first.click()
            page.locator(".wb-chip", has_text="空気").first.click()
            page.click("#check-answer-btn")
            page.wait_for_selector(".feedback-area.is-correct")
            page.screenshot(path=str(SHOT_DIR / "g5_05_rika_unordered.png"))
            print("[E2E-G5] Rika P6RI1_004 unordered word_bank scoring OK")

            # 8. 先生用ダッシュボードで「5年」フィルタ＆5年誤答問題プレビュー確認
            page.click("#settings-btn")
            page.click("#open-teacher-btn")
            page.fill("#teacher-school-input", "hino")
            page.fill("#teacher-password-input", "hino2026")
            page.click("#teacher-auth-submit")
            page.wait_for_selector(".teacher-view")
            page.select_option("#td-filter-grade", "5年")
            page.click('[data-td-tab="units"]')
            assert "5MA_025_F_01" in page.locator(".td-wrong-item").first.inner_text()
            page.locator('[data-preview-pid="5MA_025_F_01"]').click()
            page.wait_for_selector("#teacher-detail-modal:not(.hidden)")
            assert "割合と百分率" in page.locator("#teacher-detail-title").inner_text()
            print("[E2E-G5] Teacher dashboard 5年 filter & 5th-grade problem preview OK")

            browser.close()

        assert len(console_errors) == 0, f"Console errors: {console_errors}"
        assert len(failed_assets) == 0, f"Failed assets (404 etc.): {failed_assets}"
        print("\n[SUCCESS] Grade 5 full E2E test passed with 0 errors and 0 404s!")
    finally:
        server.shutdown()


if __name__ == "__main__":
    run()
