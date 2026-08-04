# PRICE_TREND_IMPLEMENTATION_REPORT — Fahrzeug-Preisentwicklung V1

**Datum:** 2026-08-05
**Branch:** `feature/price-trend` (Clone `/home/deploy/workspace/projekte/Timo/Timocar-price-trend`)
**Commit:** `57fb808` — `feat: add vehicle price trend` (Basis: `main` @ `106bd07`)
**Status:** Implementiert, getestet, gepusht. **Kein Production-Deploy.**

---

## 1. Umgesetzte Architektur

```
Browser (src/App.tsx, Section "ai-tool", Block „Preisentwicklung“)
  Marke → Modell → Modelljahr (Katalog lokal: shared/pkw-models.ts)
  │
  ├─ GET /api/price-trend/models/{modelId}/years   (Backend-Proxy, Cache 24 h)
  └─ GET /api/price-trend?modelId=&modelYear=      (Backend-Proxy, Cache 24 h)
       │  Feature-Flag → 503 · Validierung (Katalog + Jahr) → 400
       │  Rate-Limit 10/60 s (getrennte Namespaces) → 429
       │  Cache-Key price-trend:{modelId}:{modelYear} → Hit direkt
       ▼
       preistrends-api.pkw.de/models/{id}?years[]={Jahr}&from={heute−36 M}&to={heute}
       (Timeout 8 s → 504 · externer Fehler → 502 · 404 → 404 · Fehler nie gecacht)
       ▼
       normalizeCohortResponse (nur angefragte Kohorte, Dedup modelId+modelYear+timestamp)
       ▼
       forecastCohort (Theil-Sen auf ln-Preise, 60 Monate)
       ▼
       JSON { model, modelYear, history[], forecast[], reason, source, disclaimer }
       ▼
       PriceTrendChart.tsx (SVG, Historie durchgezogen / Prognose gestrichelt)
```

## 2. Prognosemethode (V1)

- **Theil-Sen-Regression auf logarithmierten Monatspreisen** der ausgewählten Modelljahr-Kohorte.
- Datenbasis: letzte 36 Monate (extern gefenstert), **minimum 18 gültige Punkte**, sonst `forecast: []` + `reason: "insufficient_data"` (Historie wird trotzdem angezeigt).
- `t_i` = **tatsächliche Monatsdifferenz** zum ersten gültigen Punkt (nie Array-Index; Lücken werden nicht interpoliert).
- Bereinigung: `price ≤ 0` / nicht-endliche Werte verworfen, `price > 10 × Median` verworfen.
- **Jahres-Cap über die Log-Monatssteigung:** `b = clamp(b_raw, ln(1−cap)/12, ln(1+cap)/12)` mit `cap = 0.20` (konfigurierbar, `PRICE_TREND_FORECAST_CAP`). **Keine rekursive `prev*0.80/1.20`-Kette** — alle Werte direkt aus `exp(a + b·t)`.
- 60 monatliche Punkte, erster Punkt = Monat nach dem letzten historischen Punkt, Timestamps = Monatsbeginn UTC, volle Euro (`Math.round`), Mindestpreis 500 €, keine Konfidenzintervalle, deterministisch.

## 3. Neue Dateien

| Datei | Zweck |
|---|---|
| `scripts/fetch-pkw-models.ts` | Generator: 1 Request an `pkw.de/api/v1/brands/models?with_main_ce=true`, defensive Validierung, erzeugt `shared/pkw-models.ts` (läuft nur manuell, nie in Produktion) |
| `shared/pkw-models.ts` | **Generiert:** 1.456 Modelle / 115 Marken (verifiziert; VW/Golf = 948). `PKW_MODELS`, `findModel`, `searchModels` (case-insensitiv, Umlaut-/Diakritik-Normalisierung ohne Dependency), `modelsByMake`, `listMakes` |
| `shared/price-trend.ts` | Typen (`PricePoint`, `HistoryPoint`, `ForecastPoint`, `ForecastResult`), `normalizeCohortResponse`, `forecastCohort`, Helfer (`theilSenLogSlope`, `monthStart`, `addMonthsToTimestamp`, `monthDifference` — exportiert für deterministische Tests) |
| `src/PriceTrendChart.tsx` | Eigene responsive SVG-Chart-Komponente (keine Library): Historie durchgezogen, Prognose gestrichelt, Übergangsmarker, Jahres-/€-Labels, Legende, `role="img"` + `aria-label`, ohne Hover verständlich, `w-full` mobil |
| `tests/price-trend.test.ts` | 52 Tests (Katalog, Normalisierung, Prognose, API, Regression) |

