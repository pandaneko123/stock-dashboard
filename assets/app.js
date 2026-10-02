// data/market.json を読み込み、奪還率を計算して表示する。
// market.json の rows は [日付, 日中高値, 終値] の配列。

const STATUS = [
  { id: "above", label: "突破済み", range: "100%超", test: (r) => r > 100 },
  { id: "near", label: "近い", range: "95〜100%", test: (r) => r >= 95 },
  { id: "mid", label: "中間", range: "90%以上95%未満", test: (r) => r >= 90 },
  { id: "far", label: "遠い", range: "90%未満", test: () => true },
];
const statusOf = (ratio) => STATUS.find((s) => s.test(ratio));

const state = { mode: "ref", query: "" };
let data, analyzed, chart;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- 書式 ----------
const ymd = (d) => { const [y, m, day] = d.split("-").map(Number); return { y, m, day }; };
const fmtDateLong = (d) => { const { y, m, day } = ymd(d); return `${y}年${m}月${day}日`; };
const fmtMonthDay = (d) => { const { m, day } = ymd(d); return `${m}月${day}日`; };
const fmtDateShort = (d) => d.slice(5).replace("-", "/");
const fmtPrice = (v, s) => {
  const digits = s.market === "JP" && s.kind === "stock" ? 0 : 2;
  return v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtRatio = (r, s) => `${r.toFixed(s.kind === "index" ? 2 : 1)}%`;
const fmtSigned = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const unitLabel = (s) => (s.kind === "index" ? "指数ポイント" : s.currency === "JPY" ? "円" : "米ドル");
const marketLabel = (s) => ({ US: "米国", JP: "日本" })[s.market] ?? s.market;
// 一覧での表示名：米国株はティッカー、日本株は銘柄名
const shortName = (s) => (s.kind === "stock" && s.market === "US" ? s.symbol : s.name);
const ratioOf = (a) => (state.mode === "ref" ? a.ref.ratio : a.ytd.ratio);

// ---------- 計算 ----------
function analyze(s, settings) {
  const rows = s.rows;
  if (rows.length < 2) return null;
  const last = rows.at(-1);
  const close = last[2];

  const maxHigh = (from, to) => {
    let best = null;
    for (const r of rows) if (r[0] >= from && r[0] <= to && (!best || r[1] > best[1])) best = r;
    return best;
  };

  // 期間高値：基準期間の日中高値の最高値
  const refRow = maxHigh(settings.refStart, settings.refEnd);
  // 年初来高値：比較日の前営業日までの日中高値の最高値（終値で更新したかを判定するため）
  const ytdRow = maxHigh(settings.yearStart, rows.at(-2)[0]);
  if (!refRow || !ytdRow) return null;

  const after = rows.filter((r) => r[0] > settings.refEnd);
  let streak = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i][0] > settings.refEnd && rows[i][2] > refRow[1]; i--) streak++;

  const first = rows.find((r) => r[0] >= settings.yearStart);
  return {
    s,
    close,
    date: last[0],
    ytdChange: first ? (close / first[2] - 1) * 100 : null,
    ref: {
      high: refRow[1],
      date: refRow[0],
      ratio: (close / refRow[1]) * 100,
      firstHigh: after.find((r) => r[1] > refRow[1])?.[0],
      firstClose: after.find((r) => r[2] > refRow[1])?.[0],
      streak,
    },
    ytd: {
      high: ytdRow[1],
      date: ytdRow[0],
      ratio: (close / ytdRow[1]) * 100,
      daysAgo: rows.length - 1 - rows.indexOf(ytdRow),
    },
  };
}

