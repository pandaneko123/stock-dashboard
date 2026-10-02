// ダミーの株価データを作り、data/market.json に書き出す。
// 本物のデータを取得するスクリプトも、同じ形式の market.json を出力すればサイトはそのまま動く。
//
// 使い方: node scripts/generate-dummy.mjs [終了日 YYYY-MM-DD]

import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const universe = JSON.parse(await readFile(new URL("data/universe.json", root), "utf8"));
const { settings } = universe;
const endDate = process.argv[2] ?? "2026-09-30";

// 銘柄コードから決まる乱数（何度実行しても同じデータになる）
function seededRandom(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

// 土日を除いた営業日（祝日は考慮しない）
function businessDays(start, end) {
  const days = [];
  for (let d = new Date(start + "T00:00:00Z"); d <= new Date(end + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const days = businessDays(settings.yearStart, endDate);
const round = (v, digits) => Number(v.toFixed(digits));

const series = universe.series.map((item) => {
  const rand = seededRandom(item.symbol);
  const isIndex = item.group === "idx";
  const vol = isIndex ? 0.009 + rand() * 0.006 : 0.018 + rand() * 0.02;
  const drift = (isIndex ? 0.0004 : 0.0008) + (rand() - 0.4) * 0.002;
  const base = item.base ?? (item.market === "JP" ? 800 + rand() * 9000 : 40 + rand() * 600);

  let close = base;
  const closes = days.map(() => (close *= Math.exp(drift + vol * normal(rand))));

  // 9月の終値が「8月高値の何%か」がばらつくように、基準期間後の値動きを調整する
  const refIdx = days.map((d, i) => (d >= settings.refStart && d <= settings.refEnd ? i : -1)).filter((i) => i >= 0);
  const lastRef = refIdx.at(-1);
  if (lastRef !== undefined && lastRef < days.length - 1) {
    const refHigh = Math.max(...refIdx.map((i) => closes[i])) * (1 + vol * 0.4);
    const target = isIndex ? 0.92 + rand() * 0.1 : 0.62 + rand() * 0.58;
    const factor = (refHigh * target) / closes.at(-1);
    const n = days.length - 1 - lastRef;
    for (let k = 1; k <= n; k++) closes[lastRef + k] *= factor ** (k / n);
  }

  const digits = item.market === "JP" && !isIndex ? 0 : 2;
  const rows = days.map((date, i) => {
    const prev = i > 0 ? closes[i - 1] : closes[i];
    const high = Math.max(prev, closes[i]) * (1 + Math.abs(normal(rand)) * vol * 0.5);
    return [date, round(high, digits), round(closes[i], digits)];
  });

  const { base: _base, ...meta } = item;
  return { ...meta, kind: isIndex ? "index" : "stock", currency: isIndex ? null : item.market === "JP" ? "JPY" : "USD", rows };
});

const out = {
  isDummy: true,
  generatedAt: new Date().toISOString(),
  asOf: endDate,
  settings,
  groups: universe.groups,
  series,
};

await writeFile(new URL("data/market.json", root), JSON.stringify(out));
console.log(`data/market.json を書き出しました（${series.length}銘柄 × ${days.length}営業日、${endDate}まで）`);