## 4. Geänderte Dateien (nur additiv)

| Datei | Änderung |
|---|---|
| `api/index.ts` | +318 Zeilen: Env-Parsing mit sicheren Defaults (`PRICE_TREND_*`), In-Memory-Cache (TTL 24 h, Cap 5.000 Einträge, Fehler nie gecacht, expire-on-read), Rate-Limit (getrennte Namespaces `years`/`trend`), `priceTrendFetchJson` (withTimeout + AbortSignal, TimeoutError-Mapping), beide Routen **vor** SPA-Fallback. Test-Hooks `setPriceTrendFetchForTests` / `resetPriceTrendStateForTests` (analog `setWebhookOutboxForTests`). **0 gelöschte Zeilen.** |
| `src/App.tsx` | +224 Zeilen: eigener Block „Preisentwicklung“ in Section `ai-tool` (Marke → Modell → Modelljahr, Zustände idle/loading-years/loading-trend/success/insufficient-data/error/empty, Retry, sichtbare Labels, `aria`-konform via nativen `<select>`+`<label>`, Reset bei Marken-/Modellwechsel, Disclaimer sichtbar). **0 gelöschte Zeilen.** |
| `.env.example` | +13 Zeilen Doku: `PRICE_TREND_ENABLED`, `PRICE_TREND_TIMEOUT_MS`, `PRICE_TREND_CACHE_TTL_MS`, `PRICE_TREND_RATE_LIMIT`, `PRICE_TREND_RATE_WINDOW_MS`, `PRICE_TREND_FORECAST_CAP` (nur Namen/Defaults, keine Secrets) |

## 5. Implementierungsentscheidungen (dokumentiert)

1. **Externe 404 → intern 404** mit deutscher Meldung („Für dieses Modell sind keine Preisdaten verfügbar.“) — nie `{"error":"not_found"}` ungefiltert.
2. **Externe 200 ohne angefragte Kohorte → 400** („Für das Modelljahr X sind keine Preisdaten verfügbar.“) — Datenverfügbarkeits-Fall, klar getrennt vom 502-Fehlerpfad.
3. **Cache-Hit setzt `source: "cache"`** (gespeichert wird `"live"`, beim Ausliefern überschrieben) — ehrliche Quelle.
4. **`dataUpdatedAt`** in V1 nicht gesendet (würde einen zweiten externen Request an `/last_build` erfordern; optional für V2).
5. **`weight`** wird geparst (defensiv), aber weder prognostisch verwendet noch an den Browser gesendet (verifiziert per Test 33).
6. **Env-Werte werden pro Request sicher geparst** (`safeEnvInt`/`safeEnvFloat`, ungültig/negativ → Default) — kein NaN im Betrieb, Tests setzen/restoren Env zur Laufzeit.
7. **Markenname im Katalog = API-Name** (z. B. „VW“, nicht „Volkswagen“) — bewusst, da die pkw.de-API so liefert; Frontend zeigt diesen Namen.
8. **`preparePoints` filtert `price > 10 × Median` VOR der Prognose** (auch wenn Theil-Sen robust ist) — wie spezifiziert.

## 6. Testergebnisse

- **`npm test`:** 71/71 grün
  - `tests/price-trend.test.ts`: **52/52** (Tests 1–45 laut Spezifikation inkl. 45b–45d, 46+–46d Zusatzabdeckung)
  - `tests/order.test.ts` + `tests/admin.test.ts`: unverändert grün (14 + 5)
- **`npm run type-check`:** grün
- **`npm run build`:** grün (Vite, 340 kB JS / 98 kB gzip — Katalog + Chart enthalten)
- **`npm run check`:** komplett grün
- **Live-Smoke-Test im Clone (echte pkw.de-API):**
  - `GET /api/price-trend/models/948/years` → 200, 47 Jahre (1979–2026), `source: live`
  - `GET /api/price-trend?modelId=948&modelYear=2019` → 200, 34 Monate Historie (21.782 € → 13.292 €), 60 Forecast-Punkte (13.678 € → 5.840 €), `reason: ok`
  - 2. Request → `source: cache` (kein zweiter externer Request)
  - unbekannte modelId → 400, fehlendes modelYear → 400

## 7. Sicherheit / Integrität