// ---------- 詳細パネル ----------
function sparkline(a, settings) {
  const pts = a.s.rows.filter((r) => r[0] >= settings.yearStart);
  const level = state.mode === "ref" ? a.ref.high : a.ytd.high;
  const w = 320, h = 80, pad = 4;
  const vals = pts.map((r) => r[2]).concat(level);
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i) => pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const line = pts.map((r, i) => `${x(i).toFixed(1)},${y(r[2]).toFixed(1)}`).join(" ");

  let band = "";
  if (state.mode === "ref") {
    const idx = pts.map((r, i) => (r[0] >= settings.refStart && r[0] <= settings.refEnd ? i : -1)).filter((i) => i >= 0);
    if (idx.length) band = `<rect x="${x(idx[0])}" y="0" width="${x(idx.at(-1)) - x(idx[0])}" height="${h}" fill="var(--band)"/>`;
  }
  const label = state.mode === "ref" ? `${esc(settings.refLabel)}の日中高値` : "年初来高値";
  return `<div><svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="年初来の終値推移">
    ${band}
    <line x1="0" x2="${w}" y1="${y(level)}" y2="${y(level)}" stroke="var(--muted)" stroke-dasharray="4 3" stroke-width="1"/>
    <polyline points="${line}" fill="none" stroke="var(--c)" stroke-width="1.8" stroke-linejoin="round"/>
  </svg><div class="spark-caption">年初来の終値 · 点線＝${label}</div></div>`;
}

function detailHtml(a, settings) {
  const s = a.s;
  const m = state.mode === "ref" ? a.ref : a.ytd;
  const gap = (a.close / m.high - 1) * 100;
  const need = (m.high / a.close - 1) * 100;
  const highLabel = state.mode === "ref" ? `${esc(settings.refLabel)}の日中高値` : "年初来高値（前日まで）";

  let note;
  if (state.mode === "ref") {
    const r = a.ref;
    if (r.firstHigh || r.firstClose) {
      note = `${esc(settings.refLabel)}以降の初回突破：日中 ${r.firstHigh ? fmtDateShort(r.firstHigh) : "なし"} ／ 終値 ${r.firstClose ? fmtDateShort(r.firstClose) : "未突破"}`;
      if (r.streak > 0) note += ` · 現在 ${r.streak}日連続で終値が上`;
    } else {
      note = `${esc(settings.refLabel)}以降、日中高値の突破はまだありません`;
    }
  } else {
    note = a.ytd.ratio > 100
      ? "比較日の終値で年初来高値を更新しました"
      : `年初来高値の記録日：${fmtDateShort(a.ytd.date)}（${a.ytd.daysAgo}営業日前）`;
  }

  const name = s.kind === "stock" ? `${s.name}（${s.symbol}）· ` : "";
  return `<div class="detail">
    <p class="meta">${esc(name)}${marketLabel(s)} · ${unitLabel(s)}</p>
    <dl>
      <dt>${fmtDateShort(a.date)} 終値</dt><dd>${fmtPrice(a.close, s)}</dd>
      <dt>${highLabel}</dt><dd>${fmtPrice(m.high, s)}<small>${fmtDateShort(m.date)}</small></dd>
      <dt>高値との差</dt><dd class="${gap >= 0 ? "up" : "down"}">${fmtSigned(gap)}</dd>
      <dt>高値までの上昇率</dt><dd>${m.ratio > 100 ? "奪還済み" : fmtSigned(need)}</dd>
    </dl>
    ${sparkline(a, settings)}
    <p class="note">${note}</p>
  </div>`;
}

// ---------- 描画 ----------
function openSymbols() {
  return new Set([...document.querySelectorAll("details[open]")].map((d) => d.dataset.symbol).filter(Boolean));
}

