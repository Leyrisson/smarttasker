#!/usr/bin/env python3
"""
Teste de interface do SmartTasker SEM Android e SEM dependências pip.

Sobe um servidor estático, abre o app no Chromium headless via chromedriver
(WebDriver) e exercita a interface de verdade: troca de abas, criação de
tarefa e conclusão pela UI, conferindo o estado do núcleo (store.js).

Uso:  python3 tools/testar-ui.py
Requer: chromium + chromedriver instalados (presentes no Omarchy).
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
ASSETS = os.path.join(RAIZ, "app", "src", "main", "assets")
PORTA = 8791
DRIVER_PORT = 9516

passou = 0
falhou = 0


def check(cond, nome):
    global passou, falhou
    if cond:
        passou += 1
        print("  \u2713 " + nome)
    else:
        falhou += 1
        print("  \u2717 " + nome)


def req(metodo, url, corpo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(url, data=dados, method=metodo)
    if dados is not None:
        r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


def porta_livre(p):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", p)) != 0


def esperar(url, segundos=20):
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def main():
    for binario in ("chromium", "chromedriver"):
        if not shutil.which(binario):
            print("PULADO: '" + binario + "' não encontrado. "
                  "Este teste é opcional; o núcleo é coberto por smoke-test.mjs.")
            return 0

    print("== subindo servidor e chromedriver ==")
    servidor = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORTA), "--bind", "127.0.0.1"],
        cwd=ASSETS, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    driver = subprocess.Popen(
        ["chromedriver", "--port=" + str(DRIVER_PORT),
         "--log-path=/tmp/smarttasker-chromedriver.log"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    sessao = None
    try:
        if not esperar("http://127.0.0.1:%d/" % PORTA):
            print("FALHA: servidor estático não subiu")
            return 1
        if not esperar("http://127.0.0.1:%d/status" % DRIVER_PORT):
            print("FALHA: chromedriver não subiu")
            return 1

        r = req("POST", "http://127.0.0.1:%d/session" % DRIVER_PORT, {
            "capabilities": {"alwaysMatch": {
                "browserName": "chrome",
                "goog:chromeOptions": {
                    "args": ["--headless=new", "--no-sandbox", "--disable-gpu",
                             "--window-size=420,900"]},
                "goog:loggingPrefs": {"browser": "ALL"},
            }}})
        sessao = r["value"]["sessionId"]
        base = "http://127.0.0.1:%d/session/%s" % (DRIVER_PORT, sessao)
        req("POST", base + "/url", {"url": "http://127.0.0.1:%d/index.html" % PORTA})
        time.sleep(1.2)

        def js(script):
            return req("POST", base + "/execute/sync",
                       {"script": script, "args": []})["value"]

        print("\n== renderização inicial ==")
        check(js("return document.querySelectorAll('.tarefa,.dia,.kpi').length > 0"),
              "conteúdo renderizado")
        check(js("return document.querySelector('.topo h1').textContent") == "SmartTasker",
              "título do app")
        check(js("return document.querySelector('.tarefa') !== null"),
              "lista de tarefas com itens demo")

        print("\n== navegação entre abas ==")
        abas = ["tarefas", "agenda", "foco", "relatorios", "moedas", "ajustes"]
        for aba in abas:
            js("document.querySelector('#abas button[data-tab=\"%s\"]').click()" % aba)
            texto = js("return document.querySelector('#tela').innerText")
            check(len(texto) > 20, "aba '%s' renderiza" % aba)

        print("\n== criar tarefa pela interface ==")
        antes = js("return window.__smarttasker.store.estado().tarefas.length")
        js("document.querySelector('#abas button[data-tab=\"tarefas\"]').click()")
        js("document.querySelector('#fab').click()")
        check(js("return !document.querySelector('#modal').classList.contains('oculto')"),
              "modal abre")
        js("document.querySelector('#f-titulo').value='Tarefa criada pela UI'")
        js("document.querySelector('#f-categoria').value='QA'")
        js("document.querySelector('#form-tarefa')"
           ".dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))")
        depois = js("return window.__smarttasker.store.estado().tarefas.length")
        check(depois == antes + 1, "tarefa persistida no núcleo")

        print("\n== concluir tarefa pela interface ==")
        js("document.querySelector('#abas button[data-tab=\"tarefas\"]').click()")
        moedas_antes = js("return window.__smarttasker.store.estado().moedas")
        js("var b=document.querySelector('.tarefa:not(.feita) [data-check]');"
           "if(b)b.click()")
        moedas_depois = js("return window.__smarttasker.store.estado().moedas")
        check(moedas_depois > moedas_antes, "concluir paga moedas (+recompensa)")

        print("\n== foco ==")
        js("document.querySelector('#abas button[data-tab=\"foco\"]').click()")
        check(js("return document.querySelector('#btn-foco') !== null"),
              "tela de foco tem botão de ação")

        print("\n== console do navegador ==")
        try:
            logs = req("POST", base + "/log", {"type": "browser"}).get("value", [])
            graves = [l for l in logs if l.get("level") == "SEVERE"]
            check(len(graves) == 0, "nenhum erro SEVERE no console")
            for l in graves[:5]:
                print("     ! " + l.get("message", "")[:200])
        except Exception as e:
            print("  (não foi possível ler o console: %s)" % e)

    finally:
        try:
            if sessao:
                req("DELETE", "http://127.0.0.1:%d/session/%s" % (DRIVER_PORT, sessao))
        except Exception:
            pass
        driver.terminate()
        servidor.terminate()

    print("\n----------------------------------------")
    print("%d passaram, %d falharam." % (passou, falhou))
    return 0 if falhou == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
