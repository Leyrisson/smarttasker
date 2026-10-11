/* SmartTasker — interface (app.js). Vanilla JS, sem dependências. */
(function () {
  "use strict";

  var driver = window.SmartTasker.driverPadrao();
  var store = window.SmartTasker.criarStore(driver);
  var abaAtual = "tarefas";
  var filtroStatus = "ativas";
  var editandoId = null;
  var notificados = {};
  var intervalo = null;

  // primeira execução: carrega demonstração para o app não nascer vazio
  if (store.estado().tarefas.length === 0) store.semearDemo();

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function dataBonita(diaStr) {
    var p = (diaStr || "").split("-");
    if (p.length !== 3) return diaStr;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    var hoje = window.SmartTasker._util.hoje();
    var amanha = window.SmartTasker._util.somarDias(hoje, 1);
    var rot = dias[d.getDay()] + ", " + d.getDate() + "/" + pad(d.getMonth() + 1);
    if (diaStr === hoje) rot = "Hoje · " + rot;
    else if (diaStr === amanha) rot = "Amanhã · " + rot;
    return rot;
  }

  function horaDe(venc) {
    if (!venc || venc.indexOf("T") < 0) return "";
    return venc.split("T")[1].slice(0, 5);
  }

  function toast(msg, tipo) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + (tipo || "");
    setTimeout(function () { t.classList.add("oculto"); }, 2600);
  }

  function notificar(titulo, texto) {
    if (window.AndroidBridge && window.AndroidBridge.notificar) {
      try { window.AndroidBridge.notificar(titulo, texto); return; } catch (e) {}
    }
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification(titulo, { body: texto }); } catch (e) {}
    }
    toast(titulo + " — " + texto, "ok");
  }

  // ---------------- Tarefas ----------------
  function telaTarefas() {
    var res = store.resumo();
    var atras = store.atrasadas().length;
    var html = "";
    html += '<div class="grade">' +
      kpi(res.ativas, "Tarefas ativas") +
      kpi(res.concluidas, "Concluídas") +
      kpi(res.minutosFoco + "min", "Foco acumulado") +
      kpi(res.moedas, "Moedas", "ok") +
      "</div>";

    if (atras > 0) {
      html += '<div class="card" style="border-color:var(--erro)">⚠️ Você tem <b>' + atras +
        '</b> tarefa(s) atrasada(s). Priorize-as hoje.</div>';
    }

    html += '<div class="linha" style="gap:8px">' +
      botaoFiltro("ativas", "Ativas") +
      botaoFiltro("hoje", "Hoje") +
      botaoFiltro("feitas", "Concluídas") +
      botaoFiltro("todas", "Todas") +
      "</div>";

    var lista;
    if (filtroStatus === "hoje") lista = store.listarTarefas({ dia: window.SmartTasker._util.hoje() });
    else if (filtroStatus === "todas") lista = store.listarTarefas({});
    else lista = store.listarTarefas({ status: filtroStatus });

    if (lista.length === 0) {
      html += '<div class="vazio">Nada por aqui. Toque em ＋ para criar uma tarefa.</div>';
    } else {
      lista.forEach(function (t) { html += cartaoTarefa(t); });
    }

    $("#tela").innerHTML = html;
    ligarTarefas();
  }

  function kpi(valor, rot, cls) {
    return '<div class="kpi ' + (cls || "") + '"><div class="num">' + valor +
      '</div><div class="rot">' + rot + "</div></div>";
  }

  function botaoFiltro(id, rot) {
    var ativo = filtroStatus === id ? "btn-primario" : "btn-secundario";
    return '<button class="' + ativo + '" style="flex:1;padding:9px 6px;font-size:12.5px" data-filtro="' + id + '">' + rot + "</button>";
  }

  function cartaoTarefa(t) {
    var hojeStr = window.SmartTasker._util.hoje();
    var dia = (t.vencimento || "").split("T")[0];
    var atrasada = !t.feita && dia && dia < hojeStr;
    var hora = horaDe(t.vencimento);
    var seg = store.segundosFocoAoVivo(t);
    var min = Math.round(seg / 60);

    var meta = [];
    meta.push('<span class="chip ' + t.prioridade + '">' + t.prioridade + "</span>");
    meta.push('<span class="chip">' + esc(t.categoria) + "</span>");
    if (dia) meta.push('<span class="chip' + (atrasada ? " atraso" : "") + '">📅 ' +
      esc(dataBonita(dia)) + (hora ? " " + hora : "") + "</span>");
    if (t.recorrencia !== "nenhuma") meta.push('<span class="chip">🔁 ' + t.recorrencia + "</span>");
    if (min > 0) meta.push('<span class="chip">⏱️ ' + min + "min</span>");

    return '<div class="tarefa ' + (t.feita ? "feita" : "") + '">' +
      '<button class="check ' + (t.feita ? "on" : "") + '" data-check="' + t.id + '">✓</button>' +
      '<div class="corpo">' +
        '<div class="tit">' + esc(t.titulo) + "</div>" +
        '<div class="meta">' + meta.join("") + "</div>" +
      "</div>" +
      '<div class="acoes">' +
        (t.feita ? "" : '<button class="icone-btn" data-foco="' + t.id + '" title="Focar">▶</button>') +
        '<button class="icone-btn" data-editar="' + t.id + '" title="Editar">✎</button>' +
        '<button class="icone-btn perigo" data-apagar="' + t.id + '" title="Apagar">🗑</button>' +
      "</div>" +
    "</div>";
  }

  function ligarTarefas() {
    $$("[data-filtro]").forEach(function (b) {
      b.onclick = function () { filtroStatus = b.getAttribute("data-filtro"); telaTarefas(); };
    });
    $$("[data-check]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-check");
        var r = store.concluir(id);
        if (r.ok) {
          toast("Concluída! +" + r.recompensa + " moedas 🪙", "ok");
          notificar("Tarefa concluída", "+" + r.recompensa + " moedas");
          if (r.proxima) toast("Próxima ocorrência agendada.");
        } else toast(r.erro, "erro");
        render();
      };
    });
    $$("[data-editar]").forEach(function (b) {
      b.onclick = function () { abrirModal(b.getAttribute("data-editar")); };
    });
    $$("[data-apagar]").forEach(function (b) {
      b.onclick = function () {
        if (confirm("Apagar esta tarefa?")) { store.removerTarefa(b.getAttribute("data-apagar")); render(); }
      };
    });
    $$("[data-foco]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-foco");
        store.iniciarFoco(id);
        abaAtual = "foco";
        render();
      };
    });
  }

  // ---------------- Agenda ----------------
  function telaAgenda() {
    var dias = store.agenda(7);
    var html = '<h2 class="secao cabeca">Próximos 7 dias <span style="font-size:12px">' +
      store.atrasadas().length + ' atrasada(s)</span></h2>';

    if (store.atrasadas().length) {
      html += '<div class="dia"><div class="cabeca-dia" style="color:var(--erro)">Atrasadas <span class="cont">' +
        store.atrasadas().length + "</span></div>";
      store.atrasadas().forEach(function (t) { html += slot(t); });
      html += "</div>";
    }

    dias.forEach(function (d) {
      html += '<div class="dia"><div class="cabeca-dia">' + esc(dataBonita(d.dia)) +
        '<span class="cont">' + d.tarefas.length + "</span></div>";
      if (d.tarefas.length === 0) html += '<div class="slot" style="color:var(--suave)">— livre —</div>';
      else d.tarefas.forEach(function (t) { html += slot(t); });
      html += "</div>";
    });
    $("#tela").innerHTML = html;
    $$("[data-check]").forEach(function (b) {
      b.onclick = function () {
        var r = store.concluir(b.getAttribute("data-check"));
        if (r.ok) toast("+" + r.recompensa + " moedas 🪙", "ok");
        render();
      };
    });
  }

  function slot(t) {
    return '<div class="slot"><span>' + esc(t.titulo) +
      ' <span class="chip ' + t.prioridade + '">' + t.prioridade + "</span></span>" +
      '<span class="hora">' + (horaDe(t.vencimento) || "—") +
      ' <button class="icone-btn" data-check="' + t.id + '" style="padding:2px 8px;margin-left:6px">✓</button></span></div>';
  }

  // ---------------- Foco ----------------
  function telaFoco() {
    var timer = store.estado().timer;
    var alvo = timer ? acharTarefa(timer.tarefaId) : null;
    var html = "";

    html += '<div class="card foco-card">' +
      '<div class="cronometro" id="cron">00:00<small>tempo de foco</small></div>' +
      '<div class="foco-alvo">' + (alvo ? esc(alvo.titulo) : "Nenhum foco ativo") + "</div>";

    if (timer) {
      html += '<button class="btn-bloco parar" id="btn-foco">Parar foco</button>';
    } else {
      var ativas = store.listarTarefas({ status: "ativas" });
      if (ativas.length === 0) {
        html += '<div class="vazio">Crie uma tarefa para começar a focar.</div>';
      } else {
        html += '<select id="sel-tarefa" style="margin-bottom:12px">' +
          ativas.map(function (t) { return '<option value="' + t.id + '">' + esc(t.titulo) + "</option>"; }).join("") +
          "</select>";
        html += '<button class="btn-bloco" id="btn-foco">Iniciar foco ▶</button>';
      }
    }
    html += "</div>";

    var res = store.resumo();
    html += '<div class="grade">' + kpi(res.minutosFoco + "min", "Foco acumulado") +
      kpi(res.concluidas, "Concluídas") + "</div>";

    if (timer && alvo) {
      var seg = store.segundosFocoAoVivo(alvo);
      html += '<div class="card">Sessão atual: <b>' + Math.round(seg / 60) + " min</b> · " +
        (alvo.sessoes || []).length + " sessão(ões) anteriores.</div>";
    }

    $("#tela").innerHTML = html;

    var b = $("#btn-foco");
    if (b) {
      b.onclick = function () {
        if (store.estado().timer) {
          var r = store.pararFoco();
          if (r.ok) toast("Foco encerrado: " + Math.round(r.segundos / 60) + " min registrados.", "ok");
        } else {
          var sel = $("#sel-tarefa");
          if (sel) { store.iniciarFoco(sel.value); toast("Foco iniciado. Bora! 💪", "ok"); }
        }
        render();
      };
    }
    atualizarCronometro();
  }

  function atualizarCronometro() {
    var el = $("#cron");
    if (!el) return;
    var timer = store.estado().timer;
    if (!timer) { el.innerHTML = "00:00<small>tempo de foco</small>"; return; }
    var seg = Math.round((Date.now() - new Date(timer.inicio).getTime()) / 1000);
    var m = Math.floor(seg / 60), s = seg % 60;
    el.innerHTML = pad(m) + ":" + pad(s) + "<small>tempo de foco</small>";
  }

  function acharTarefa(id) {
    var l = store.estado().tarefas;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  // ---------------- Relatórios ----------------
  function telaRelatorios() {
    var res = store.resumo();
    var html = '<h2 class="secao">Resumo geral</h2><div class="grade">' +
      kpi(res.total, "Total de tarefas") +
      kpi(res.concluidas, "Concluídas", "ok") +
      kpi(res.taxaConclusao + "%", "Taxa de conclusão") +
      kpi(res.atrasadas, "Atrasadas", res.atrasadas ? "alerta" : "") +
      "</div>";

    html += '<div class="card"><h2 class="secao cabeca">Produtividade (7 dias)</h2>' +
      '<canvas id="grafico" width="640" height="300"></canvas>' +
      '<div class="legenda"><span><i style="background:var(--primaria)"></i>Concluídas</span>' +
      '<span><i style="background:var(--ok)"></i>Minutos de foco</span></div></div>';

    var cats = store.porCategoria();
    var chaves = Object.keys(cats);
    html += '<div class="card"><h2 class="secao">Por categoria</h2><div class="lista-cat">';
    chaves.forEach(function (c) {
      var o = cats[c];
      var pct = o.total ? Math.round((o.concluidas / o.total) * 100) : 0;
      html += '<div class="linha-cat"><div class="t"><b>' + esc(c) + "</b><span>" +
        o.concluidas + "/" + o.total + " · " + o.minutos + "min</span></div>" +
        '<div class="barra"><span style="width:' + pct + '%"></span></div></div>';
    });
    if (!chaves.length) html += '<div class="vazio">Sem dados ainda.</div>';
    html += "</div></div>";

    $("#tela").innerHTML = html;
    desenharGrafico(store.ultimos(7));
  }

  function desenharGrafico(dados) {
    var cv = $("#grafico");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height, base = H - 30, topo = 16;
    ctx.clearRect(0, 0, W, H);

    var maxC = 1, maxM = 1;
    dados.forEach(function (d) { maxC = Math.max(maxC, d.concluidas); maxM = Math.max(maxM, d.minutos); });
    var passo = W / dados.length;
    var lar = Math.min(46, passo * 0.5);

    // eixo
    ctx.strokeStyle = "#2e3340";
    ctx.beginPath(); ctx.moveTo(0, base); ctx.lineTo(W, base); ctx.stroke();

    dados.forEach(function (d, i) {
      var x = i * passo + passo / 2;
      // barras: concluídas
      var hC = (d.concluidas / maxC) * (base - topo);
      var g = ctx.createLinearGradient(0, base - hC, 0, base);
      g.addColorStop(0, "#8f6cff"); g.addColorStop(1, "#6c8cff");
      ctx.fillStyle = g;
      ctx.fillRect(x - lar / 2, base - hC, lar, hC);
      // rótulo dia
      ctx.fillStyle = "#98a1b3";
      ctx.font = "16px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(d.dia.slice(5), x, H - 8);
      // valor
      if (d.concluidas) { ctx.fillStyle = "#eef1f7"; ctx.fillText(d.concluidas, x, base - hC - 6); }
    });

    // linha de minutos
    ctx.strokeStyle = "#4bd18a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    dados.forEach(function (d, i) {
      var x = i * passo + passo / 2;
      var y = base - (d.minutos / maxM) * (base - topo);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#4bd18a";
    dados.forEach(function (d, i) {
      var x = i * passo + passo / 2;
      var y = base - (d.minutos / maxM) * (base - topo);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    });
  }

  // ---------------- Moedas / monetização ----------------
  function telaMoedas() {
    var est = store.estado();
    var rec = store.previsaoReceita();
    var html = '<div class="card saldo"><div class="v">' + est.moedas + " 🪙</div>" +
      '<div class="u">moedas SMART acumuladas</div></div>';

    html += '<h2 class="secao">Resgatar recompensas</h2>';
    store.opcoesResgate().forEach(function (op) {
      var desc = op.id === "token"
        ? "Troca " + op.custo + " moedas por " + op.taxa + " tokens SMART (mercado secundário)."
        : "Troca " + op.custo + " moedas por " + op.unidade + (op.custo * op.taxa).toFixed(2) +
          " (taxa de plataforma de 10% sobre o valor).";
      html += '<div class="opcao"><div class="info"><div class="nome">' + esc(op.nome) +
        '</div><div class="desc">' + esc(desc) + "</div></div>" +
        '<button class="btn-primario" data-resgatar="' + op.id + '">Resgatar</button></div>';
    });

    html += '<h2 class="secao">Receita da plataforma</h2><div class="grade">' +
      kpi("R$ " + rec.assinaturaMes.toFixed(2), "Assinatura/mês") +
      kpi("R$ " + rec.taxaSobreResgate.toFixed(2), "Taxa de resgates") +
      kpi(est.moedasResgatadas, "Moedas resgatadas") +
      kpi("R$ " + rec.receitaTotal.toFixed(2), "Receita total", "ok") +
      "</div>";

    if (est.resgates.length) {
      html += '<h2 class="secao">Histórico de resgates</h2><div class="card">';
      est.resgates.slice().reverse().slice(0, 8).forEach(function (r) {
        html += '<div class="slot" style="border-top:1px solid var(--borda);padding:8px 0">' +
          esc(r.opcaoNome) + " · " + r.moedas + " moedas → " + r.liquido + "</div>";
      });
      html += "</div>";
    }

    $("#tela").innerHTML = html;
    $$("[data-resgatar]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-resgatar");
        var op = store.opcoesResgate().filter(function (o) { return o.id === id; })[0];
        var min = op.custo;
        var r = store.resgatar(id, store.estado().moedas >= min ? min : 0);
        if (r.ok) toast("Resgatado! Você recebeu " + r.resgate.liquido + " (" + r.resgate.moedas + " moedas).", "ok");
        else toast(r.erro, "erro");
        render();
      };
    });
  }

  // ---------------- Ajustes ----------------
  function telaAjustes() {
    var est = store.estado();
    var html = '<h2 class="secao">Plano de assinatura</h2>';
    Object.keys(store.planos).forEach(function (id) {
      var p = store.planos[id];
      var atual = est.plano === id;
      html += '<div class="plano ' + (atual ? "atual" : "") + '">' +
        "<h3>" + p.nome + (atual ? ' <span style="font-size:11px;color:var(--ok)">· atual</span>' : "") + "</h3>" +
        '<div class="preco">R$ ' + p.precoMes.toFixed(2) + "<small>/mês</small></div>" +
        "<ul><li>" + (p.maxAtivas >= 100000 ? "Tarefas ilimitadas" : "Até " + p.maxAtivas + " tarefas ativas") + "</li>" +
        "<li>Histórico de " + (p.historicoDias >= 3650 ? "tempo integral" : p.historicoDias + " dias") + "</li>" +
        "<li>" + (p.exportar ? "Exportação de dados" : "Sem exportação") + "</li>" +
        (p.equipe ? "<li>Pacote de análises para equipes (RH)</li>" : "") + "</ul>" +
        (atual ? "" : '<button class="btn-primario" data-plano="' + id + '" style="width:100%">Assinar ' + p.nome + "</button>") +
        "</div>";
    });

    html += '<h2 class="secao">Dados</h2><div class="card">' +
      '<button class="btn-secundario" id="btn-exportar" style="width:100%;margin-bottom:8px">Exportar JSON</button>' +
      '<textarea id="area-json" rows="4" placeholder="Cole um JSON exportado para importar"></textarea>' +
      '<button class="btn-secundario" id="btn-importar" style="width:100%;margin-top:8px">Importar JSON</button>' +
      "</div>";

    html += '<div class="card">' +
      '<button class="btn-secundario" id="btn-demo" style="width:100%;margin-bottom:8px">Recarregar tarefas de exemplo</button>' +
      '<button class="btn-secundario" id="btn-reset" style="width:100%;color:var(--erro)">Apagar tudo e recomeçar</button>' +
      "</div>";

    html += '<div class="card" style="text-align:center;color:var(--suave);font-size:12px">' +
      "<b>SmartTasker</b> · versão 1.0<br>Pronto para auxiliar em sua jornada de planejamento de tarefas!</div>";

    $("#tela").innerHTML = html;

    $$("[data-plano]").forEach(function (b) {
      b.onclick = function () {
        var r = store.definirPlano(b.getAttribute("data-plano"));
        if (r.ok) toast("Plano " + r.plano.nome + " ativado.", "ok");
        render();
      };
    });
    $("#btn-exportar").onclick = function () {
      var r = store.exportarJSON();
      if (!r.ok) return toast(r.erro, "erro");
      $("#area-json").value = r.json;
      if (window.AndroidBridge && window.AndroidBridge.compartilhar) {
        try { window.AndroidBridge.compartilhar(r.json); } catch (e) {}
      }
      toast("JSON gerado abaixo.", "ok");
    };
    $("#btn-importar").onclick = function () {
      var r = store.importarJSON($("#area-json").value);
      toast(r.ok ? "Importado!" : r.erro, r.ok ? "ok" : "erro");
      render();
    };
    $("#btn-demo").onclick = function () { store.semearDemo(); toast("Exemplos recarregados.", "ok"); render(); };
    $("#btn-reset").onclick = function () {
      if (confirm("Apagar todas as tarefas e recomeçar?")) { store.reiniciar(); render(); }
    };
  }

  // ---------------- Modal ----------------
  function abrirModal(id) {
    editandoId = id || null;
    var t = id ? acharTarefa(id) : null;
    $("#modal-titulo").textContent = t ? "Editar tarefa" : "Nova tarefa";
    $("#f-titulo").value = t ? t.titulo : "";
    $("#f-categoria").value = t ? t.categoria : "";
    $("#f-prioridade").value = t ? t.prioridade : "media";
    $("#f-vencimento").value = t ? (t.vencimento || "") : "";
    $("#f-recorrencia").value = t ? t.recorrencia : "nenhuma";
    $("#f-estimativa").value = t ? t.estimativaMin : 30;
    $("#f-notas").value = t ? t.notas : "";
    var dl = $("#lista-categorias");
    dl.innerHTML = store.categorias().map(function (c) { return '<option value="' + esc(c) + '">'; }).join("");
    $("#modal").classList.remove("oculto");
    setTimeout(function () { $("#f-titulo").focus(); }, 60);
  }

  function fecharModal() { $("#modal").classList.add("oculto"); editandoId = null; }

  function salvarModal(e) {
    e.preventDefault();
    var dados = {
      titulo: $("#f-titulo").value,
      categoria: $("#f-categoria").value || "Geral",
      prioridade: $("#f-prioridade").value,
      vencimento: $("#f-vencimento").value,
      recorrencia: $("#f-recorrencia").value,
      estimativaMin: Number($("#f-estimativa").value) || 30,
      notas: $("#f-notas").value
    };
    var r = editandoId ? store.atualizarTarefa(editandoId, dados) : store.addTarefa(dados);
    if (!r.ok) return toast(r.erro, "erro");
    fecharModal();
    toast(editandoId ? "Tarefa atualizada." : "Tarefa criada.", "ok");
    render();
  }

  // ---------------- lembretes ----------------
  function checarLembretes() {
    var agora = new Date();
    var alvo = agora.getTime() + 5 * 60000; // 5 min à frente
    var est = store.estado();
    var dia = window.SmartTasker._util.hoje();
    est.tarefas.forEach(function (t) {
      if (t.feita || !t.vencimento || t.vencimento.indexOf("T") < 0) return;
      if (t.vencimento.slice(0, 10) !== dia) return;
      if (notificados[t.id]) return;
      var quando = new Date(t.vencimento).getTime();
      if (quando <= alvo && quando > agora.getTime() - 60000) {
        notificados[t.id] = true;
        notificar("⏰ " + t.titulo, "Vence às " + horaDe(t.vencimento));
      }
    });
  }

  // ---------------- render ----------------
  function render() {
    var est = store.estado();
    var p = store.planoAtual();
    var badge = $("#badge-plano");
    badge.textContent = p.nome;
    badge.className = "topo-plano" + (est.plano !== "gratis" ? " premium" : "");

    if (abaAtual === "tarefas") telaTarefas();
    else if (abaAtual === "agenda") telaAgenda();
    else if (abaAtual === "foco") telaFoco();
    else if (abaAtual === "relatorios") telaRelatorios();
    else if (abaAtual === "moedas") telaMoedas();
    else if (abaAtual === "ajustes") telaAjustes();

    $$("#abas button").forEach(function (b) {
      b.classList.toggle("ativa", b.getAttribute("data-tab") === abaAtual);
    });
    $("#fab").classList.toggle("oculto", abaAtual !== "tarefas" && abaAtual !== "agenda");
  }

  // ---------------- eventos fixos ----------------
  $$("#abas button").forEach(function (b) {
    b.onclick = function () { abaAtual = b.getAttribute("data-tab"); render(); };
  });
  $("#fab").onclick = function () { abrirModal(null); };
  $("#btn-cancelar").onclick = fecharModal;
  $("#form-tarefa").addEventListener("submit", salvarModal);
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") fecharModal(); });

  if ("Notification" in window && Notification.permission === "default") {
    try { Notification.requestPermission(); } catch (e) {}
  }

  render();
  setInterval(function () {
    atualizarCronometro();
    checarLembretes();
  }, 1000);

  // expõe para depuração / testes manuais no WebView
  window.__smarttasker = { store: store, render: render };
})();
