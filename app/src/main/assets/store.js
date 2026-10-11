/*
 * SmartTasker — núcleo de domínio (store.js)
 * ---------------------------------------------------------------
 * Toda a regra de negócio do app vive aqui, isolada da interface e
 * da persistência. Roda em três lugares:
 *   - no Android (WebView)  -> window.SmartTasker
 *   - no navegador (dev/PWA) -> window.SmartTasker
 *   - no Node (testes)      -> globalThis.SmartTasker
 *
 * A persistência é injetada via "driver" com read()/write(), então o
 * mesmo código funciona com localStorage, SharedPreferences (ponte
 * nativa Android) ou memória (testes).
 *
 * Zero dependências externas de propósito.
 */
(function (global) {
  "use strict";

  var CHAVE = "smarttasker.v1";
  var MOEDA_FEE = 0.10; // taxa da plataforma sobre resgates (10%)

  // ---- Planos -----------------------------------------------------------
  // Freemium: grátis limita tarefas ativas e histórico; Pro libera tudo;
  // Business adiciona pacote de análises para equipes (ideia de receita).
  var PLANOS = {
    gratis: {
      id: "gratis",
      nome: "Grátis",
      precoMes: 0,
      maxAtivas: 10,
      historicoDias: 7,
      exportar: false,
      equipe: false
    },
    pro: {
      id: "pro",
      nome: "Pro",
      precoMes: 19.9,
      maxAtivas: 1000,
      historicoDias: 3650,
      exportar: true,
      equipe: false
    },
    business: {
      id: "business",
      nome: "Business (equipes)",
      precoMes: 99.9,
      maxAtivas: 100000,
      historicoDias: 3650,
      exportar: true,
      equipe: true
    }
  };

  // Recompensas: quanto cada tarefa concluída paga, por prioridade.
  var RECOMPENSA = { baixa: 5, media: 10, alta: 20 };

  // Opções de resgate de moedas (pitch: dinheiro, créditos ou tokens).
  var RESGATES = [
    { id: "dinheiro", nome: "Dinheiro (PIX)", custo: 100, taxa: 0.01, unidade: "R$" },
    { id: "credito", nome: "Crédito no app", custo: 100, taxa: 0.012, unidade: "R$" },
    { id: "token", nome: "Tokens SMART", custo: 100, taxa: 1.5, unidade: "SMART" }
  ];

  // ---- Utilidades de data ----------------------------------------------
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function diaDe(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function hoje() { return diaDe(new Date()); }

  function somarDias(diaStr, n) {
    var p = diaStr.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return diaDe(d);
  }

  function somarMeses(diaStr, n) {
    var p = diaStr.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setMonth(d.getMonth() + n);
    return diaDe(d);
  }

  function agoraISO() { return new Date().toISOString(); }

  function uid() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Estado inicial ---------------------------------------------------
  function estadoInicial() {
    return {
      versao: 1,
      tarefas: [],
      timer: null, // { tarefaId, inicio }
      moedas: 0,
      moedasResgatadas: 0,
      resgates: [], // { id, opcaoId, moedas, recebido, em }
      plano: "gratis",
      eventos: [] // log simples para o relatório
    };
  }

  // ---- Fábrica da store -------------------------------------------------
  function criarStore(driver) {
    var estado = carregar();

    function carregar() {
      try {
        var bruto = driver.read(CHAVE);
        if (!bruto) return estadoInicial();
        var obj = JSON.parse(bruto);
        var base = estadoInicial();
        for (var k in base) if (!(k in obj)) obj[k] = base[k];
        return obj;
      } catch (e) {
        return estadoInicial();
      }
    }

    function salvar() {
      try {
        driver.write(CHAVE, JSON.stringify(estado));
      } catch (e) { /* armazenamento indisponível: segue em memória */ }
    }

    function evento(tipo, dado) {
      estado.eventos.push({ tipo: tipo, dado: dado, em: agoraISO() });
      if (estado.eventos.length > 500) estado.eventos.shift();
    }

    function planoAtual() { return PLANOS[estado.plano] || PLANOS.gratis; }
    function ehPremium() { return estado.plano !== "gratis"; }

    function ativas() {
      return estado.tarefas.filter(function (t) { return !t.feita; });
    }

    // ---- CRUD de tarefas ------------------------------------------------
    function addTarefa(dados) {
      dados = dados || {};
      var p = planoAtual();
      if (ativas().length >= p.maxAtivas) {
        return { ok: false, erro: "Limite do plano " + p.nome + " atingido (" + p.maxAtivas + " tarefas ativas). Assine o Pro para liberar." };
      }
      var t = {
        id: uid(),
        titulo: (dados.titulo || "Nova tarefa").trim(),
        notas: dados.notas || "",
        categoria: dados.categoria || "Geral",
        prioridade: dados.prioridade || "media",
        vencimento: dados.vencimento || "", // "YYYY-MM-DDTHH:MM" ou ""
        recorrencia: dados.recorrencia || "nenhuma",
        estimativaMin: Number(dados.estimativaMin) || 30,
        criadaEm: agoraISO(),
        concluidaEm: null,
        feita: false,
        moedas: 0,
        sessoes: []
      };
      estado.tarefas.push(t);
      evento("criada", t.id);
      salvar();
      return { ok: true, tarefa: t };
    }

    function achar(id) {
      for (var i = 0; i < estado.tarefas.length; i++) {
        if (estado.tarefas[i].id === id) return estado.tarefas[i];
      }
      return null;
    }

    function atualizarTarefa(id, mudancas) {
      var t = achar(id);
      if (!t) return { ok: false, erro: "Tarefa não encontrada" };
      var permitido = ["titulo", "notas", "categoria", "prioridade", "vencimento",
        "recorrencia", "estimativaMin"];
      permitido.forEach(function (k) {
        if (mudancas && mudancas[k] !== undefined) t[k] = mudancas[k];
      });
      if (t.estimativaMin) t.estimativaMin = Number(t.estimativaMin) || 30;
      evento("editada", t.id);
      salvar();
      return { ok: true, tarefa: t };
    }

    function removerTarefa(id) {
      if (estado.timer && estado.timer.tarefaId === id) estado.timer = null;
      estado.tarefas = estado.tarefas.filter(function (t) { return t.id !== id; });
      evento("removida", id);
      salvar();
      return { ok: true };
    }

    // Conclui a tarefa: paga recompensa e, se recorrente, agenda a próxima.
    function concluir(id) {
      var t = achar(id);
      if (!t || t.feita) return { ok: false, erro: "Tarefa inválida ou já concluída" };
      t.feita = true;
      t.concluidaEm = agoraISO();
      t.moedas = (RECOMPENSA[t.prioridade] || 10) + bônusFoco(t);
      estado.moedas += t.moedas;
      evento("concluida", t.id);

      var proxima = null;
      if (t.recorrencia !== "nenhuma" && t.vencimento) {
        proxima = clonarProxima(t);
      }
      salvar();
      return { ok: true, tarefa: t, recompensa: t.moedas, proxima: proxima };
    }

    function reabrir(id) {
      var t = achar(id);
      if (!t || !t.feita) return { ok: false, erro: "Tarefa não concluída" };
      t.feita = false;
      t.concluidaEm = null;
      estado.moedas = Math.max(0, estado.moedas - (t.moedas || 0));
      t.moedas = 0;
      evento("reaberta", t.id);
      salvar();
      return { ok: true, tarefa: t };
    }

    function bônusFoco(t) {
      var min = Math.floor(segundosFoco(t) / 60);
      return Math.min(30, Math.floor(min / 10)); // 1 moeda a cada 10 min, teto 30
    }

    function clonarProxima(t) {
      var data = (t.vencimento || "").split("T")[0];
      var hora = (t.vencimento || "").indexOf("T") >= 0 ? "T" + t.vencimento.split("T")[1] : "";
      var novaData = data;
      if (t.recorrencia === "diaria") novaData = somarDias(data, 1);
      else if (t.recorrencia === "semanal") novaData = somarDias(data, 7);
      else if (t.recorrencia === "mensal") novaData = somarMeses(data, 1);
      var nova = {
        id: uid(), titulo: t.titulo, notas: t.notas, categoria: t.categoria,
        prioridade: t.prioridade, vencimento: novaData + hora, recorrencia: t.recorrencia,
        estimativaMin: t.estimativaMin, criadaEm: agoraISO(), concluidaEm: null,
        feita: false, moedas: 0, sessoes: []
      };
      estado.tarefas.push(nova);
      evento("recorrente", nova.id);
      return nova;
    }

    // ---- Timer de foco --------------------------------------------------
    function iniciarFoco(id) {
      var t = achar(id);
      if (!t) return { ok: false, erro: "Tarefa não encontrada" };
      if (estado.timer) pararFoco();
      estado.timer = { tarefaId: id, inicio: agoraISO() };
      evento("foco_inicio", id);
      salvar();
      return { ok: true, timer: estado.timer };
    }

    function pararFoco() {
      if (!estado.timer) return { ok: false, erro: "Nenhum foco ativo" };
      var t = achar(estado.timer.tarefaId);
      var inicio = new Date(estado.timer.inicio).getTime();
      var fim = Date.now();
      var segundos = Math.max(1, Math.round((fim - inicio) / 1000));
      if (t) t.sessoes.push({ inicio: estado.timer.inicio, fim: agoraISO(), segundos: segundos });
      var id = estado.timer.tarefaId;
      estado.timer = null;
      evento("foco_fim", id);
      salvar();
      return { ok: true, segundos: segundos };
    }

    // Aceita tanto o objeto da tarefa quanto o seu id.
    function segundosFoco(t) {
      if (typeof t === "string") t = achar(t);
      if (!t) return 0;
      var s = 0;
      (t.sessoes || []).forEach(function (x) { s += x.segundos || 0; });
      return s;
    }

    function segundosFocoAoVivo(t) {
      if (typeof t === "string") t = achar(t);
      if (!t) return 0;
      var s = segundosFoco(t);
      if (estado.timer && estado.timer.tarefaId === t.id) {
        s += Math.max(0, Math.round((Date.now() - new Date(estado.timer.inicio).getTime()) / 1000));
      }
      return s;
    }

    // ---- Consultas ------------------------------------------------------
    function listarTarefas(filtro) {
      filtro = filtro || {};
      var hojeStr = hoje();
      var lista = estado.tarefas.slice();
      if (filtro.status === "ativas") lista = lista.filter(function (t) { return !t.feita; });
      if (filtro.status === "feitas") lista = lista.filter(function (t) { return t.feita; });
      if (filtro.categoria) lista = lista.filter(function (t) { return t.categoria === filtro.categoria; });
      if (filtro.dia) lista = lista.filter(function (t) { return (t.vencimento || "").split("T")[0] === filtro.dia; });
      if (filtro.atrasadas) lista = lista.filter(function (t) {
        return !t.feita && t.vencimento && (t.vencimento.split("T")[0] < hojeStr);
      });
      var peso = { alta: 0, media: 1, baixa: 2 };
      lista.sort(function (a, b) {
        if (a.feita !== b.feita) return a.feita ? 1 : -1;
        var va = a.vencimento || "9999", vb = b.vencimento || "9999";
        if (va !== vb) return va < vb ? -1 : 1;
        return (peso[a.prioridade] || 1) - (peso[b.prioridade] || 1);
      });
      return lista;
    }

    function categorias() {
      var set = {};
      estado.tarefas.forEach(function (t) { set[t.categoria || "Geral"] = true; });
      return Object.keys(set).sort();
    }

    function agenda(dias) {
      dias = dias || 7;
      var saida = [];
      var base = hoje();
      for (var i = 0; i < dias; i++) {
        var d = somarDias(base, i);
        saida.push({
          dia: d,
          tarefas: listarTarefas({ dia: d }).filter(function (t) { return !t.feita; })
        });
      }
      return saida;
    }

    function atrasadas() { return listarTarefas({ atrasadas: true }); }

    // ---- Relatórios -----------------------------------------------------
    function resumo() {
      var todas = estado.tarefas;
      var feitas = todas.filter(function (t) { return t.feita; });
      var focoSeg = 0;
      todas.forEach(function (t) { focoSeg += segundosFoco(t); });
      var hojeStr = hoje();
      var atrasadasN = todas.filter(function (t) {
        return !t.feita && t.vencimento && t.vencimento.split("T")[0] < hojeStr;
      }).length;
      var taxa = todas.length ? Math.round((feitas.length / todas.length) * 100) : 0;
      return {
        total: todas.length,
        concluidas: feitas.length,
        ativas: todas.length - feitas.length,
        atrasadas: atrasadasN,
        minutosFoco: Math.round(focoSeg / 60),
        moedas: estado.moedas,
        taxaConclusao: taxa
      };
    }

    function ultimos(nDias) {
      nDias = nDias || 7;
      var limite = planoAtual().historicoDias;
      if (nDias > limite) nDias = limite;
      var saida = [];
      var base = hoje();
      for (var i = nDias - 1; i >= 0; i--) {
        var d = somarDias(base, -i);
        var concluidas = 0, minutos = 0;
        estado.tarefas.forEach(function (t) {
          if (t.concluidaEm && t.concluidaEm.slice(0, 10) === d) concluidas++;
          (t.sessoes || []).forEach(function (s) {
            if (s.inicio && s.inicio.slice(0, 10) === d) minutos += Math.round(s.segundos / 60);
          });
        });
        saida.push({ dia: d, concluidas: concluidas, minutos: minutos });
      }
      return saida;
    }

    function porCategoria() {
      var mapa = {};
      estado.tarefas.forEach(function (t) {
        var c = t.categoria || "Geral";
        if (!mapa[c]) mapa[c] = { total: 0, concluidas: 0, minutos: 0 };
        mapa[c].total++;
        if (t.feita) mapa[c].concluidas++;
        mapa[c].minutos += Math.round(segundosFoco(t) / 60);
      });
      return mapa;
    }

    // Projeção de receita da plataforma (MRR): assinaturas + taxa sobre resgates.
    function previsaoReceita() {
      var assinatura = planoAtual().precoMes;
      var mediaMoedas = estado.tarefas.length
        ? estado.moedas / Math.max(1, estado.tarefas.filter(function (t) { return t.feita; }).length)
        : 0;
      return {
        assinaturaMes: assinatura,
        taxaSobreResgate: estado.moedasResgatadas * MOEDA_FEE,
        moedasAcumuladas: estado.moedas,
        receitaTotal: assinatura + estado.moedasResgatadas * MOEDA_FEE
      };
    }

    // ---- Monetização ----------------------------------------------------
    function definirPlano(id) {
      if (!PLANOS[id]) return { ok: false, erro: "Plano inválido" };
      estado.plano = id;
      evento("plano", id);
      salvar();
      return { ok: true, plano: PLANOS[id] };
    }

    function opcoesResgate() { return RESGATES.slice(); }

    // Converte moedas em dinheiro/crédito/token, descontando a taxa da plataforma.
    function resgatar(opcaoId, moedas) {
      var op = null;
      RESGATES.forEach(function (r) { if (r.id === opcaoId) op = r; });
      if (!op) return { ok: false, erro: "Opção inválida" };
      moedas = Math.floor(Number(moedas) || 0);
      if (moedas < op.custo) return { ok: false, erro: "Mínimo de " + op.custo + " moedas" };
      if (moedas > estado.moedas) return { ok: false, erro: "Saldo insuficiente" };
      // Valor bruto: para dinheiro/crédito a taxa é "por moeda" (ex.: 0.01 => R$1 a cada
      // 100 moedas). Para tokens a taxa já é "por bloco de 100 moedas".
      var valor;
      if (op.id === "token") valor = (moedas / op.custo) * op.taxa;
      else valor = (moedas / op.custo) * (op.custo * op.taxa);
      var liquido = valor * (1 - MOEDA_FEE);
      var registro = {
        id: uid(), opcaoId: op.id, opcaoNome: op.nome, moedas: moedas,
        bruto: arredondar(valor), liquido: arredondar(liquido), em: agoraISO()
      };
      estado.moedas -= moedas;
      estado.moedasResgatadas += moedas;
      estado.resgates.push(registro);
      evento("resgate", registro.id);
      salvar();
      return { ok: true, resgate: registro };
    }

    function arredondar(v) { return Math.round(v * 100) / 100; }

    // ---- Import/Export --------------------------------------------------
    function exportarJSON() {
      if (!planoAtual().exportar) {
        return { ok: false, erro: "Exportação disponível nos planos Pro/Business." };
      }
      return { ok: true, json: JSON.stringify(estado, null, 2) };
    }

    function importarJSON(texto) {
      try {
        var obj = JSON.parse(texto);
        if (!obj || !Array.isArray(obj.tarefas)) return { ok: false, erro: "JSON inválido" };
        estado = obj;
        var base = estadoInicial();
        for (var k in base) if (!(k in estado)) estado[k] = base[k];
        salvar();
        return { ok: true };
      } catch (e) {
        return { ok: false, erro: "Não foi possível ler o JSON" };
      }
    }

    function reiniciar() { estado = estadoInicial(); salvar(); return { ok: true }; }

    // ---- Semente de demonstração ---------------------------------------
    function semearDemo() {
      estado = estadoInicial();
      var base = hoje();
      var dados = [
        { titulo: "Revisar pull requests", categoria: "Trabalho", prioridade: "alta", vencimento: base + "T09:00", estimativaMin: 45, recorrencia: "diaria" },
        { titulo: "Reunião de planejamento", categoria: "Trabalho", prioridade: "media", vencimento: base + "T14:00", estimativaMin: 60 },
        { titulo: "Escrever testes do módulo de login", categoria: "Dev", prioridade: "alta", vencimento: base + "T16:30", estimativaMin: 90 },
        { titulo: "Ler 20 páginas", categoria: "Pessoal", prioridade: "baixa", vencimento: somarDias(base, 1) + "T20:00", estimativaMin: 30, recorrencia: "diaria" },
        { titulo: "Pagar contas do mês", categoria: "Financeiro", prioridade: "media", vencimento: somarDias(base, -1) + "T10:00", estimativaMin: 20 },
        { titulo: "Planejar sprint da equipe", categoria: "Trabalho", prioridade: "alta", vencimento: somarDias(base, 2) + "T11:00", estimativaMin: 60, recorrencia: "semanal" }
      ];
      dados.forEach(function (d) {
        var r = addTarefa(d);
        if (r.ok) {
          // simula histórico de foco para o relatório
          if (d.prioridade === "alta") {
            r.tarefa.sessoes.push({
              inicio: base + "T09:05:00",
              fim: base + "T09:35:00",
              segundos: 1800
            });
          }
        }
      });
      // marca uma como concluída ontem para aparecer no relatório
      var ontem = somarDias(base, -1);
      var t = estado.tarefas[2];
      if (t) { t.feita = true; t.concluidaEm = ontem + "T17:00:00"; t.moedas = 20; estado.moedas += 20; }
      salvar();
      return { ok: true };
    }

    // ---- API pública ----------------------------------------------------
    return {
      estado: function () { return estado; },
      salvar: salvar,
      planos: PLANOS,
      planoAtual: planoAtual,
      ehPremium: ehPremium,
      // tarefas
      addTarefa: addTarefa,
      atualizarTarefa: atualizarTarefa,
      removerTarefa: removerTarefa,
      concluir: concluir,
      reabrir: reabrir,
      listarTarefas: listarTarefas,
      categorias: categorias,
      agenda: agenda,
      atrasadas: atrasadas,
      // foco
      iniciarFoco: iniciarFoco,
      pararFoco: pararFoco,
      segundosFoco: segundosFoco,
      segundosFocoAoVivo: segundosFocoAoVivo,
      // relatórios
      resumo: resumo,
      ultimos: ultimos,
      porCategoria: porCategoria,
      previsaoReceita: previsaoReceita,
      // monetização
      definirPlano: definirPlano,
      opcoesResgate: opcoesResgate,
      resgatar: resgatar,
      // dados
      exportarJSON: exportarJSON,
      importarJSON: importarJSON,
      reiniciar: reiniciar,
      semearDemo: semearDemo
    };
  }

  // ---- Drivers de persistência -----------------------------------------
  function driverNavegador(storage) {
    return {
      read: function (k) { try { return storage.getItem(k); } catch (e) { return null; } },
      write: function (k, v) { try { storage.setItem(k, v); } catch (e) {} }
    };
  }

  function driverMemoria(inicial) {
    var dados = {};
    if (inicial) dados[CHAVE] = inicial;
    return {
      read: function (k) { return dados[k] === undefined ? null : dados[k]; },
      write: function (k, v) { dados[k] = v; }
    };
  }

  // Ponte nativa Android: window.AndroidBridge.persistSave/persistLoad.
  function driverAndroid(bridge) {
    return {
      read: function (k) { try { return bridge.persistLoad(k) || null; } catch (e) { return null; } },
      write: function (k, v) { try { bridge.persistSave(k, v); } catch (e) {} }
    };
  }

  function driverPadrao() {
    if (typeof global.AndroidBridge !== "undefined" && global.AndroidBridge) {
      return driverAndroid(global.AndroidBridge);
    }
    if (typeof global.localStorage !== "undefined") {
      return driverNavegador(global.localStorage);
    }
    return driverMemoria();
  }

  var api = {
    criarStore: criarStore,
    driverNavegador: driverNavegador,
    driverMemoria: driverMemoria,
    driverAndroid: driverAndroid,
    driverPadrao: driverPadrao,
    PLANOS: PLANOS,
    RESGATES: RESGATES,
    RECOMPENSA: RECOMPENSA,
    _util: { hoje: hoje, somarDias: somarDias, somarMeses: somarMeses, diaDe: diaDe }
  };

  global.SmartTasker = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