function renderHeader() {
  const { settings } = data;
  const year = ymd(settings.refStart).y;
  const isRef = state.mode === "ref";
  $("eyebrow").textContent = isRef ? `${year}年${settings.refLabel}の高値との比較` : `${ymd(settings.yearStart).y}年の年初来高値との比較`;
  $("title").textContent = isRef ? `${settings.refLabel}高値の奪還率` : "年初来高値の奪還率";
  $("tab-ref").textContent = `${settings.refLabel}高値の奪還率`;
  document.title = `${$("title").textContent}｜${settings.subtitle}`;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.mode === state.mode));

  const asOf = fmtMonthDay(data.asOf);
  $("formula").innerHTML = isRef
    ? `<span class="formula-key">${esc(settings.refLabel)}高値 ＝ 100%</span>
       <span>奪還率 ＝ ${asOf}終値 ÷ ${fmtMonthDay(settings.refStart)}〜${fmtMonthDay(settings.refEnd)}の日中高値の最高値 × 100</span>`
    : `<span class="formula-key">年初来高値 ＝ 100%</span>
       <span>奪還率 ＝ ${asOf}終値 ÷ 年初から前営業日までの日中高値の最高値 × 100（100%超＝終値で更新）</span>`;
  $("index-bars-title").textContent = isRef ? `主要指数の${settings.refLabel}高値に対する現在位置` : "主要指数の年初来高値に対する現在位置";
  $("index-bars-note").textContent = `${isRef ? `${settings.refLabel}高値` : "年初来高値"} ＝ 100% · ${fmtDateLong(data.asOf)}終値`;
}

function renderIndexBars() {
  const open = openSymbols();
  const { settings } = data;
  const max = 110;
  const pos = (v) => (Math.min(Math.max(v, 0), max) / max) * 100;
  const items = analyzed.filter((a) => a.s.kind === "index").sort((x, y) => ratioOf(y) - ratioOf(x));

  const axis = `<div class="bars-axis" aria-hidden="true"><span></span><div class="bars-scale">
      <span style="left:0">0%</span><span style="left:${pos(50)}%">50%</span><span class="strong" style="left:${pos(100)}%">100%</span>
    </div><span class="bars-axis-right">奪還率</span></div>`;

  const rows = items.map((a) => {
    const r = ratioOf(a);
    const st = statusOf(r);
    const diff = r - 100;
    const sub = diff > 0 ? `超過 +${diff.toFixed(2)}pt` : `あと${(-diff).toFixed(2)}pt`;
    return `<details class="bar-row st-${st.id}" data-symbol="${esc(a.s.symbol)}"${open.has(a.s.symbol) ? " open" : ""}>
      <summary>
        <span class="bar-name">${esc(a.s.name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pos(r)}%"></span><span class="bar-100" style="left:${pos(100)}%"></span></span>
        <span class="bar-val"><b class="num">${fmtRatio(r, a.s)}</b><small>${sub}</small></span>
      </summary>
      ${detailHtml(a, settings)}
    </details>`;
  }).join("");

  $("index-bars").innerHTML = axis + rows;
}

