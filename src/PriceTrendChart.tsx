/**
 * AutoWunsch — Preisentwicklung: eigenständige responsive SVG-Chart-Komponente.
 *
 * Keine externe Chart-Library. Historie = durchgezogene Linie, Prognose =
 * gestrichelte Linie, klare Trennung am letzten historischen Punkt. Ohne
 * Hover verständlich (role="img" + aria-label), mobil 100 % Breite.
 */

import type { ForecastPoint, HistoryPoint } from "../shared/price-trend";

export interface PriceTrendChartProps {
  history: HistoryPoint[];
  forecast: ForecastPoint[];
  modelName: string;
  modelYear: number;
}

const WIDTH = 800;
const HEIGHT = 300;
const PAD_LEFT = 58;
const PAD_RIGHT = 16;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function formatDateLabel(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

function formatMonthLabel(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("de-DE", { month: "2-digit", year: "2-digit" });
}

export default function PriceTrendChart({ history, forecast, modelName, modelYear }: PriceTrendChartProps) {
  const all = [...history, ...forecast];
  if (all.length === 0) return null;
  const hasForecast = forecast.length > 0;
  const forecastPath = hasForecast && history.length > 0 ? [history[history.length - 1]!, ...forecast] : forecast;

  const minTs = all[0]!.timestamp;
  const maxTs = all[all.length - 1]!.timestamp;
  const prices = all.map((p) => p.price);
  let minPrice = Math.min(...prices);
  let maxPrice = Math.max(...prices);
  if (minPrice === maxPrice) {
    minPrice = Math.max(0, minPrice - Math.max(1, minPrice * 0.1));
    maxPrice = maxPrice + Math.max(1, maxPrice * 0.1);
  } else {
    const padding = (maxPrice - minPrice) * 0.08;
    minPrice = Math.max(0, minPrice - padding);
    maxPrice = maxPrice + padding;
  }

  const x = (ts: number) => PAD_LEFT + ((ts - minTs) / Math.max(1, maxTs - minTs)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (price: number) => PAD_TOP + (1 - (price - minPrice) / Math.max(1, maxPrice - minPrice)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const toPath = (points: Array<{ timestamp: number; price: number }>) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.timestamp).toFixed(2)},${y(p.price).toFixed(2)}`).join(" ");

  // Jahr-Ticks: 1. Januar jedes relevanten Jahres, maximal ~10 Labels.
  const firstYear = new Date(minTs * 1000).getUTCFullYear();
  const lastYear = new Date(maxTs * 1000).getUTCFullYear();
  const yearCount = Math.max(1, lastYear - firstYear + 1);
  const step = Math.max(1, Math.ceil(yearCount / 10));
  const yearTicks: number[] = [];
  for (let year = firstYear; year <= lastYear; year += step) {
    const ts = Date.UTC(year, 0, 1) / 1000;
    if (ts >= minTs && ts <= maxTs) yearTicks.push(ts);
  }

  // Preis-Ticks: 5 gleichmäßige Stufen.
  const priceTicks = Array.from({ length: 5 }, (_, i) => minPrice + ((maxPrice - minPrice) * i) / 4);

  const historyStart = history.length > 0 ? formatDateLabel(history[0]!.timestamp) : "";
  const historyEnd = history.length > 0 ? formatDateLabel(history[history.length - 1]!.timestamp) : "";
  const forecastEnd = forecast.length > 0 ? formatDateLabel(forecast[forecast.length - 1]!.timestamp) : "";
  const ariaLabel = [
    `Preisentwicklung ${modelName}, Modelljahr ${modelYear}.`,
    history.length > 0 ? `${history.length} historische Monatswerte von ${historyStart} bis ${historyEnd}.` : "Keine historischen Werte.",
    forecast.length > 0 ? `Rechnerische Prognose bis ${forecastEnd}.` : "Keine Prognose verfügbar.",
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT + PAD_BOTTOM + 8}`}
      role="img"
      aria-label={ariaLabel}
      className="h-[280px] w-full max-w-full md:h-[300px]"
      style={{ display: "block" }}
    >
      {/* Gitter + Preis-Labels */}
      {priceTicks.map((price) => (
        <g key={price}>
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={y(price)}
            y2={y(price)}
            stroke="#2A2A2A"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
          <text x={PAD_LEFT - 8} y={y(price) + 4} textAnchor="end" fontSize="11" fill="#9CA3AF">
            {euro.format(Math.round(price))}
          </text>
        </g>
      ))}

      {/* Jahres-Labels */}
      {yearTicks.map((ts) => (
        <text key={ts} x={x(ts)} y={HEIGHT - PAD_BOTTOM + 26} textAnchor="middle" fontSize="11" fill="#9CA3AF">
          {new Date(ts * 1000).getUTCFullYear()}
        </text>
      ))}

      {/* Historie: durchgezogene Linie */}
      {history.length >= 2 && (
        <path d={toPath(history)} fill="none" stroke="#F3F4F6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {history.length === 1 && <circle cx={x(history[0]!.timestamp)} cy={y(history[0]!.price)} r="3.5" fill="#F3F4F6" />}

      {/* Prognose: gestrichelte Linie */}
      {hasForecast && forecastPath.length >= 2 && (
        <path d={toPath(forecastPath)} fill="none" stroke="#FF8A00" strokeWidth="2.5" strokeDasharray="7 5" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {hasForecast && forecastPath.length === 1 && <circle cx={x(forecastPath[0]!.timestamp)} cy={y(forecastPath[0]!.price)} r="3.5" fill="#FF8A00" />}

      {/* Übergangsmarker am letzten historischen Punkt */}
      {hasForecast && history.length > 0 && <circle cx={x(history[history.length - 1]!.timestamp)} cy={y(history[history.length - 1]!.price)} r="4" fill="#FF8A00" stroke="#0D0D0D" strokeWidth="1.5" />}
      {history.length > 0 && (
        <text x={x(history[history.length - 1]!.timestamp)} y={y(history[history.length - 1]!.price) - 10} textAnchor="middle" fontSize="10" fill="#D1D5DB">
          {euro.format(history[history.length - 1]!.price)}
        </text>
      )}

      {/* Legende */}
      <g>
        <line x1={PAD_LEFT} x2={PAD_LEFT + 22} y1={HEIGHT + 2} y2={HEIGHT + 2} stroke="#F3F4F6" strokeWidth="2.5" />
        <text x={PAD_LEFT + 28} y={HEIGHT + 6} fontSize="11" fill="#D1D5DB">
          Historie
        </text>
        {hasForecast && (
          <>
            <line x1={PAD_LEFT + 90} x2={PAD_LEFT + 112} y1={HEIGHT + 2} y2={HEIGHT + 2} stroke="#FF8A00" strokeWidth="2.5" strokeDasharray="7 5" />
            <text x={PAD_LEFT + 118} y={HEIGHT + 6} fontSize="11" fill="#D1D5DB">
              Rechnerische Prognose
            </text>
          </>
        )}
      </g>

      {/* Beschriftung des letzten Monats (ohne Hover verständlich) */}
      {history.length > 0 && (
        <text x={Math.min(WIDTH - PAD_RIGHT, x(history[history.length - 1]!.timestamp))} y={HEIGHT - PAD_BOTTOM + 14} textAnchor="end" fontSize="10" fill="#6B7280">
          {formatMonthLabel(history[history.length - 1]!.timestamp)}
        </text>
      )}
    </svg>
  );
}
