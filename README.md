# SmartTasker

> **Pronto para auxiliar em sua jornada de planejamento de tarefas!**

Aplicativo **Android** de produtividade focado em um ciclo simples e
recompensador: **planejar → focar → concluir → ganhar**. Cada tarefa concluída
paga **moedas** que podem ser trocadas por dinheiro, crédito ou tokens, e a
plataforma monetiza por assinatura e por uma taxa sobre cada resgate.

O app é **100% offline** (nenhuma chamada de rede, nenhuma permissão de
internet) e não depende de bibliotecas externas.

---

## 1. O que ele faz (MVP)

| Recurso | Descrição |
|---|---|
| **Tarefas** | Criar, editar, concluir, reabrir e apagar. Prioridade (baixa/média/alta), categoria, estimativa e notas. |
| **Agenda** | Próximos 7 dias agrupados por dia + bloco de **atrasadas**. Horário de vencimento. |
| **Recorrência** | Tarefas **diária / semanal / mensal** que se reagendam sozinhas ao concluir. |
| **Foco (Pomodoro)** | Cronômetro por tarefa; o tempo é somado ao histórico e rende **bônus de moedas**. |
| **Relatórios** | KPIs (conclusão, atrasos, foco), gráfico de 7 dias (barras = concluídas, linha = minutos) e quebra por categoria. |
| **Lembretes** | Notificação nativa do Android 5 min antes do vencimento + vibração. |
| **Backup** | Exportar / importar todo o estado em JSON e compartilhar com outro app. |

## 2. Como o app lucra (monetização)

Alinhado ao pitch (recompensa por tarefa + taxa de plataforma):

1. **Freemium / assinatura** — plano **Grátis** (até 10 tarefas ativas, 7 dias
   de histórico) → **Pro** (R$ 19,90/mês) → **Business** (R$ 99,90/mês, com
   pacote de análises para equipes/RH).
2. **Recompensa por tarefa** — baixa **+5**, média **+10**, alta **+20**
   moedas, mais bônus por tempo de foco.
3. **Resgate de moedas** — 100 moedas → R$ 1,00 (dinheiro), R$ 1,20 (crédito)
   ou 1,5 **tokens SMART**. A plataforma retém **10%** de taxa em cada resgate.
4. **Business/equipes** — relatórios agregados para empresas (upgrade vendido
   pelo próprio app).

A tela **Moedas** mostra o saldo, as opções de resgate e a **receita da
plataforma** (assinatura/mês + taxa sobre resgates).

## 3. Arquitetura

```
smarttasker/
├── app/src/main/
│   ├── java/com/empresa/smarttasker/MainActivity.java  ← casca Android (WebView + ponte nativa)
│   ├── assets/                                          ← o app em si (offline)
│   │   ├── index.html      interface
│   │   ├── estilo.css      tema
│   │   ├── store.js        NÚCLEO (regras de negócio, sem UI)
│   │   ├── app.js          UI (vanilla JS)
│   │   ├── favicon.svg · manifest.webmanifest
│   ├── res/                                             ← tema, strings e ícone
│   └── AndroidManifest.xml
├── build.gradle · settings.gradle · gradle.properties
├── tools/smoke-test.mjs    52 asserções sobre o núcleo (Node)
├── tools/testar-ui.py      teste real da interface (Chromium headless)
├── servir.sh               serve a UI no navegador (dev)
├── iniciar.sh              testa + serve
└── build-apk.sh            gera o APK (precisa do Android SDK)
```

**Por que WebView?** O núcleo (`store.js`) é JavaScript puro e **testável fora
do Android** — assim a lógica é validada de ponta a ponta nesta máquina, sem
emulador. A camada Android (`MainActivity`) expõe recursos do sistema ao app
(`AndroidBridge`):

- `persistSave` / `persistLoad` → grava o estado em **SharedPreferences**
  (sobrevive à limpeza de cache);
- `notificar(título, texto)` → **notificação nativa** (com canal no Android 8+);
- `vibrar(ms)` → feedback tátil;
- `compartilhar(texto)` → envia o backup JSON para outro app.

## 4. Como rodar

### 4.1 Testar o núcleo (sem Android, sem dependências)

```bash
node tools/smoke-test.mjs        # 52 verificações das regras de negócio
python3 tools/testar-ui.py       # interface real no Chromium headless (opcional)
```

### 4.2 Ver o app no navegador (desenvolvimento)

```bash
./iniciar.sh          # roda os testes e sobe http://127.0.0.1:8790
# ou só: ./servir.sh 8790
```

### 4.3 Gerar o APK Android

Escolha uma das opções:

**A) Android Studio (mais simples)** — abra a pasta `smarttasker/`, o Studio
baixa o Gradle e o SDK sozinho, e clique em **Run ▶**.

**B) Linha de comando** — com JDK 17+ e o Android SDK instalado:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"   # ajuste para o seu caminho
./build-apk.sh                            # gera app/build/outputs/apk/debug/app-debug.apk
```

Instale no aparelho (modo desenvolvedor + depuração USB):

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> Requisitos de build: **Android Gradle Plugin 8.5.2**, **Gradle 8.7**,
> `compileSdk 34`, `minSdk 24` (Android 7.0+). Nenhuma dependência de
> AndroidX/AppCompat — só o framework.

## 5. Estrutura do estado (store.js)

```js
tarefa = {
  id, titulo, notas, categoria, prioridade,     // 'baixa'|'media'|'alta'
  vencimento,                                    // "YYYY-MM-DDTHH:MM" ou ""
  recorrencia,                                   // 'nenhuma'|'diaria'|'semanal'|'mensal'
  estimativaMin, criadaEm, concluidaEm, feita,
  moedas,                                        // recompensa recebida
  sessoes: [{ inicio, fim, segundos }]           // histórico de foco
}
```

Persistência é injetada (`driver`): `driverAndroid` (SharedPreferences),
`driverNavegador` (localStorage) ou `driverMemoria` (testes). O mesmo núcleo
roda nos três.

## 6. Limitações conhecidas

- O agendamento de lembretes ocorre **enquanto o app está aberto** (timer de
  1 s). Lembretes com o app fechado exigiriam `AlarmManager`/`WorkManager` —
  evolução natural para a v2.
- O "pagamento" das recompensas é simulado (a carteira é local, para
  demonstração); a integração real de pagamento é um passo de negócio.

---

Feito pela **Empresa IA — Fábrica Autônoma de Software** (setor de
desenvolvimento). Dúvidas de monetização: ver `00-ideia.md` e `00-pitch.md`.
