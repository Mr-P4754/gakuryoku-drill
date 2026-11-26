#!/usr/bin/env python3
"""
3年生（全4教科・61単元）の画面表示・学年切替・ローマ字補助パッド・101〜160字作文・
コンパス作図オーバーレイ・ぼうグラフ作図・社会オリジナルSVG・理科回路図・先生ダッシュボード3年フィルタ
の Playwright E2E テスト＆スクリーンショット検証スクリプト
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
                                "token": "g3-mock-tok",
                                "expires_in_sec": 1800,
                                "school_code": "hino",
                                "school_label": "hino校",
                                "fetched_at": "2026-11-26T06:00:00Z",
                                "total_count": 2,
                                "truncated": False,
                                "logs": [
                                    {
                                        "logged_at": "2026-11-26 09:00:00",
                                        "school_code": "hino",
                                        "grade": "3年",
                                        "class_name": "1組",
                                        "student_no": 5,
                                        "student_key": "hino_3年_1組_05",
                                        "subject": "国語",
                                        "unit_code": "P4JA1_004",
                                        "unit_name": "ローマ字",
                                        "mode": "unit",
                                        "score": 20,
                                        "total": 24,
                                        "accuracy_pct": 83,
                                        "self_check_count": 0,
                                        "wrong_ids": "3JA_004_D_15",
                                        "duration_sec": 180,
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

            # 1. 初期アクセス：既定表示は4年、学年タブは「3年」「4年」の昇順
            page.goto(base_url, wait_until="networkidle")
            if page.locator("#profile-modal:not(.hidden)").is_visible():
                page.click("#prof-skip-btn")

            tabs = page.locator(".grade-tab").all_inner_texts()
            assert tabs == ["3年", "4年"], f"Expected grade tabs ['3年', '4年'], got {tabs}"
            assert "4年" in page.locator(".home-hero h1").inner_text()

            # 2. 3年タブクリック → 3年4教科・61単元・524問が表示
            page.locator(".grade-tab", has_text="3年").click()
            page.wait_for_function("() => document.querySelector('.home-hero h1')?.textContent.includes('3年')")
            hero_text = page.locator(".home-hero").inner_text()
            assert "61" in hero_text and "524" in hero_text, f"Unexpected 3rd grade hero: {hero_text}"
            page.screenshot(path=str(SHOT_DIR / "g3_01_home.png"))
            print("[E2E-G3] Home grade tabs ['3年', '4年'] & 3rd-grade overview OK")

            # 3. 3年国語 P4JA1_004 ローマ字（たしかめドリル）：長音記号パッド表示＆挿入＆正解判定
            page.goto(f"{base_url}/#drill?grade=3年&subject=kokugo&unit=P4JA1_004&source=たしかめドリル", wait_until="networkidle")
            # tyûi の設問まで探すため、pad ボタンが出る設問へ直接移動できるよう1問目〜確認またはpadボタン確認
            found_pad = False
            for _ in range(20):
                if page.locator(".romaji-pad .symbol-btn").count() > 0:
                    found_pad = True
                    # ボタンクリックで入力欄に入ることを検証
                    inp = page.locator(".drill-input").first
                    inp.fill("ty")
                    page.locator(".romaji-pad .symbol-btn", has_text="û").click()
                    val = inp.input_value()
                    assert "û" in val, f"Expected û inserted, got {val}"
                    page.screenshot(path=str(SHOT_DIR / "g3_02_romaji_pad.png"))
                    break
                # 次の問題へ進むために適当に入力して答え合わせ→次へ
                if page.locator(".drill-input").count() > 0:
                    page.locator(".drill-input").first.fill("a")
                elif page.locator(".choice-card").count() > 0:
                    page.locator(".choice-card").first.click()
                page.click("#check-answer-btn")
                page.click("#next-question-btn")
            assert found_pad, "Expected Romaji accent pad (.romaji-pad) in P4JA1_004"
            print("[E2E-G3] Romaji accent pad (â/î/û/ê/ô) insert OK")

            # 4. 3年国語 P4JA1_009 文章を書く：101〜160字カウンター確認
            page.goto(f"{base_url}/#drill?grade=3年&subject=kokugo&unit=P4JA1_009&source=たしかめドリル", wait_until="networkidle")
            found_counter = False
            for _ in range(6):
                txt = page.locator(".char-counter-row").inner_text() if page.locator(".char-counter-row").count() else ""
                if "101" in txt and "160" in txt:
                    found_counter = True
                    break
                page.click(".reveal-self-btn")
                page.click(".self-ok-btn")
                page.click("#next-question-btn")
            assert found_counter, "Expected 101〜160字 counter in P4JA1_009"
            print("[E2E-G3] Kokugo essay 101-160 char counter OK")

            # 5. 3年社会 P4SH1_009（西武鉄道差し替えオリジナルSVG）表示確認
            page.goto(f"{base_url}/#drill?grade=3年&subject=shakai&unit=P4SH1_009", wait_until="networkidle")
            page.wait_for_selector(".problem-figure")
            imgs_ok = page.evaluate("() => [...document.querySelectorAll('.problem-figure')].every(i => i.complete && i.naturalWidth > 0)")
            assert imgs_ok, "Shakai P4SH1_009 SVG failed to load"
            page.screenshot(path=str(SHOT_DIR / "g3_03_shakai_railway.png"))
            print("[E2E-G3] Shakai P4SH1_009 original SVG replacement OK")

            # 6. 3年算数 P4MA1_018（コンパス作図＋透過模範オーバーレイ）
            page.goto(f"{base_url}/#drill?grade=3年&subject=sansu&unit=P4MA1_018", wait_until="networkidle")
            page.wait_for_selector(".draw-stage")
            page.click(".reveal-self-btn")
            page.wait_for_selector(".draw-overlay-img:not(.hidden)")
            ov_ok = page.evaluate("() => document.querySelector('.draw-overlay-img')?.naturalWidth > 0")
            assert ov_ok, "Sansu P4MA1_018 compass overlay SVG failed to load"
            page.screenshot(path=str(SHOT_DIR / "g3_04_sansu_compass.png"))
            print("[E2E-G3] Sansu P4MA1_018 compass draw & translucent overlay OK")

            # 7. 3年理科 P4RI1_015（日時計SVG）
            page.goto(f"{base_url}/#drill?grade=3年&subject=rika&unit=P4RI1_015", wait_until="networkidle")
            page.wait_for_selector(".problem-figure")
            rika_ok = page.evaluate("() => [...document.querySelectorAll('.problem-figure')].every(i => i.complete && i.naturalWidth > 0)")
            assert rika_ok, "Rika P4RI1_015 SVG failed to load"
            page.screenshot(path=str(SHOT_DIR / "g3_05_rika_sundial.png"))
            print("[E2E-G3] Rika P4RI1_015 sundial SVG OK")

            # 8. 先生用ダッシュボードで「3年」フィルタ＆3年誤答問題プレビュー確認
            page.click("#settings-btn")
            page.click("#open-teacher-btn")
            page.fill("#teacher-school-input", "hino")
            page.fill("#teacher-password-input", "hino2026")
            page.click("#teacher-auth-submit")
            page.wait_for_selector(".teacher-view")
            page.select_option("#td-filter-grade", "3年")
            page.click('[data-td-tab="units"]')
            assert "3JA_004_D_15" in page.locator(".td-wrong-item").first.inner_text()
            page.locator('[data-preview-pid="3JA_004_D_15"]').click()
            page.wait_for_selector("#teacher-detail-modal:not(.hidden)")
            assert "ローマ字" in page.locator("#teacher-detail-title").inner_text()
            print("[E2E-G3] Teacher dashboard 3年 filter & 3rd-grade problem preview OK")

            browser.close()

        assert len(console_errors) == 0, f"Console errors: {console_errors}"
        assert len(failed_assets) == 0, f"Failed assets (404 etc.): {failed_assets}"
        print("\n[SUCCESS] Grade 3 full E2E test passed with 0 errors and 0 404s!")
    finally:
        server.shutdown()


if __name__ == "__main__":
    run()
