/*
 * SmartTasker — teste de fumaça do núcleo (store.js).
 * Roda com: node tools/smoke-test.mjs
 * Não precisa de Android nem de navegador.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const aqui = dirname(fileURLToPath(import.meta.url));
const caminhoStore = resolve(aqui, "../app/src/main/assets/store.js");

await import(caminhoStore);
const ST = globalThis.SmartTasker;
if (!ST) {
  console.error("FALHA: store.js não expôs SmartTasker");
  process.exit(1);
}

let passou = 0, falhou = 0;
function ok(cond, nome) {
  if (cond) { passou++; console.log("  ✓ " + nome); }
  else { falhou++; console.log("  ✗ " + nome); }
}
function eq(a, b, nome) { ok(a === b, nome + " (esperado " + JSON.stringify(b) + ", veio " + JSON.stringify(a) + ")"); }

console.log("\n== núcleo: tarefas ==");
const store = ST.criarStore(ST.driverMemoria());

const r1 = store.addTarefa({ titulo: "Estudar Android", prioridade: "alta", categoria: "Dev", vencimento: ST._util.hoje() + "T10:00", estimativaMin: 60 });
ok(r1.ok, "cria tarefa");
eq(store.estado().tarefas.length, 1, "1 tarefa no estado");
eq(store.listarTarefas({ status: "ativas" }).length, 1, "1 ativa");

const rDone = store.concluir(r1.tarefa.id);
ok(rDone.ok, "conclui tarefa");
eq(rDone.recompensa, 20, "recompensa alta = 20 moedas");
eq(store.estado().moedas, 20, "saldo de moedas = 20");
eq(store.listarTarefas({ status: "feitas" }).length, 1, "aparece em concluídas");
ok(store.reabrir(r1.tarefa.id).ok, "reabre tarefa");
eq(store.estado().moedas, 0, "reabrir estorna as moedas");

console.log("\n== recorrência ==");
const rec = store.addTarefa({ titulo: "Beber água", recorrencia: "diaria", vencimento: ST._util.hoje() + "T08:00", prioridade: "baixa" });
const rRec = store.concluir(rec.tarefa.id);
ok(rRec.proxima, "gera próxima ocorrência");
const proxDia = rRec.proxima.vencimento.split("T")[0];
eq(proxDia, ST._util.somarDias(ST._util.hoje(), 1), "próxima é amanhã");

console.log("\n== freemium (limite de tarefas ativas) ==");
const sFree = ST.criarStore(ST.driverMemoria());
let aceitos = 0, bloqueado = null;
for (let i = 0; i < 15; i++) {
  const r = sFree.addTarefa({ titulo: "T" + i });
  if (r.ok) aceitos++; else bloqueado = r.erro;
}
eq(aceitos, ST.PLANOS.gratis.maxAtivas, "plano grátis limita a 10 ativas");
ok(/Pro/.test(bloqueado || ""), "mensagem sugere upgrade");

console.log("\n== foco (timer) ==");
const sT = ST.criarStore(ST.driverMemoria());
const t = sT.addTarefa({ titulo: "Foco" }).tarefa;
ok(sT.iniciarFoco(t.id).ok, "inicia foco");
await new Promise((r) => setTimeout(r, 30));
const parou = sT.pararFoco();
ok(parou.ok, "para foco");
ok(parou.segundos >= 1, "registra segundos");
eq(sT.segundosFoco(t.id) >= 1, true, "segundos acumulados na tarefa");

console.log("\n== monetização: planos, moedas e resgate ==");
const sM = ST.criarStore(ST.driverMemoria());
eq(sM.planoAtual().id, "gratis", "começa no grátis");
ok(!sM.exportarJSON().ok, "grátis não exporta");
ok(sM.definirPlano("pro").ok, "assina Pro");
ok(sM.exportarJSON().ok, "Pro exporta");
eq(sM.planoAtual().precoMes, 19.9, "preço Pro = 19,90");

// paga moedas executando tarefas e resgata
const sR = ST.criarStore(ST.driverMemoria());
for (let i = 0; i < 6; i++) {
  const r = sR.addTarefa({ titulo: "Job " + i, prioridade: "alta" });
  sR.concluir(r.tarefa.id);
}
eq(sR.estado().moedas, 120, "6 tarefas alta => 120 moedas");
const rj = sR.resgatar("dinheiro", 100);
ok(rj.ok, "resgata 100 moedas");
ok(Math.abs(rj.resgate.bruto - 1) < 0.001, "bruto R$ 1,00 (0,01/moeda)");
ok(Math.abs(rj.resgate.liquido - 0.9) < 0.001, "líquido R$ 0,90 após taxa de 10%");
eq(sR.estado().moedas, 20, "saldo restante = 20");
eq(sR.previsaoReceita().assinaturaMes, 0, "assinatura grátis = 0");

console.log("\n== relatórios ==");
const res = sR.resumo();
eq(res.total, 6, "total de tarefas");
eq(res.concluidas, 6, "todas concluídas");
eq(res.taxaConclusao, 100, "100% de conclusão");
ok(Array.isArray(sR.ultimos(7)) && sR.ultimos(7).length === 7, "série de 7 dias");
ok(typeof sR.porCategoria().Geral === "object", "agrupa por categoria");

console.log("\n== agenda e atrasadas ==");
const sA = ST.criarStore(ST.driverMemoria());
sA.addTarefa({ titulo: "Atrasada", vencimento: ST._util.somarDias(ST._util.hoje(), -2) + "T09:00" });
sA.addTarefa({ titulo: "Hoje", vencimento: ST._util.hoje() + "T15:00" });
eq(sA.atrasadas().length, 1, "detecta 1 atrasada");
eq(sA.agenda(7).length, 7, "agenda devolve 7 dias");
eq(sA.agenda(7)[0].tarefas.length, 1, "hoje tem 1 tarefa");

console.log("\n== import/export ==");
const sE = ST.criarStore(ST.driverMemoria());
sE.definirPlano("pro");
sE.addTarefa({ titulo: "Backup" });
const exp = sE.exportarJSON();
const sE2 = ST.criarStore(ST.driverMemoria());
ok(sE2.importarJSON(exp.json).ok, "importa JSON exportado");
eq(sE2.estado().tarefas.length, 1, "1 tarefa recuperada");

console.log("\n== semente demo ==");
const sD = ST.criarStore(ST.driverMemoria());
sD.semearDemo();
ok(sD.estado().tarefas.length >= 6, "gera ao menos 6 tarefas demo");
ok(sD.resumo().concluidas >= 1, "tem histórico concluído");

console.log("\n== integridade dos arquivos ==");
const raiz = resolve(aqui, "..");
const assets = resolve(raiz, "app/src/main/assets");
const html = readFileSync(resolve(assets, "index.html"), "utf8");
["store.js", "app.js", "estilo.css", "manifest.webmanifest"].forEach((f) => {
  ok(existsSync(resolve(assets, f)), "asset existe: " + f);
  ok(html.includes(f), "index.html referencia " + f);
});
ok(existsSync(resolve(raiz, "app/src/main/AndroidManifest.xml")), "AndroidManifest.xml");
ok(existsSync(resolve(raiz, "app/src/main/java/com/empresa/smarttasker/MainActivity.java")), "MainActivity.java");
ok(existsSync(resolve(raiz, "app/src/main/res/drawable/ic_launcher.xml")), "ícone vetorial");
ok(existsSync(resolve(raiz, "app/build.gradle")), "app/build.gradle");

console.log("\n----------------------------------------");
console.log(passou + " passaram, " + falhou + " falharam.");
process.exit(falhou === 0 ? 0 : 1);
