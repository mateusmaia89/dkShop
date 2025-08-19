
import React, { useEffect, useMemo, useState } from "react";

/**
 * Catálogo + Busca + Calculadora de Parcelamento
 *
 * Persistência dos juros: localStorage OU NocoDB (linhas: Parcelas/Juros).
 * - Config via variáveis de ambiente VITE_* (veja .env.example).
 * - Suporta refresh dos juros no botão "Atualizar dados".
 */

// ============================
// Config NocoDB via ENV
// ============================
const Noco = {
  baseUrl: import.meta.env.VITE_NOCO_URL || "",
  token: import.meta.env.VITE_NOCO_TOKEN || "",
  tables: {
    android: import.meta.env.VITE_NOCO_TABLE_ANDROID || "",
    iphonesNovos: import.meta.env.VITE_NOCO_TABLE_IPHONES_NOVOS || "",
    iphonesSeminovos: import.meta.env.VITE_NOCO_TABLE_IPHONES_SEMIS || "",
  },
  juros: {
    tableId: import.meta.env.VITE_NOCO_TABLE_JUROS || "",
    parcelasColumn: import.meta.env.VITE_JUROS_PARCELAS_COL || "Parcelas",
    jurosColumn: import.meta.env.VITE_JUROS_JUROS_COL || "Juros",
    percentAsFraction: String(import.meta.env.VITE_JUROS_PERCENT_AS_FRACTION || "false").toLowerCase() === "true",
  },
};

// ============================
// Tabela de Juros (padrão)
// ============================
const DEFAULT_JUROS = {
  1: 5.176,
  2: 6.307,
  3: 6.923,
  4: 7.549,
  5: 8.158,
  6: 8.789,
  7: 9.711,
  8: 10.344,
  9: 10.849,
  10: 11.588,
  11: 12.024,
  12: 12.776,
  13: 13.453,
  14: 14.239,
  15: 14.953,
  16: 15.565,
  17: 16.357,
  18: 17.047,
};

const JUROS_STORAGE_KEY = "catalogo_juros_v1";