function renderStocks() {
  const open = openSymbols();
  const { settings } = data;
  const q = state.query.trim().toLowerCase();
  const stocks = analyzed.filter((a) => a.s.kind === "stock");

  // 全体の分類別集計
  const byMarket = new Map();
  for (const a of stocks) byMarket.set(marketLabel(a.s), (byMarket.get(marketLabel(a.s)) ?? 0) + 1);
  const markets = [...byMarket].map(([k, n]) => `${k}${n}`).join(" / ");
  $("stock-total").textContent = `${stocks.length}銘柄 · ${markets}`;
  $("status-summary").innerHTML = STATUS.map((st) => {
    const n = stocks.filter((a) => statusOf(ratioOf(a)) === st).length;
    return `<div class="sum-card st-${st.id}"><div><b>${st.label}</b><small>${st.range}</small></div><span class="num">${n}</span></div>`;
  }).join("");

  let shown = 0;
  const html = data.groups
    .filter((g) => g.kind === "stock")
    .map((g) => {
      const visible = stocks
        .filter((a) => a.s.group === g.id)
        .filter((a) => !q || a.s.symbol.toLowerCase().includes(q) || a.s.name.toLowerCase().includes(q))
        .sort((x, y) => ratioOf(y) - ratioOf(x));
      if (!visible.length) return "";
      shown += visible.length;

      const cols = STATUS.map((st) => {
        const items = visible.filter((a) => statusOf(ratioOf(a)) === st);
        const list = items.length
          ? items.map((a) => `<details class="item st-${st.id}" data-symbol="${esc(a.s.symbol)}"${open.has(a.s.symbol) ? " open" : ""}>
              <summary><span class="item-name">${esc(shortName(a.s))}</span><span class="item-val num">${fmtRatio(ratioOf(a), a.s)}</span><span class="plus" aria-hidden="true"></span></summary>
              ${detailHtml(a, settings)}
            </details>`).join("")
          : `<p class="none">該当なし</p>`;
        return `<div class="col st-${st.id}"><div class="col-head"><b>${st.label}</b><span>${items.length}銘柄</span></div>${list}</div>`;
      }).join("");

      return `<div class="group">
        <div class="group-head"><h3>${esc(g.label)}</h3><span class="muted small">${visible.length}銘柄</span></div>
        <div class="board">${cols}</div>
      </div>`;
    })
    .join("");

  $("stock-groups").innerHTML = html;
  $("no-results").hidden = shown > 0;
}

const PALETTE = ["#2f5fd0", "#0f8a9a", "#6b7280", "#7c4dcc", "#e0702a", "#c2417a", "#3d8b37", "#b08900"];

function renderChart() {
  if (!window.Chart) return;
  const { settings } = data;
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();

  const indices = analyzed.filter((a) => a.s.kind === "index");
  const labels = [...new Set(indices.flatMap((a) => a.s.rows.map((r) => r[0])))].filter((d) => d >= settings.yearStart).sort();
  const datasets = indices.map((a, i) => {
    const rows = a.s.rows.filter((r) => r[0] >= settings.yearStart);
    const base = rows[0][2];
    const byDate = new Map(rows.map((r) => [r[0], (r[2] / base) * 100]));
    return {
      label: a.s.name,
      data: labels.map((d) => byDate.get(d) ?? null),
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE[i % PALETTE.length],
      borderWidth: 1.8,
      borderDash: a.s.market === "JP" ? [5, 4] : [],
      pointRadius: 0,
      pointHoverRadius: 3,
      spanGaps: true,
      tension: 0.15,
    };
  });

  const refBand = {
    id: "refBand",
    beforeDatasetsDraw(c) {
      const idx = labels.map((d, i) => (d >= settings.refStart && d <= settings.refEnd ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return;
      const { ctx, chartArea, scales } = c;
      const x0 = scales.x.getPixelForValue(idx[0]);
      const x1 = scales.x.getPixelForValue(idx.at(-1));
      ctx.save();
      ctx.fillStyle = v("--band");
      ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
      ctx.fillStyle = v("--muted");
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(settings.refLabel, (x0 + x1) / 2, chartArea.top + 12);
      ctx.restore();
    },
  };

  const hidden = new Set(chart ? chart.data.datasets.filter((_, i) => !chart.isDatasetVisible(i)).map((d) => d.label) : []);
  chart?.destroy();
  chart = new Chart($("index-chart"), {
    type: "line",
    data: { labels, datasets },
    plugins: [refBand],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: v("--muted"), autoSkip: false, maxRotation: 0,
            callback: (val, i) => (i === 0 || labels[i].slice(5, 7) !== labels[i - 1].slice(5, 7) ? `${Number(labels[i].slice(5, 7))}月` : null),
          },
        },
        y: { grid: { color: v("--border") }, ticks: { color: v("--muted") } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: {
            title: (items) => fmtDateLong(labels[items[0].dataIndex]),
            label: (item) => ` ${item.dataset.label}: ${item.parsed.y.toFixed(1)}`,
          },
        },
      },
    },
  });
  datasets.forEach((d, i) => hidden.has(d.label) && chart.setDatasetVisibility(i, false));
  chart.update();

  // 凡例：年初来の騰落率つき。クリックで表示を切り替える
  $("chart-legend-title").textContent = `${fmtMonthDay(data.asOf)}の年初来騰落率`;
  $("chart-legend").innerHTML = indices.map((a, i) => {
    const color = PALETTE[i % PALETTE.length];
    const dash = a.s.market === "JP" ? "dashed" : "solid";
    return `<button type="button" class="legend-item" data-index="${i}" aria-pressed="${chart.isDatasetVisible(i)}">
      <span class="legend-line" style="border-top:2px ${dash} ${color}"></span>
      <span class="legend-name">${esc(a.s.name)}</span>
      <b class="num" style="color:${color}">${a.ytdChange >= 0 ? "+" : ""}${a.ytdChange.toFixed(2)}%</b>
    </button>`;
  }).join("");
  $("chart-note").textContent = `${fmtDateLong(settings.yearStart).replace(/1月1日$/, "")}年初〜${fmtMonthDay(data.asOf)}の日次終値を、年初の終値＝100として比較。実線＝米国、点線＝日本。網掛けは${settings.refLabel}。`;
}