- **Stripe, Checkout, Webhooks, Admin, DB: unverändert.** Diff ist rein additiv (555 Insertions, 0 Deletions über 3 Dateien; 5 neue Dateien). `package.json`/`package-lock.json` unverändert (keine neue Dependency; `npm ci` nur für lokale Testausführung).
- Keine Secrets gelesen, ausgegeben oder committet. Kein Zugriff auf `/srv/autowunsch/app` oder `secrets/`.
- Externe Requests nur serverseitig, URL ausschließlich aus `URL`+`URLSearchParams`; keine nutzergelieferten URLs.
- Katalog-Request läuft nur einmalig im Generator (nicht zur Laufzeit der App).
- Keine personenbezogenen Daten im Cache (nur Fahrzeugpreise + Modell-IDs).

## 8. Verbleibende Risiken / offene Punkte

1. **`weight`-Semantik** bleibt undokumentiert (Audit-Blocker 2) — in V1 nur transportiert, nicht genutzt.
2. **API-Fehlerfälle jenseits 200/404** (5xx/429) nur gemockt getestet; Live-Verhalten generisch abgesichert (502). Vor Go-live ein realer Störfalltest empfohlen.
3. **Katalog-Aktualität:** pkw.de kann IDs umstellen; Katalogdatei ist release-gebunden (Regenerierung = 1 Request + Commit).
4. **`dataUpdatedAt`** nicht implementiert (V2-Option via `/last_build`).
5. **Rechtliches:** pkw.de als externer Empfänger (nur Modell-ID, keine PII) — kurzer Hinweis in der Datenschutzerklärung empfohlen (Audit-Empfehlung, nicht umgesetzt).
6. **Frontend-Verifikation** erfolgte über Build + Typecheck + Live-API-Test; manueller Browser-Test (Mobile/Tastatur) vor Go-live empfohlen (nicht in Production möglich ohne Deploy).
7. **Prognose-Verankerung:** Die Prognoselinie folgt der Regressionsfunktion (wie spezifiziert) und ist nicht am letzten Ist-Preis verankert — bei stark vom Trend abweichenden letzten Monaten kann der erste Prognosewert vom letzten Ist-Wert abweichen. Bewusst so umgesetzt (Spezifikation: „alle Prognosewerte direkt aus der Regressionsfunktion“).

## 9. Deployment-Plan (für später — NICHT ausgeführt)

1. Backup: `sudo docker exec runtime-postgres-1 pg_dump … | gzip > /srv/autowunsch/backups/autowunsch_pre_$(date +%Y%m%d_%H%M).dump.gz`
2. Im Produktions-Checkout `/srv/autowunsch/app`: `git fetch origin && git checkout feature/price-trend` (oder Merge-Request auf main nach Review)
3. `cd /srv/autowunsch/runtime && sudo docker compose build --no-cache app`
4. `sudo docker compose up -d app` + `docker compose ps` (healthy abwarten)
5. Smoke: `curl -k --resolve autowunsch.com:443:127.0.0.1 "https://autowunsch.com/api/price-trend?modelId=948&modelYear=2019"` → 200; 2. Call → `source:"cache"`; `/api/health` weiterhin alle true; `/api/storefront-state` unverändert
6. Rollback-Bereitschaft: Git-Tag + Image-Tag dokumentieren; Notbremse `PRICE_TREND_ENABLED=false` + `docker compose restart app`

**Erst nach ausdrücklicher Freigabe durchführen.**

## 10. Nachträgliche Browser-QA (2026-08-05)

- Desktop-QA (1050 px): Auswahlblock sichtbar, keine bestätigte Überlappung oder horizontale Überbreite.
- Mobile-QA (390 px): Marke → Modell → Modelljahr funktioniert, keine horizontale Überbreite bestätigt.
- Loading-State beim Laden der Modelljahre und Preisdaten sichtbar.
- Fehler-State mit deutscher Fehlermeldung und „Erneut versuchen“-Button per gemocktem 500-Upstream bestätigt.
- Chart enthält historische durchgezogene Linie, gestrichelte Prognoselinie, Übergangsmarker, Jahres-/Euro-Labels, Legende und sichtbaren Disclaimer.
- `PRICE_TREND_FORECAST_CAP` korrigiert: Nur Werte mit `0 < cap < 1` werden akzeptiert; `0`, negative Werte, `>= 1`, `NaN` und nichtnumerische Werte fallen auf den Default `0.20` zurück. Testabdeckung ergänzt.
- `npm run check`: 71/71 Tests grün, Typecheck und Build grün.

Bestätigter Code-Fix: `api/index.ts` validiert das Forecast-Cap jetzt mit `parsed >= 1` als ungültig.

**Nach QA weiterhin: kein Merge, kein Production-Deploy.**
