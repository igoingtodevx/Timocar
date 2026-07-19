import { useEffect, useMemo, useState } from "react";

type OrderStatus = "new" | "in_progress" | "awaiting_customer" | "completed" | "cancelled";

type AdminOrder = {
  stripeSessionId: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  emailStatus: "pending" | "sent" | "failed";
  internalNote: string;
  criteria: Record<string, string>;
  paidAt: string;
  updatedAt: string;
};

type DashboardData = {
  admin: { email: string; role: "owner" | "staff" };
  settings: { acceptingOrders: boolean };
  orders: AdminOrder[];
};

type ApiFailure = { message: string; status: number };

const statusLabels: Record<OrderStatus, string> = {
  new: "Neu",
  in_progress: "In Bearbeitung",
  awaiting_customer: "Kunde gefragt",
  completed: "Erledigt",
  cancelled: "Storniert",
};

const statusClass: Record<OrderStatus, string> = {
  new: "admin-status--new",
  in_progress: "admin-status--progress",
  awaiting_customer: "admin-status--waiting",
  completed: "admin-status--done",
  cancelled: "admin-status--cancelled",
};

const emailStatusLabels: Record<AdminOrder["emailStatus"], string> = {
  pending: "ausstehend",
  sent: "versendet",
  failed: "fehlgeschlagen",
};

