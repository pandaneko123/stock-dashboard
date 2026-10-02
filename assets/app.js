// data/market.json を読み込み、奪還率を計算して表示する。
// market.json の rows は [日付, 日中高値, 終値] の配列。

const STATUS = [
  { id: "above", label: "突破済み", test: (r) => r > 100 },
  { id: "near", label: "近い", test: (r) => r >= 95 },
  { id: "mid", label: "中間", test: (r) => r >= 90 },
  { id: "far", label: "遠い", test: () => true },
];
const statusOf = (ratio) => STATUS.find((s) => s.test(ratio));

const state = { mode: "ref", query: "", statuses: new Set(STATUS.map((s) => s.id)) };
let data, analyzed, chart;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- 書式 ----------
const ymd = (d) => { const [y, m, day] = d.split("-").map(Number); return { y, m, day }; };
const fmtDateLong = (d) => { const { y, m, day } = ymd(d); return `${y}年${m}月${day}日`; };
const fmtDateShort = (d) => d.slice(5).replace("-", "/");
const fmtPrice = (v, s) => {
  const digits = s.market === "JP" && s.kind === "stock" ? 0 : 2;
  return v.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtRatio = (r, s) => `${r.toFixed(s.kind === "index" ? 2 : 1)}%`;
const fmtSigned = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const unitLabel = (s) => (s.kind === "index" ? "指数ポイント" : s.currency === "JPY" ? "円" : "米ドル");
const marketLabel = (s) => ({ US: "米国", JP: "日本" })[s.market] ?? s.market;

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

  return {
    s,
    close,
    date: last[0],
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

// ---------- 表示部品 ----------
function meter(ratio) {
  // 60%〜120% を横幅いっぱいに割り当て、100% の位置に目印を置く
  const pos = (v) => Math.min(100, Math.max(0, ((v - 60) / 60) * 100));
  return `<div class="meter" aria-hidden="true"><div class="meter-fill" style="width:${pos(ratio)}%"></div><div class="meter-mark" style="left:${pos(100)}%"></div></div>`;
}

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
      const parts = [`日中 ${r.firstHigh ? fmtDateShort(r.firstHigh) : "なし"}`, `終値 ${r.firstClose ? fmtDateShort(r.firstClose) : "未突破"}`];
      note = `${esc(settings.refLabel)}以降の初回突破：${parts.join(" ／ ")}`;
      if (r.streak > 0) note += ` · 現在 ${r.streak}日連続で終値が上`;
    } else {
      note = `${esc(settings.refLabel)}以降、日中高値の突破はまだありません`;
    }
  } else {
    note = a.ytd.ratio > 100
      ? "比較日の終値で年初来高値を更新しました"
      : `年初来高値の記録日：${fmtDateShort(a.ytd.date)}（${a.ytd.daysAgo}営業日前）`;
  }

  return `<div class="detail">
    <p class="meta">${esc(s.kind === "stock" ? `${s.name} · ` : "")}${marketLabel(s)} · ${unitLabel(s)}</p>
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

function rowHtml(a, settings, open) {
  const s = a.s;
  const ratio = state.mode === "ref" ? a.ref.ratio : a.ytd.ratio;
  const st = statusOf(ratio);
  const title = s.kind === "stock" ? `${s.symbol}` : s.name;
  const sub = s.kind === "stock" ? s.name : marketLabel(s);
  return `<details class="row st-${st.id}" data-symbol="${esc(s.symbol)}"${open ? " open" : ""}>
    <summary>
      <div class="row-name"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>
      ${meter(ratio)}
      <span class="ratio num">${fmtRatio(ratio, s)}</span>
      <span class="badge">${st.label}</span>
    </summary>
    ${detailHtml(a, settings)}
  </details>`;
}

// ---------- 描画 ----------
function openSymbols() {
  return new Set([...document.querySelectorAll("details.row[open]")].map((d) => d.dataset.symbol));
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

  const asOf = fmtDateLong(data.asOf);
  $("formula").innerHTML = isRef
    ? `<p>比較する高値：<b>${fmtDateLong(settings.refStart)}〜${fmtDateLong(settings.refEnd).replace(/^\d+年/, "")}</b> の日中高値の最高値 ＝ 100%</p>
       <p>奪還率 ＝ ${asOf}の終値 ÷ ${esc(settings.refLabel)}の日中高値 × 100</p>`
    : `<p>比較する高値：<b>${fmtDateLong(settings.yearStart)}から比較日の前営業日まで</b> の日中高値の最高値 ＝ 100%</p>
       <p>奪還率 ＝ ${asOf}の終値 ÷ 年初来高値 × 100（100%超 ＝ 終値で年初来高値を更新）</p>`;
}

function renderIndices() {
  const open = openSymbols();
  $("index-rows").innerHTML = analyzed
    .filter((a) => a.s.kind === "index")
    .map((a) => rowHtml(a, data.settings, open.has(a.s.symbol)))
    .join("");
}

function renderChips() {
  $("status-chips").innerHTML = STATUS.map(
    (st) => `<button type="button" class="chip st-${st.id}" data-status="${st.id}" aria-pressed="${state.statuses.has(st.id)}">${st.label}</button>`
  ).join("");
}

function renderStocks() {
  const open = openSymbols();
  const { settings } = data;
  const q = state.query.trim().toLowerCase();
  const ratioOf = (a) => (state.mode === "ref" ? a.ref.ratio : a.ytd.ratio);
  let shown = 0;

  const html = data.groups
    .filter((g) => g.kind === "stock")
    .map((g) => {
      const all = analyzed.filter((a) => a.s.group === g.id);
      if (!all.length) return "";
      const counts = STATUS.map((st) => ({ st, n: all.filter((a) => statusOf(ratioOf(a)) === st).length }));
      const visible = all
        .filter((a) => !q || a.s.symbol.toLowerCase().includes(q) || a.s.name.toLowerCase().includes(q))
        .filter((a) => state.statuses.has(statusOf(ratioOf(a)).id))
        .sort((x, y) => ratioOf(y) - ratioOf(x));
      if (!visible.length) return "";
      shown += visible.length;

      const sections = STATUS.map((st) => {
        const items = visible.filter((a) => statusOf(ratioOf(a)) === st);
        if (!items.length) return "";
        return `<h3 class="status-head st-${st.id}">${st.label} ${items.length}銘柄</h3>
          <div class="rows">${items.map((a) => rowHtml(a, settings, open.has(a.s.symbol))).join("")}</div>`;
      }).join("");

      return `<div class="group">
        <div class="group-head"><h2>${esc(g.label)}</h2>
          <div class="group-counts">${counts.map(({ st, n }) => `<span class="st-${st.id}">${st.label} ${n}</span>`).join("")}</div>
        </div>
        <div class="stackbar" aria-hidden="true">${counts.filter((c) => c.n).map(({ st, n }) => `<span class="st-${st.id}" style="flex:${n}"></span>`).join("")}</div>
        ${sections}
      </div>`;
    })
    .join("");

  $("stock-groups").innerHTML = html;
  $("no-results").hidden = shown > 0;
}

function renderChart() {
  if (!window.Chart) return;
  const { settings } = data;
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const palette = ["#4c6ef5", "#e8590c", "#2b8a3e", "#ae3ec9", "#c92a2a", "#0c8599", "#5c940d", "#868e96"];

  const indices = data.series.filter((s) => s.group === "idx");
  const labels = [...new Set(indices.flatMap((s) => s.rows.map((r) => r[0])))].filter((d) => d >= settings.yearStart).sort();
  const datasets = indices.map((s, i) => {
    const rows = s.rows.filter((r) => r[0] >= settings.yearStart);
    const base = rows[0][2];
    const byDate = new Map(rows.map((r) => [r[0], (r[2] / base) * 100]));
    return {
      label: s.name,
      data: labels.map((d) => byDate.get(d) ?? null),
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length],
      borderWidth: 1.6,
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
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(settings.refLabel, (x0 + x1) / 2, chartArea.top + 12);
      ctx.restore();
    },
  };

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
        legend: { position: "bottom", labels: { color: v("--text"), boxWidth: 12, boxHeight: 2 } },
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
  $("chart-note").textContent = `${fmtDateLong(settings.yearStart).replace(/1月1日$/, "")}年初〜${fmtDateLong(data.asOf).replace(/^\d+年/, "")}の日次終値を年初の終値＝100として比較。網掛けは${settings.refLabel}（比較する期間）。凡例をクリックすると表示を切り替えられます。`;
}

function renderMethod() {
  const { settings } = data;
  const stocks = analyzed.filter((a) => a.s.kind === "stock").length;
  $("method").innerHTML = `
    <p>${esc(settings.refLabel)}タブでは ${fmtDateLong(settings.refStart)}〜${fmtDateLong(settings.refEnd).replace(/^\d+年/, "")} の日中高値の最大値、年初来タブでは年初から比較日の前営業日までの日中高値の最大値を100%とし、比較日（${fmtDateLong(data.asOf)}）の終値と比べています。配当込みのリターンではありません。</p>
    <p>分類は丸める前の値で判定します。100%超は「突破済み」、95%以上100%以下は「近い」、90%以上95%未満は「中間」、90%未満は「遠い」です。100%ちょうどは突破に含めません。</p>
    <p>対象は日米のAI・半導体・データセンター関連から選んだ${stocks}銘柄と主要指数です。市場全体を網羅するものではありません。</p>
    <p>${data.isDummy ? "<strong>現在表示しているのはプログラムで生成したダミーデータです。</strong>" : ""}日付と価格は各市場の現地基準です。</p>`;
  $("generated").textContent = `データ作成：${new Date(data.generatedAt).toLocaleString("ja-JP")}`;
}

function renderAll() {
  renderHeader();
  renderIndices();
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

  renderChips();
  renderAll();
  renderChart();
  renderMethod();

  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => { state.mode = b.dataset.mode; renderAll(); });
  }
  $("search").addEventListener("input", (e) => { state.query = e.target.value; renderStocks(); });
  $("status-chips").addEventListener("click", (e) => {
    const id = e.target.closest(".chip")?.dataset.status;
    if (!id) return;
    state.statuses.has(id) ? state.statuses.delete(id) : state.statuses.add(id);
    renderChips();
    renderStocks();
  });
  $("expand-all").addEventListener("click", () => document.querySelectorAll("#stock-groups details.row").forEach((d) => (d.open = true)));
  $("collapse-all").addEventListener("click", () => document.querySelectorAll("#stock-groups details.row").forEach((d) => (d.open = false)));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderChart);
}

main();