function renderMethod() {
  const { settings } = data;
  const stocks = analyzed.filter((a) => a.s.kind === "stock").length;
  $("method").innerHTML = `
    <p>${esc(settings.refLabel)}タブでは ${fmtDateLong(settings.refStart)}〜${fmtMonthDay(settings.refEnd)} の日中高値の最大値、年初来タブでは年初から比較日の前営業日までの日中高値の最大値を100%とし、比較日（${fmtDateLong(data.asOf)}）の終値と比べています。配当込みのリターンではありません。</p>
    <p>分類は丸める前の値で判定します。100%超は「突破済み」、95%以上100%以下は「近い」、90%以上95%未満は「中間」、90%未満は「遠い」です。100%ちょうどは突破に含めません。</p>
    <p>対象は日米のAI・半導体・データセンター関連から選んだ${stocks}銘柄と主要指数です。市場全体を網羅するものではありません。</p>
    <p>${data.isDummy ? "<strong>現在表示しているのはプログラムで生成したダミーデータです。</strong>" : ""}日付と価格は各市場の現地基準です。</p>`;
  $("generated").textContent = `データ作成：${new Date(data.generatedAt).toLocaleString("ja-JP")}`;
}

function renderAll() {
  renderHeader();
  renderIndexBars();
  renderStocks();
}

// ---------- 初期化 ----------
async function main() {
  try {
    const res = await fetch("data/market.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $("stock-groups").innerHTML = `<p class="empty">データを読み込めませんでした（${esc(err.message)}）。</p>`;
    return;
  }

  analyzed = data.series.map((s) => analyze(s, data.settings)).filter(Boolean);
  $("subtitle").textContent = data.settings.subtitle;
  $("asof").textContent = `${fmtDateLong(data.asOf)} 終値`;
  $("dummy-banner").hidden = !data.isDummy;

  renderAll();
  renderChart();
  renderMethod();

  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => { state.mode = b.dataset.mode; renderAll(); });
  }
  $("search").addEventListener("input", (e) => { state.query = e.target.value; renderStocks(); });
  $("chart-legend").addEventListener("click", (e) => {
    const btn = e.target.closest(".legend-item");
    if (!btn) return;
    const i = Number(btn.dataset.index);
    const visible = !chart.isDatasetVisible(i);
    chart.setDatasetVisibility(i, visible);
    chart.update();
    btn.setAttribute("aria-pressed", String(visible));
  });
  const setAll = (open) => document.querySelectorAll("#stock-groups details.item").forEach((d) => (d.open = open));
  $("expand-all").addEventListener("click", () => setAll(true));
  $("collapse-all").addEventListener("click", () => setAll(false));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderChart);
}

main();
