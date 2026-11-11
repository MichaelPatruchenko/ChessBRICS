"""Browser end-to-end check against a running deployment."""
import argparse
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urljoin
from uuid import uuid4

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def check(base, capture=None, restart_project=None):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=os.getenv("CHESSBRICS_BROWSER_CHANNEL"))
        errors = []
        restarting = False

        def open_player(**viewport):
            context = browser.new_context(viewport=viewport or {"width": 1280, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" and not restarting else None)
            return page

        def snap(page, label):
            if capture:
                capture.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=capture / (label + ".png"), animations="disabled")

        host = open_player()
        with host.expect_response("**/club-background.webp") as background:
            host.goto(base)
        assert background.value.ok
        expect(host.locator(".cell")).to_have_count(100)
        expect(host.locator("#board .piece")).to_have_count(40)
        expect(host.locator('#board use[href="/pieces.svg#x"]')).to_have_count(4)
        sizes = host.locator(".cell").evaluate_all("cells => cells.map(c => c.getBoundingClientRect().height)")
        assert max(sizes) - min(sizes) < 1
        toggle = host.get_by_role("button", name="Дополнительный визуал")
        expect(toggle).to_have_attribute("aria-pressed", "true")
        host.wait_for_function("document.querySelector('.intro-art img').naturalWidth > 0")
        host.wait_for_function("document.querySelector('.team-art img').naturalWidth > 0")
        expect(host.locator("#board .piece-art:visible")).to_have_count(40)
        expect(host.locator("#board .piece:visible")).to_have_count(0)
        expect(host.locator(".brand-mark .icon-art")).to_be_visible()
        assert "art-board-light.webp" in host.locator("#board .light").first.evaluate("e => getComputedStyle(e).backgroundImage")
        snap(host, "01-lobby")
        toggle.click()
        expect(toggle).to_have_attribute("aria-pressed", "false")
        expect(host.locator(".intro-art")).to_be_hidden()
        expect(host.locator(".team-art")).to_be_hidden()
        assert host.evaluate("getComputedStyle(document.body, '::before').backgroundImage") == "none"
        expect(host.locator("#board .piece-art:visible")).to_have_count(0)
        expect(host.locator("#board .piece:visible")).to_have_count(40)
        expect(host.locator(".brand-mark img")).to_be_visible()
        assert host.locator("#board .light").first.evaluate("e => getComputedStyle(e).backgroundImage") == "none"
        snap(host, "08-visual-off")
        host.reload()
        expect(toggle).to_have_attribute("aria-pressed", "false")
        assert host.locator(".intro-art img").get_attribute("src") is None
        assert host.evaluate("getComputedStyle(document.body, '::before').backgroundImage") == "none"
        toggle.click()
        expect(host.locator(".intro-art")).to_be_visible()
        assert "club-background.webp" in host.evaluate("getComputedStyle(document.body, '::before').backgroundImage")
        host.get_by_role("button", name="Правила игры").click()
        expect(host.get_by_role("dialog", name="Правила игры")).to_be_visible()
        host.wait_for_function("document.querySelector('.rulebook-art img').naturalWidth > 0")
        snap(host, "06-rules")
        host.keyboard.press("Escape")
        host.locator("#name").fill("Анна")
        host.get_by_role("button", name="Создать комнату").click()
        host.wait_for_url(re.compile(r"[?]room="))
        room_url = host.url
        expect(host.locator("#roomHint")).to_have_text("1 из 4 мест занято")
        expect(host.locator("#inviteLink")).to_have_value(room_url)
        host.evaluate("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
        host.get_by_role("button", name="Копировать").click()
        expect(host.locator("#inviteLink")).to_be_focused()
        expect(host.locator("#notice")).to_contain_text("Ссылка выделена")
        assert host.locator("#inviteLink").evaluate("field => field.selectionEnd === field.value.length")
        snap(host, "02-room")
        players = [host]
        for name in ("Борис", "Вера", "Глеб"):
            page = open_player()
            page.goto(room_url)
            expect(page.get_by_role("button", name="Занять место")).to_be_visible()
            page.locator("#joinName").fill(name)
            page.locator("#joinName").press("Enter")
            expect(page.get_by_text(name + " · вы")).to_be_visible()
            players.append(page)
        expect(host.locator("#status")).to_have_text("Ваш ход")
        expect(host.locator(".cell[tabindex='0']")).to_have_count(1)
        pawn = host.get_by_role("button", name=re.compile("^a2, Пешка"))
        restarting = True
        room_api = "**/api/rooms/" + room_url.split("room=")[1]
        host.route(room_api, lambda route: route.abort())
        expect(host.locator("#connection")).to_contain_text("Связь прервалась")
        pawn.click()
        expect(host.locator(".cell.target")).to_have_count(0)
        host.unroute(room_api)
        expect(host.locator("#connection")).to_be_hidden()
        restarting = False
        pawn.focus()
        host.keyboard.press("ArrowRight")
        expect(host.get_by_role("button", name=re.compile("^b2, Пешка"))).to_be_focused()
        host.keyboard.press("ArrowLeft")
        expect(pawn).to_be_focused()
        host.keyboard.press("Enter")
        expect(host.locator(".cell.target")).to_have_count(4)
        host.get_by_role("button", name="b6", exact=True).click()
        expect(host.locator("#boardMessage")).to_contain_text("Эта клетка недоступна")
        expect(host.locator(".cell.target")).to_have_count(4)
        pawn.focus()
        host.keyboard.press("Escape")
        expect(host.locator(".cell.target")).to_have_count(0)
        host.keyboard.press("Enter")
        expect(host.locator(".cell.target")).to_have_count(4)
        assert host.locator("#board use").first.evaluate("piece => piece.getBBox().width") > 0
        snap(host, "03-moves")
        toggle.click()
        expect(host.locator(".cell.target")).to_have_count(4)
        expect(host.locator("#status")).to_have_text("Ваш ход")
        host.get_by_role("button", name="a6, доступный ход").click()
        expect(players[1].locator("#status")).to_have_text("Ваш ход")
        expect(players[1].locator("#history li")).to_have_text("Пешка a2 → a6")
        players[1].get_by_role("button", name=re.compile("^j9, Пешка")).click()
        players[1].get_by_role("button", name="j7, доступный ход").click()
        expect(host.locator("#history li")).to_have_count(2)
        snap(host, "04-live")
        if restart_project:
            restarting = True
            subprocess.run(
                ["docker", "compose", "-p", restart_project, "restart", "chessbrics"],
                cwd=ROOT, check=True,
            )
            subprocess.run(
                ["docker", "compose", "-p", restart_project, "up", "-d", "--no-build", "--wait"],
                cwd=ROOT, check=True,
            )
        host.reload()
        restarting = False
        expect(host.get_by_text("Анна · вы")).to_be_visible()
        expect(host.locator("#history li")).to_have_count(2)
        host.get_by_role("button", name="Сдаться").click()
        dialog = host.get_by_role("dialog", name="Сдаться за команду?")
        expect(dialog.get_by_role("button", name="Продолжить игру")).to_be_focused()
        host.keyboard.press("Escape")
        expect(dialog).not_to_be_visible()
        host.get_by_role("button", name="Сдаться").click()
        dialog.get_by_role("button", name="Сдаться").click()
        expect(players[1].locator("#status")).to_have_text("Победа команды 2")

        host.get_by_role("link", name="В игровой зал").click()
        expect(host.locator("#resume")).to_have_attribute("href", re.compile(r"[?]room="))

        mobile = open_player(width=320, height=740)
        mobile.goto(base)
        expect(mobile.locator("#board")).to_be_visible()
        assert mobile.evaluate("document.documentElement.scrollWidth === window.innerWidth")
        assert mobile.locator("#setup").bounding_box()["y"] < mobile.locator("#board").bounding_box()["y"]
        mobile.get_by_role("button", name="Играть с ботами").click()
        assert mobile.locator("#board").bounding_box()["y"] < mobile.locator("#room").bounding_box()["y"]
        assert mobile.locator(".cell").first.bounding_box()["width"] >= 24
        mobile.get_by_role("button", name=re.compile("^a2, Пешка")).click()
        mobile.get_by_role("button", name="a6, доступный ход").click()
        expect(mobile.locator("#history li")).to_have_count(4)
        expect(mobile.locator("#status")).to_have_text("Ваш ход")
        mobile.locator("#north").evaluate("element => element.scrollIntoView({block: 'start'})")
        snap(mobile, "05-mobile")
        mobile.get_by_role("button", name="Сдаться").click()
        mobile.get_by_role("dialog").get_by_role("button", name="Сдаться").click()
        mobile.get_by_role("button", name="Новая тренировка").click()
        expect(mobile.locator("#status")).to_have_text("Ваш ход")
        expect(mobile.locator("#history li")).to_have_count(0)
        classic = open_player()
        classic.goto(base)
        classic.get_by_role("radio", name=re.compile("Классика")).check()
        expect(classic.locator(".cell")).to_have_count(64)
        expect(classic.locator("#board .piece")).to_have_count(32)
        expect(classic.locator("#board .piece-art:visible")).to_have_count(32)
        assert "art-board-dark.webp" in classic.locator("#board .dark").first.evaluate("e => getComputedStyle(e).backgroundImage")
        classic.locator("#publicRoom").check()
        classic.get_by_role("button", name="Создать комнату").click()
        expect(classic.locator("#roomHint")).to_have_text("1 из 2 мест занято")
        opponent = open_player()
        opponent.goto(base)
        opponent.get_by_role("button", name="Открытые комнаты").click()
        opponent.get_by_role("link", name=re.compile("Классические шахматы")).first.click()
        opponent.locator("#joinName").fill("Соперник")
        opponent.locator("#joinName").press("Enter")
        expect(classic.locator("#status")).to_have_text("Ваш ход")
        classic.get_by_role("button", name=re.compile("^e2, Пешка")).click()
        classic.get_by_role("button", name="e4, доступный ход").click()
        expect(opponent.locator("#history li")).to_have_text("Пешка e2 → e4")
        snap(classic, "07-classic")
        with classic.expect_download() as download:
            classic.get_by_role("button", name="Скачать запись").click()
        assert download.value.suggested_filename == "classic.pgn"
        training = open_player()
        training.goto(base)
        training.get_by_role("radio", name=re.compile("Классика")).check()
        training.locator("#botLevel").select_option("hard")
        training.get_by_role("button", name="Играть с ботами").click()
        training.get_by_role("button", name=re.compile("^e2, Пешка")).click()
        training.get_by_role("button", name="e4, доступный ход").click()
        expect(training.locator("#history li")).to_have_count(2)
        expect(training.locator("#status")).to_have_text("Ваш ход")
        local = open_player()
        local.goto(base)
        local.get_by_role("radio", name=re.compile("Классика")).check()
        local.get_by_role("button", name="Играть на одном экране").click()
        local.get_by_role("button", name=re.compile("^e2, Пешка")).click()
        local.get_by_role("button", name="e4, доступный ход").click()
        expect(local.locator("#status")).to_have_text("Ходят чёрные")
        local.get_by_role("button", name=re.compile("^e7, Пешка")).click()
        local.get_by_role("button", name="e5, доступный ход").click()
        local.get_by_role("button", name="Сдаться").click()
        local.get_by_role("dialog").get_by_role("button", name="Сдаться").click()
        expect(local.locator("#status")).to_have_text("Чёрные победили")
        local.get_by_role("button", name="Предыдущая позиция").click()
        expect(local.get_by_role("button", name=re.compile("^e7, Пешка"))).to_be_visible()
        local.get_by_role("button", name="Следующая позиция").click()
        expect(local.get_by_role("button", name=re.compile("^e5, Пешка"))).to_be_visible()
        duel = open_player()
        duel.goto(base)
        duel.get_by_role("radio", name=re.compile("БРИКС 1×1")).check()
        expect(duel.locator(".cell")).to_have_count(100)
        expect(duel.locator(".seat")).to_have_count(2)
        duel.get_by_role("button", name="Играть на одном экране").click()
        duel.get_by_role("button", name=re.compile("^j2, Пешка")).click()
        duel.get_by_role("button", name="j6, доступный ход").click()
        expect(duel.locator("#status")).to_have_text("Ходят оранжевые")
        duel.get_by_role("button", name=re.compile("^a9, Пешка")).click()
        duel.get_by_role("button", name="a5, доступный ход").click()
        expect(duel.locator("#status")).to_have_text("Ходят красные")
        duel.get_by_role("button", name="Сдаться").click()
        duel.get_by_role("dialog").get_by_role("button", name="Сдаться").click()
        expect(duel.locator("#status")).to_have_text("Оранжевые победили")
        duel.get_by_role("button", name="Предложить ход").click()
        expect(duel.locator("#analysisText")).to_contain_text("Поиск БРИКС")
        study = open_player()
        study.goto(base)
        study.get_by_role("button", name="Настройки").click()
        study.locator("#boardTheme").select_option("wood")
        study.locator("#showCoordinates").uncheck()
        study.keyboard.press("Escape")
        study.reload()
        expect(study.locator("#board")).to_have_attribute("data-theme", "wood")
        expect(study.locator("#board .coord").first).to_be_hidden()
        study.get_by_role("button", name="Разбор и задачи").click()
        study.locator("#studyText").fill("1. e4 e5 2. Nf3 Nc6 *")
        study.get_by_role("button", name="Открыть на доске").click()
        expect(study.locator("#status")).to_have_text("Разбор позиции")
        expect(study.locator("#history li")).to_have_count(4)
        study.get_by_role("button", name="Предложить ход").click()
        expect(study.locator("#analysisText")).to_contain_text("Кандидат")
        snap(study, "09-study")
        with study.expect_download() as fen:
            study.get_by_role("button", name="Скачать FEN").click()
        assert fen.value.suggested_filename == "position.fen"
        study.goto(base)
        study.get_by_role("button", name="Разбор и задачи").click()
        study.get_by_role("button", name="Ферзь у края").click()
        study.get_by_role("button", name=re.compile("^f7, Ферзь")).click()
        study.get_by_role("button", name="g7, доступный ход").click()
        expect(study.locator("#status")).to_have_text("Задача решена")

        registered = open_player()
        registered.goto(base)
        registered.get_by_role("button", name="Аккаунт", exact=True).click()
        registered.locator("#accountMode").select_option("register")
        registered.locator("#accountLogin").fill("qa_" + uuid4().hex[:12])
        registered.locator("#accountPassword").fill("A long browser QA password!")
        registered.get_by_role("button", name="Продолжить", exact=True).click()
        expect(registered.locator("#issuedCode")).to_have_value(re.compile(r"^[\w-]{32}$"))
        registered.locator("#profileName").fill("Проверка профиля")
        registered.locator("#profileVisible").check()
        registered.get_by_role("button", name="Сохранить профиль").click()
        expect(registered.locator("#accountNotice")).to_have_text("Профиль сохранён")
        registered.keyboard.press("Escape")
        registered.get_by_role("button", name="Найти рейтинговую партию").click()
        expect(registered.locator("#roomTitle")).to_have_text("Поиск соперников")
        registered.get_by_role("button", name="Отменить поиск").click()
        expect(registered.locator("#setup")).to_be_visible()
        registered.get_by_role("button", name="Турниры", exact=True).click()
        registered.locator("#tournamentName").fill("Тестовый кубок " + uuid4().hex[:6])
        title = registered.locator("#tournamentName").input_value()
        registered.get_by_role("button", name="Создать турнир").click()
        expect(registered.get_by_role("heading", name=title)).to_be_visible()
        snap(registered, "10-tournament")
        audio = open_player()
        audio.add_init_script("""
          const NativeAudio = window.Audio;
          window.Audio = function (...args) {
            const media = new NativeAudio(...args);
            window.testMusic = media;
            return media;
          };
          window.testEffects = 0;
          const start = AudioBufferSourceNode.prototype.start;
          AudioBufferSourceNode.prototype.start = function (...args) {
            window.testEffects++;
            return start.apply(this, args);
          };
        """)
        audio.goto(base)
        assert audio.evaluate("testMusic.paused && !testMusic.getAttribute('src')")
        audio.get_by_role("button", name="Настройки").click()
        snap(audio, "11-audio")
        with audio.expect_response("**/audio/lobby-cozy-evening.mp3") as lobby_music:
            audio.locator("#musicEnabled").check()
        assert lobby_music.value.ok
        audio.wait_for_function("() => !testMusic.paused && testMusic.readyState >= 2")
        audio.locator("#soundEnabled").check()
        audio.locator("#musicVolume").focus()
        audio.keyboard.press("Home")
        audio.keyboard.press("ArrowRight")
        assert audio.evaluate("testMusic.volume") == .01
        audio.keyboard.press("Escape")
        with audio.expect_response("**/audio/match-silent-atmosphere.mp3") as match_music:
            audio.get_by_role("button", name="Играть на одном экране").click()
        assert match_music.value.ok
        audio.get_by_role("button", name=re.compile("^a2, Пешка")).click()
        with audio.expect_response("**/audio/move.mp3") as move_audio:
            audio.get_by_role("button", name="a6, доступный ход").click()
        assert move_audio.value.ok
        audio.wait_for_function("() => testEffects >= 2")
        audio.get_by_role("button", name="Настройки").click()
        audio.locator("#musicEnabled").uncheck()
        audio.wait_for_function("() => testMusic.paused")
        audio.reload()
        audio.get_by_role("button", name="Настройки").click()
        expect(audio.locator("#musicEnabled")).not_to_be_checked()
        expect(audio.locator("#soundEnabled")).to_be_checked()
        expect(audio.locator("#musicVolume")).to_have_value("1")
        castle = open_player()
        castle.goto(base)
        castle.get_by_role("button", name="Играть на одном экране").click()
        castle.get_by_role("button", name=re.compile("^e1, Король")).click()
        expect(castle.locator(".cell.occupied.target")).to_have_count(9)
        castle.get_by_role("button", name=re.compile("^j1, Ладья.*доступный ход")).click()
        expect(castle.get_by_role("button", name=re.compile("^j1, Король, Красные"))).to_be_visible()
        expect(castle.get_by_role("button", name=re.compile("^e1, Ладья, Зелёные"))).to_be_visible()
        assert not errors, errors
        response = host.request.get(urljoin(base, "/healthz"))
        assert response.ok and response.json() == {"status": "ok"}
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3000")
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--restart-project")
    args = parser.parse_args()
    check(args.base, args.capture, args.restart_project)
    print("Browser checks passed: desktop, 4-player room, reload, mobile, bots, health.")