function euro(cents: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw { message: body.error ?? "Etwas ist schiefgelaufen.", status: response.status } satisfies ApiFailure;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function Icon({ children }: { children: string }) {
  return <span className="admin-icon" aria-hidden="true">{children}</span>;
}

function Login({ unavailable }: { unavailable: boolean }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    try {
      await request("/api/admin/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
      setNotice("Falls diese Adresse freigeschaltet ist, wurde ein sicherer Login-Link gesendet.");
    } catch (error) {
      setNotice((error as ApiFailure).message);
    } finally {
      setSending(false);
    }
  }

  return <main className="admin-login-page">
    <section className="admin-login-card" aria-labelledby="admin-login-heading">
      <div className="admin-login-mark">A</div>
      <p className="admin-kicker">AUTOWUNSCH · BETREIBER</p>
      <h1 id="admin-login-heading">Dein Shop, unter Kontrolle.</h1>
      <p className="admin-login-copy">Melde dich mit deiner freigeschalteten E-Mail-Adresse an. Du bekommst einen einmal gültigen Login-Link – kein Serverzugang nötig.</p>
      {unavailable ? <div className="admin-callout admin-callout--warning">Der Betreiberbereich wird gerade eingerichtet. Für den produktiven Login werden Datenbank und E-Mail-Versand benötigt.</div> : null}
      <form onSubmit={submit} className="admin-login-form">
        <label htmlFor="admin-email">E-Mail-Adresse</label>
        <input id="admin-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@unternehmen.de" />
        <button className="admin-button admin-button--primary" disabled={sending}>{sending ? "Link wird gesendet …" : "Sicheren Login-Link senden"}</button>
      </form>
      {notice ? <p className="admin-login-notice" role="status">{notice}</p> : null}
      <a className="admin-back-link" href="/">← Zur AutoWunsch-Website</a>
    </section>
  </main>;
}

function Dashboard({ data, onReload, onLogout }: { data: DashboardData; onReload: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [page, setPage] = useState<"overview" | "orders" | "settings">("overview");
  const [selectedId, setSelectedId] = useState<string | null>(data.orders[0]?.stripeSessionId ?? null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selected = data.orders.find((order) => order.stripeSessionId === selectedId) ?? null;
  const openOrders = useMemo(() => data.orders.filter((order) => order.status === "new").length, [data.orders]);
  const activeOrders = useMemo(() => data.orders.filter((order) => order.status === "in_progress" || order.status === "awaiting_customer").length, [data.orders]);
  const completedOrders = useMemo(() => data.orders.filter((order) => order.status === "completed").length, [data.orders]);

  async function toggleStorefront() {
    setSaving(true);
    setMessage("");
    try {
      await request("/api/admin/settings/storefront", { method: "PATCH", body: JSON.stringify({ acceptingOrders: !data.settings.acceptingOrders }) });
      await onReload();
      setMessage(data.settings.acceptingOrders ? "Neue Anfragen sind pausiert. Laufende Stripe-Webhooks bleiben aktiv." : "Neue Anfragen sind wieder aktiv.");
    } catch (error) {
      setMessage((error as ApiFailure).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveOrder(status: OrderStatus, internalNote: string) {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      await request(`/api/admin/orders/${encodeURIComponent(selected.stripeSessionId)}`, { method: "PATCH", body: JSON.stringify({ status, internalNote }) });
      await onReload();
      setMessage("Bestellung gespeichert.");
    } catch (error) {
      setMessage((error as ApiFailure).message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="admin-app-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/admin"><span>Auto</span>Wunsch</a>
      <p className="admin-sidebar-label">VERWALTUNG</p>
      <nav className="admin-nav" aria-label="Betreiber-Navigation">
        <button className={page === "overview" ? "admin-nav-item active" : "admin-nav-item"} onClick={() => setPage("overview")}><Icon>⌂</Icon> Übersicht</button>
        <button className={page === "orders" ? "admin-nav-item active" : "admin-nav-item"} onClick={() => setPage("orders")}><Icon>▤</Icon> Bestellungen <span className="admin-nav-count">{openOrders}</span></button>
        <button className={page === "settings" ? "admin-nav-item active" : "admin-nav-item"} onClick={() => setPage("settings")}><Icon>⚙</Icon> Einstellungen</button>
      </nav>
      <div className="admin-sidebar-bottom">
        <a href="/" className="admin-nav-item admin-nav-link"><Icon>↗</Icon> Website ansehen</a>
        <button onClick={onLogout} className="admin-nav-item"><Icon>⇥</Icon> Abmelden</button>
      </div>
    </aside>

    <main className="admin-main">
      <header className="admin-topbar">
        <div>
          <p className="admin-breadcrumb">AutoWunsch / {page === "overview" ? "Übersicht" : page === "orders" ? "Bestellungen" : "Einstellungen"}</p>
          <h1>{page === "overview" ? "Übersicht" : page === "orders" ? "Bestellungen" : "Shop-Einstellungen"}</h1>
        </div>
        <div className="admin-topbar-actions">
          <span className={data.settings.acceptingOrders ? "admin-live-state" : "admin-live-state admin-live-state--paused"}><i />{data.settings.acceptingOrders ? "Anfragen aktiv" : "Anfragen pausiert"}</span>
          <button className="admin-user-chip" title={data.admin.email}>{data.admin.email.slice(0, 1).toUpperCase()}</button>
        </div>
      </header>

      {message ? <div className="admin-toast" role="status">{message}</div> : null}

      {page === "overview" ? <>
        <section className="admin-overview-grid" aria-label="Bestellübersicht">
          <article className="admin-metric"><p>Neue Bestellungen</p><strong>{openOrders}</strong><span>benötigen deine Aufmerksamkeit</span></article>
          <article className="admin-metric"><p>In Bearbeitung</p><strong>{activeOrders}</strong><span>mit aktivem Arbeitsstatus</span></article>
          <article className="admin-metric"><p>Erledigt</p><strong>{completedOrders}</strong><span>abgeschlossene Empfehlungen</span></article>
        </section>
        <section className="admin-split-grid">
          <article className="admin-panel admin-availability-panel">
            <div><p className="admin-panel-eyebrow">ANNAHME</p><h2>Neue Anfragen</h2><p>{data.settings.acceptingOrders ? "Die Website nimmt derzeit neue Stripe-Checkouts an." : "Neue Checkouts sind pausiert; bereits gestartete Zahlungen und Webhooks laufen weiter."}</p></div>
            {data.admin.role === "owner" ? <button onClick={toggleStorefront} disabled={saving} className={data.settings.acceptingOrders ? "admin-button admin-button--danger" : "admin-button admin-button--primary"}>{data.settings.acceptingOrders ? "Anfragen pausieren" : "Anfragen aktivieren"}</button> : <span className="admin-readonly-label">Nur Inhaber</span>}
          </article>
          <article className="admin-panel"><p className="admin-panel-eyebrow">SCHNELLSTART</p><h2>Heute wichtig</h2><ul className="admin-plain-list"><li><b>{openOrders}</b> neue Bestellungen prüfen</li><li>Bearbeitungsstatus aktuell halten</li><li>Interne Notizen pro Auftrag dokumentieren</li></ul></article>
        </section>
        <OrdersTable orders={data.orders.slice(0, 6)} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setPage("orders"); }} />
      </> : null}

      {page === "orders" ? <section className="admin-order-workspace">
        <OrdersTable orders={data.orders} selectedId={selectedId} onSelect={setSelectedId} />
        <OrderDetail key={selected?.stripeSessionId ?? "empty"} order={selected} saving={saving} onSave={saveOrder} />
      </section> : null}

      {page === "settings" ? <section className="admin-settings-stack">
        <article className="admin-panel admin-settings-row"><div><p className="admin-panel-eyebrow">WEBSITE-ANNAHME</p><h2>Neue Anfragen {data.settings.acceptingOrders ? "aktiv" : "pausiert"}</h2><p>Der sichere Schalter stoppt neue Checkout-Sessions. Stripe-Webhooks für bereits bezahlte Bestellungen bleiben erreichbar.</p></div>{data.admin.role === "owner" ? <button onClick={toggleStorefront} disabled={saving} className={data.settings.acceptingOrders ? "admin-button admin-button--danger" : "admin-button admin-button--primary"}>{data.settings.acceptingOrders ? "Jetzt pausieren" : "Jetzt aktivieren"}</button> : <span className="admin-readonly-label">Nur Inhaber</span>}</article>
        <article className="admin-panel"><p className="admin-panel-eyebrow">ZUGANG</p><h2>Betreiber-Zugang</h2><p>Der Zugang erfolgt per Magic Link an freigeschaltete E-Mail-Adressen. Es gibt weder SSH- noch DigitalOcean-Zugang für den Betreiber.</p><code>ADMIN_OWNER_EMAILS</code> und optional <code>ADMIN_STAFF_EMAILS</code> bestimmen die Rollen beim Deployment.</article>
      </section> : null}
    </main>
  </div>;
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function OrdersTable({ orders, selectedId, onSelect }: { orders: AdminOrder[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => (statusFilter === "all" || order.status === statusFilter) && (!needle || `${order.stripeSessionId} ${order.customerEmail}`.toLowerCase().includes(needle)));
  }, [orders, query, statusFilter]);

  function exportCsv() {
    const header = ["Stripe-Referenz", "Kunde", "Status", "E-Mail", "Betrag", "Währung", "Bezahlt am", "Interne Notiz"];
    const rows = filteredOrders.map((order) => [order.stripeSessionId, order.customerEmail, statusLabels[order.status], emailStatusLabels[order.emailStatus], order.amountCents / 100, order.currency.toUpperCase(), dateTime(order.paidAt), order.internalNote]);
    const blob = new Blob(["\\uFEFF" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `autowunsch-bestellungen-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="admin-table-panel">
    <div className="admin-table-heading"><div><h2>Bestellungen</h2><p>{filteredOrders.length === 0 ? "Keine passenden Bestellungen." : `${filteredOrders.length} ${filteredOrders.length === 1 ? "Bestellung" : "Bestellungen"}`}</p></div><div className="admin-order-tools"><input aria-label="Bestellungen durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Suche Kunde oder Referenz" /><select aria-label="Status filtern" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | OrderStatus)}><option value="all">Alle Status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="admin-button admin-button--secondary" onClick={exportCsv} disabled={filteredOrders.length === 0}>CSV exportieren</button></div></div>
    <div className="admin-table-wrap"><table><thead><tr><th>Bestellung</th><th>Kunde</th><th>Status</th><th>E-Mail</th><th>Betrag</th><th>Bezahlt am</th></tr></thead><tbody>
      {filteredOrders.length === 0 ? <tr><td colSpan={6} className="admin-empty-row">{orders.length === 0 ? "Bezahlte Stripe-Bestellungen erscheinen hier automatisch." : "Keine Bestellung entspricht der aktuellen Suche."}</td></tr> : filteredOrders.map((order) => <tr key={order.stripeSessionId} className={order.stripeSessionId === selectedId ? "selected" : ""} onClick={() => onSelect(order.stripeSessionId)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(order.stripeSessionId); }}><td><b>{order.stripeSessionId.slice(-12)}</b><small>Stripe Checkout</small></td><td>{order.customerEmail}</td><td><span className={`admin-status ${statusClass[order.status]}`}>{statusLabels[order.status]}</span></td><td><span className={`admin-email-status admin-email-status--${order.emailStatus}`}>{emailStatusLabels[order.emailStatus]}</span></td><td>{euro(order.amountCents, order.currency)}</td><td>{dateTime(order.paidAt)}</td></tr>)}
    </tbody></table></div>
  </section>;
}

function OrderDetail({ order, saving, onSave }: { order: AdminOrder | null; saving: boolean; onSave: (status: OrderStatus, note: string) => Promise<void> }) {
  const [status, setStatus] = useState<OrderStatus>(order?.status ?? "new");
  const [note, setNote] = useState(order?.internalNote ?? "");
  if (!order) return <aside className="admin-detail admin-detail--empty">Wähle eine Bestellung aus, um Details und Bearbeitungsstatus zu sehen.</aside>;
  const fields = [["Budget", order.criteria.budget], ["Marke", order.criteria.brand], ["Modell", order.criteria.model], ["Kilometer", order.criteria.maxMileage], ["Karosserie", order.criteria.bodyType], ["Getriebe", order.criteria.transmission], ["Antrieb", order.criteria.drive], ["Farbe", order.criteria.color]];
  return <aside className="admin-detail">
    <div className="admin-detail-header"><p className="admin-panel-eyebrow">BESTELLUNG</p><h2>{order.customerEmail}</h2><span>{order.stripeSessionId}</span></div>
    <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as OrderStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className="admin-detail-section"><h3>Fahrzeugwünsche</h3><dl>{fields.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{order.criteria.notes ? <p className="admin-customer-note">„{order.criteria.notes}“</p> : null}</div>
    <label>Interne Notiz<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Nur für den Betreiber sichtbar …" /></label>
    <button className="admin-button admin-button--primary admin-save-order" disabled={saving} onClick={() => void onSave(status, note)}>{saving ? "Speichert …" : "Bestellung speichern"}</button>
  </aside>;
}

export default function AdminApp() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function load() {
    try {
      const next = await request<DashboardData>("/api/admin/bootstrap");
      setData(next);
      setUnavailable(false);
    } catch (error) {
      setData(null);
      setUnavailable((error as ApiFailure).status === 503);
    }
  }

  useEffect(() => { void load(); }, []);

  async function logout() {
    await request("/api/admin/logout", { method: "POST" });
    setData(null);
  }

  return data ? <Dashboard data={data} onReload={load} onLogout={logout} /> : <Login unavailable={unavailable} />;
}