// --------------------
// Noco helpers
// --------------------
async function nocoList(tableId, limit = 1000) {
  const url = `${Noco.baseUrl}/api/v2/tables/${tableId}/records?limit=${limit}`;
  const res = await fetch(url, { headers: { "xc-token": Noco.token } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.list || json?.records || [];
}
async function nocoCreate(tableId, payload) {
  const url = `${Noco.baseUrl}/api/v2/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xc-token": Noco.token, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function nocoPatch(tableId, recordId, payload) {
  const url = `${Noco.baseUrl}/api/v2/tables/${tableId}/records/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "xc-token": Noco.token, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normalizeJurosObj(obj) {
  const out = { ...DEFAULT_JUROS };
  try {
    for (let i = 1; i <= 18; i++) {
      const v = obj?.[i] ?? obj?.[String(i)];
      const num = parseFloat(String(v));
      if (Number.isFinite(num)) out[i] = num;
    }
  } catch {}
  return out;
}

function extractJurosFromRows(rows, cfg) {
  const out = { ...DEFAULT_JUROS };
  if (!rows) return out;
  for (const row of rows) {
    const p = parseInt(row?.[cfg.parcelasColumn]);
    let v = row?.[cfg.jurosColumn];
    const cleaned = String(v).replace(/,/g, ".").replace(/[^0-9.\-]/g, "");
    const num = parseFloat(cleaned);
    if (!Number.isFinite(p) || !Number.isFinite(num)) continue;
    let perc = num;
    if (cfg.percentAsFraction && Math.abs(perc) <= 1) perc = perc * 100;
    out[p] = perc;
  }
  return out;
}

// ============================
// Hook de juros (localStorage ou NocoDB em LINHAS)
// ============================
function useJuros() {
  const [juros, setJuros] = useState({ ...DEFAULT_JUROS });
  const [persist, setPersist] = useState({ mode: "local", error: null, loading: false });
  const [rowsCache, setRowsCache] = useState(null);
  const [tick, setTick] = useState(0);
  const cfg = Noco.juros || {};

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cfg.tableId || !Noco.baseUrl || !Noco.token) {
        // localStorage fallback
        try {
          const raw = localStorage.getItem(JUROS_STORAGE_KEY);
          if (raw) setJuros(normalizeJurosObj(JSON.parse(raw)));
        } catch {}
        setPersist((p) => ({ ...p, mode: "local" }));
        return;
      }
      try {
        setPersist((p) => ({ ...p, loading: true, error: null }));
        const rows = await nocoList(cfg.tableId, 1000);
        const j = extractJurosFromRows(rows, cfg);
        if (!cancelled) {
          setRowsCache(rows);
          setJuros({ ...j });
          setPersist({ mode: "nocodb-rows", error: null, loading: false });
        }
      } catch (e) {
        console.warn("Falha ao ler juros do NocoDB, caindo para localStorage:", e);
        try {
          const raw = localStorage.getItem(JUROS_STORAGE_KEY);
          if (raw) setJuros(normalizeJurosObj(JSON.parse(raw)));
        } catch {}
        if (!cancelled) setPersist({ mode: "local", error: String(e?.message || e), loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const setRate = (n, v) => setJuros((prev) => ({ ...prev, [n]: v }));
  const reload = () => setTick((t) => t + 1);

  const save = async () => {
    if (persist.mode === "nocodb-rows" && cfg.tableId && Noco.baseUrl && Noco.token) {
      try {
        const currentRows = rowsCache || (await nocoList(cfg.tableId, 1000));
        const byParcela = new Map();
        for (const r of currentRows) {
          const k = parseInt(r?.[cfg.parcelasColumn]);
          if (Number.isFinite(k)) byParcela.set(k, r);
        }
        for (let i = 1; i <= 18; i++) {
          const existing = byParcela.get(i);
          let perc = juros[i];
          if (!Number.isFinite(perc)) perc = 0;
          const payload = {
            [cfg.parcelasColumn]: i,
            [cfg.jurosColumn]: cfg.percentAsFraction ? perc / 100 : perc,
          };
          if (existing) {
            const recId = existing?.Id ?? existing?.id ?? existing?.__id;
            await nocoPatch(cfg.tableId, recId, { [cfg.jurosColumn]: payload[cfg.jurosColumn] });
          } else {
            await nocoCreate(cfg.tableId, payload);
          }
        }
        const rows = await nocoList(cfg.tableId, 1000);
        setRowsCache(rows);
      } catch (e) {
        setPersist((p) => ({ ...p, error: String(e?.message || e) }));
        throw e;
      }
      return;
    }
    try { localStorage.setItem(JUROS_STORAGE_KEY, JSON.stringify(juros)); } catch {}
  };

  const reset = () => setJuros({ ...DEFAULT_JUROS });
  return { juros, setRate, save, reset, persist, reload };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// ============================
// Utils
// ============================
function toNumberBR(v) {
  if (v == null) return 0;
  const s = String(v)
    .replace(/[^0-9,\.]/g, "")
    .replace(/\./g, "")
    .replace(/,(\d{2})$/, ".$1");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function onMoneyInput(e, setValue) {
  const raw = e.target.value.replace(/[^0-9]/g, "");
  const cents = raw === "" ? 0 : Number(raw);
  setValue(brl.format(cents / 100));
}
function parseJurosInput(s) {
  const v = parseFloat(String(s).replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(v) ? v : 0;
}
function calcParcelas(valorStr, entradaStr, n, jurosMap) {
  const base = Math.max(0, toNumberBR(valorStr) - toNumberBR(entradaStr));
  const taxa = (jurosMap && jurosMap[n]) ?? DEFAULT_JUROS[n] ?? 0;
  const total = base * (1 + taxa / 100);
  const valorParcela = n > 0 ? total / n : 0;
  return { base, n, taxa, valorParcela };
}
function tituloFromRow(row, fallbackMarca) {
  const parts = [];
  if (row.Marca || fallbackMarca) parts.push(row.Marca || fallbackMarca);
  if (row.Modelo) parts.push(row.Modelo);
  if (row.Versao) parts.push(row.Versao);
  if (row.Armazenamento) parts.push(row.Armazenamento);
  return parts.join(" ").trim();
}

// ============================
// Hook de dados NocoDB (com botão de refresh)
// ============================
function useNocoRecords(tableId) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!tableId || !Noco.baseUrl || !Noco.token) {
        setData([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const url = `${Noco.baseUrl}/api/v2/tables/${tableId}/records?limit=500`;
        const res = await fetch(url, { headers: { "xc-token": Noco.token } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rows = json?.list || json?.records || [];
        if (!cancelled) setData(rows);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Erro ao buscar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [tableId, tick]);

  const reload = () => setTick((t) => t + 1);
  return { data, loading, error, reload };
}

// ============================
// UI helpers
// ============================
function Pill({ children }) {
  return (
    <span className="inline-flex items-center rounded-xl border border-gray-200 px-2 py-0.5 text-xs text-gray-600 bg-white">
      {children}
    </span>
  );
}
function SectionHeader({ title, count }) {
  return (
    <div className="flex items-center justify-between mt-10 mb-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <span className="text-xs text-gray-500">{count} itens</span>
    </div>
  );
}
function KeyVal({ k, v }) {
  return (
    <div className="text-sm text-gray-600 flex items-center justify-between border-b border-gray-100 py-1">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-gray-800">{v ?? "-"}</span>
    </div>
  );
}
function Card({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-3xl border border-gray-200 bg-white/80 p-4 shadow-sm hover:shadow transition active:scale-[.99]"
    >
      {children}
    </button>
  );
}
function JurosEditor({ open, onClose, juros, setRate, onSave, onReset, persist }) {
  if (!open) return null;
  const modeLabel = persist?.mode === "nocodb-rows" ? "NocoDB (linhas)" : "Local";
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-base font-semibold">Editar tabela de juros</h4>
        <div className="flex items-center gap-2 text-xs text-gray-500">Persistência: {modeLabel}</div>
      </div>
      {persist?.error && (
        <div className="mt-2 text-xs text-red-600">Erro ao salvar/ler no NocoDB: {String(persist.error)}</div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mt-3">
        {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
          <div key={n} className="rounded-xl border border-gray-200 bg-white p-2">
            <div className="text-xs text-gray-500">{n}x</div>
            <div className="flex items-center gap-1 mt-1">
              <input
                className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-black/10"
                inputMode="decimal"
                value={Number(juros[n]).toFixed(3)}
                onChange={(e) => setRate(n, parseJurosInput(e.target.value))}
              />
              <span className="text-xs text-gray-500">%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button onClick={onSave} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-white">Salvar</button>
        <button onClick={onReset} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-white">Resetar</button>
        <button onClick={onClose} className="rounded-xl border px-3 py-1.5 text-sm hover:bg-white">Fechar</button>
      </div>
      <div className="text-xs text-gray-500 mt-2">Dica: use vírgula ou ponto. Ex.: 12,345</div>
    </div>
  );
}

// ============================
// Componente principal
// ============================
export default function App() {
  // Dados
    const isEmbed = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('embed');
  
  const { data: dAndroid, loading: lA, error: eA, reload: rA } = useNocoRecords(Noco.tables.android);
  const { data: dNovos, loading: lN, error: eN, reload: rN } = useNocoRecords(Noco.tables.iphonesNovos);
  const { data: dSemis, loading: lS, error: eS, reload: rS } = useNocoRecords(Noco.tables.iphonesSeminovos);

  // Juros
  const { juros, setRate, save: saveJuros, reset: resetJuros, persist, reload: reloadJuros } = useJuros();
  const [showEditor, setShowEditor] = useState(false);

  // Busca & calculadora
  const [q, setQ] = useState("");
  const [valor, setValor] = useState("");
  const [entrada, setEntrada] = useState("");
  const [nParcelas, setNParcelas] = useState(10);

  const sq = q.trim().toLowerCase();
  const parcelasCalc = useMemo(() => calcParcelas(valor, entrada, nParcelas, juros), [valor, entrada, nParcelas, juros]);

  function filterList(list, marcaFallback) {
    if (!list || !Array.isArray(list)) return [];
    if (!sq) return list;
    return list.filter((row) => tituloFromRow(row, marcaFallback).toLowerCase().includes(sq));
  }

  // Listas filtradas
  const android = useMemo(() => filterList(dAndroid, "Android"), [dAndroid, sq]);
  const iphonesNovos = useMemo(() => filterList(dNovos, "iPhone"), [dNovos, sq]);
  const iphonesSemis = useMemo(() => filterList(dSemis, "iPhone"), [dSemis, sq]);

  // Clique para aplicar preço no cálculo
  function handleSelectPrice(v) {
    if (v == null || v === "") return;
    try {
      const num = toNumberBR(v);
      setValor(brl.format(num));
      const el = document.getElementById("calc");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {}
  }

  // Testes básicos (console.assert)
  useEffect(() => {
    try {
      console.assert(toNumberBR("R$ 5.599,00") === 5599, "toNumberBR 5.599,00 -> 5599");
      console.assert(toNumberBR("2.099") === 2099, "toNumberBR 2.099 -> 2099");
      const t10 = calcParcelas("R$ 1.000,00", "R$ 0,00", 10, DEFAULT_JUROS);
      console.assert(t10.n === 10 && Math.abs(t10.taxa - (DEFAULT_JUROS[10] || 0)) < 1e-9, "taxa 10x ok");
      const t18 = calcParcelas("R$ 1.000,00", "R$ 0,00", 18, DEFAULT_JUROS);
      console.assert(t18.n === 18 && Math.abs(t18.taxa - (DEFAULT_JUROS[18] || 0)) < 1e-9, "taxa 18x ok");
      console.assert(parseFloat("12,776".replace(",", ".")) === 12.776, "vírgula para ponto");
    } catch (e) { console.warn("Tests falharam:", e); }
  }, []);

  // Regras de exibição
  const searching = sq.length > 0;
  const androidFirst = /\bandroid\b/i.test(sq);

  const showNovos = !searching || iphonesNovos.length > 0;
  const showSemis = !searching || iphonesSemis.length > 0;
  const showAndroid = !searching || android.length > 0;

  const BlkNovos = (
    <>
      <SectionHeader title="iPhones (novos)" count={iphonesNovos.length} />
      {lN && <div className="text-sm text-gray-500">Carregando…</div>}
      {eN && <div className="text-sm text-red-600">Erro: {eN}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {iphonesNovos.map((r, i) => (
          <Card key={`n-${i}`} onClick={() => handleSelectPrice(r.Valor)}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold">{`${r.Modelo ?? ""} ${r.Versao ?? ""} ${r.Armazenamento ?? ""}`.trim()}</div>
              <Pill>{r.tipo ?? "Novo"}</Pill>
            </div>
            <KeyVal k="versão" v={r.Versao} />
            <KeyVal k="status" v={r.Status} />
            <KeyVal k="armazenamento" v={r.Armazenamento} />
            <KeyVal k="garantia" v={r.garantia} />
            <KeyVal k="cor" v={r.Cor} />
            <KeyVal k="prazo de entrega" v={r.PrazoEntrega} />
            <div className="mt-3 text-right text-base font-semibold">{r.Valor ? brl.format(Number(toNumberBR(r.Valor))) : "—"}</div>
          </Card>
        ))}
      </div>
    </>
  );

  const BlkSemis = (
    <>
      <SectionHeader title="iPhones (seminovos)" count={iphonesSemis.length} />
      {lS && <div className="text-sm text-gray-500">Carregando…</div>}
      {eS && <div className="text-sm text-red-600">Erro: {eS}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {iphonesSemis.map((r, i) => (
          <Card key={`s-${i}`} onClick={() => handleSelectPrice(r.Valor)}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold">{`${r.Modelo ?? ""} ${r.Versao ?? ""} ${r.Armazenamento ?? ""}`.trim()}</div>
              <Pill>{r.tipo ?? "Seminovo"}</Pill>
            </div>
            <KeyVal k="versão" v={r.Versao} />
            <KeyVal k="status" v={r.Status} />
            <KeyVal k="armazenamento" v={r.Armazenamento} />
            <KeyVal k="garantia" v={r.garantia} />
            <KeyVal k="cor" v={r.Cor} />
            <KeyVal k="prazo de entrega" v={r.PrazoEntrega} />
            <div className="mt-3 text-right text-base font-semibold">{r.Valor ? brl.format(Number(toNumberBR(r.Valor))) : "—"}</div>
          </Card>
        ))}
      </div>
    </>
  );

  const BlkAndroid = (
    <>
      <SectionHeader title="Android" count={android.length} />
      {lA && <div className="text-sm text-gray-500">Carregando…</div>}
      {eA && <div className="text-sm text-red-600">Erro: {eA}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {android.map((r, i) => (
          <Card key={`a-${i}`} onClick={() => handleSelectPrice(r.Valor)}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold">{tituloFromRow(r, r.Marca || "Android")}</div>
              <Pill>{r.tipo ?? "Android"}</Pill>
            </div>
            <KeyVal k="status" v={r.Status} />
            <KeyVal k="armazenamento" v={r.Armazenamento} />
            <KeyVal k="processador" v={r.Processador} />
            <KeyVal k="memória RAM" v={r.MemoriaRam} />
            <KeyVal k="garantia" v={r.garantia} />
            <KeyVal k="cor" v={r.Cor} />
            <KeyVal k="prazo de entrega" v={r.PrazoEntrega} />
            <div className="mt-3 text-right text-base font-semibold">{r.Valor ? brl.format(Number(toNumberBR(r.Valor))) : "—"}</div>
          </Card>
        ))}
      </div>
    </>
  );

  return (
    return (
  <div
    className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-900"
    style={isEmbed ? {
      height: '100dvh',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain',
    } : undefined}
  >
      {/* header */}
      <header className={`${isEmbed ? '' : 'sticky top-0'} z-20 backdrop-blur bg-white/70 border-b border-gray-200`}>
        <div className="mx-auto max-w-6xl px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-black text-white grid place-items-center font-bold">DK</div>
              <div className="leading-tight">
                <div className="text-base font-semibold tracking-tight" style={{ fontFamily: "Geomanist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Inter, system-ui, sans-serif" }}>Catálogo</div>
                <div className="text-xs text-gray-500">Android • iPhones novos • iPhones seminovos</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { rA(); rN(); rS(); reloadJuros(); }}
                className="hidden sm:inline-flex items-center gap-2 rounded-2xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 active:scale-[.99]"
                title="Atualizar dados (aparelhos + juros)"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M20 8a8 8 0 10-3 9"/></svg>
                Atualizar dados
              </button>
              <div className="text-xs text-gray-500 hidden sm:block">Preview em Canvas</div>
            </div>
          </div>

          {/* Calculadora */}
          <div id="calc" className="rounded-3xl border border-gray-200 bg-white/70 p-4 md:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold tracking-tight">Cálculo de parcelamento</h3>
              <div className="flex items-center gap-2">
                <Pill>Taxas conforme tabela</Pill>
                <button
                  onClick={() => setShowEditor((v) => !v)}
                  className="rounded-2xl border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  {showEditor ? "Fechar juros" : "Editar juros"}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Valor (obrigatório)</label>
                <input
                  className="w-full rounded-2xl border border-gray-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="R$ 0,00"
                  value={valor}
                  onChange={(e) => onMoneyInput(e, setValor)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Entrada (opcional)</label>
                <input
                  className="w-full rounded-2xl border border-gray-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
                  placeholder="R$ 0,00"
                  value={entrada}
                  onChange={(e) => onMoneyInput(e, setEntrada)}
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Número de parcelas</label>
                <select
                  className="w-full rounded-2xl border border-gray-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/10"
                  value={nParcelas}
                  onChange={(e) => setNParcelas(Number(e.target.value))}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
            {parcelasCalc ? (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Valor total</div>
                    <div className="text-base font-semibold text-gray-900">{brl.format(parcelasCalc.base)}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Parcelas</div>
                    <div className="text-base font-semibold text-gray-900">{parcelasCalc.n}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Taxa de juros</div>
                    <div className="text-base font-semibold text-gray-900">{parcelasCalc.taxa.toFixed(3)}% <span className="text-xs text-gray-500">(para {parcelasCalc.n} parcelas)</span></div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Valor da parcela</div>
                    <div className="text-base font-semibold text-gray-900">{brl.format(parcelasCalc.valorParcela)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-gray-500">Preencha o <strong>Valor</strong> para ver o cálculo.</div>
            )}

            {/* Editor de Juros (abre/fecha) */}
            <JurosEditor
              open={showEditor}
              onClose={() => setShowEditor(false)}
              juros={juros}
              setRate={setRate}
              onSave={saveJuros}
              onReset={resetJuros}
              persist={persist}
            />
          </div>

          {/* Busca */}
          <div className="relative">
            <input
              className="w-full rounded-3xl border border-gray-300 bg-white py-3 pl-12 pr-4 outline-none focus:ring-2 focus:ring-black/10"
              placeholder="Busque por título (ex: iPhone 15 Pro 256GB, Xiaomi Poco X7 Pro)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ fontFamily: "Geomanist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Inter, system-ui, sans-serif" }}
            />
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.6-4.15a7.25 7.25 0 11-14.5 0 7.25 7.25 0 0114.5 0z"/></svg>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16">
        {androidFirst ? (
          <>
            {showAndroid && BlkAndroid}
            {showNovos && BlkNovos}
            {showSemis && BlkSemis}
          </>
        ) : (
          <>
            {showNovos && BlkNovos}
            {showSemis && BlkSemis}
            {showAndroid && BlkAndroid}
          </>
        )}
        <footer className="mt-12 text-center text-xs text-gray-400">
          <div>
            Tipografia: <span style={{ fontFamily: "Geomanist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Inter, system-ui, sans-serif" }}>Geomanist</span> (se instalada). Em produção, servir via @font-face.
          </div>
        </footer>
      </main>
    </div>
  );
}
