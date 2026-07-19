import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  Store,
  X,
} from "lucide-react";
import { summarizeOperatorOrders, type OperatorOrderStatus } from "./admin-dashboard";

type OrderStatus = OperatorOrderStatus;
type Page = "overview" | "requests" | "storefront" | "settings";

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
  awaiting_customer: "Rückmeldung offen",
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

const pageCopy: Record<Page, { crumb: string; title: string; description: string }> = {
  overview: { crumb: "Übersicht", title: "Guten Überblick behalten", description: "Der aktuelle Stand deiner echten AutoWunsch-Anfragen." },
  requests: { crumb: "Anfragen", title: "Anfragen bearbeiten", description: "Status und interne Notizen direkt an der Anfrage pflegen." },
  storefront: { crumb: "Shopstatus", title: "Annahme steuern", description: "Neue Anfragen gezielt aktivieren oder pausieren." },
  settings: { crumb: "Einstellungen", title: "Zugang", description: "Dein Betreiberzugang und die zugewiesene Rolle." },
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

function Login({ unavailable, initialNotice }: { unavailable: boolean; initialNotice: string }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(initialNotice);
  const [noticeIsError, setNoticeIsError] = useState(Boolean(initialNotice));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setNotice("");
    setNoticeIsError(false);
    try {
      await request("/api/admin/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
      setNotice("Falls diese Adresse freigeschaltet ist, wurde ein sicherer Login-Link gesendet.");
    } catch (error) {
      setNotice((error as ApiFailure).message);
      setNoticeIsError(true);
    } finally {
      setSending(false);
    }
  }

  return <main className="admin-login-page">
    <section className="admin-login-card" aria-labelledby="admin-login-heading">
      <div className="admin-login-mark" aria-hidden="true">A</div>
      <p className="admin-kicker">AUTOWUNSCH · BETREIBER</p>
      <h1 id="admin-login-heading">Anfragen sicher bearbeiten.</h1>
      <p className="admin-login-copy">Melde dich mit deiner freigeschalteten E-Mail-Adresse an. Du erhältst einen einmal gültigen Login-Link.</p>
      {unavailable ? <div className="admin-callout admin-callout--warning">Der Betreiberbereich wird gerade eingerichtet. Für den produktiven Login werden Datenbank und E-Mail-Versand benötigt.</div> : null}
      <form onSubmit={submit} className="admin-login-form">
        <label htmlFor="admin-email">E-Mail-Adresse</label>
        <input id="admin-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@unternehmen.de" />
        <button className="admin-button admin-button--primary" disabled={sending}>{sending ? "Link wird gesendet …" : "Sicheren Login-Link senden"}</button>
      </form>
      {notice ? <p className={noticeIsError ? "admin-login-notice admin-login-notice--error" : "admin-login-notice"} role={noticeIsError ? "alert" : "status"}>{notice}</p> : null}
      <a className="admin-back-link" href="/">← Zur AutoWunsch-Website</a>
    </section>
  </main>;
}

function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={active ? "admin-nav-item active" : "admin-nav-item"} aria-current={active ? "page" : undefined} onClick={onClick}>
    <span className="admin-nav-icon" aria-hidden="true">{icon}</span>{label}{typeof count === "number" ? <span className="admin-nav-count">{count}</span> : null}
  </button>;
}

function StorefrontState({ acceptingOrders }: { acceptingOrders: boolean }) {
  return <span className={acceptingOrders ? "admin-live-state" : "admin-live-state admin-live-state--paused"}>
    <i aria-hidden="true" />{acceptingOrders ? "Annahme aktiv" : "Annahme pausiert"}
  </span>;
}

function Dashboard({ data, onReload, onLogout }: { data: DashboardData; onReload: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [page, setPage] = useState<Page>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(data.orders[0]?.stripeSessionId ?? null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [pendingStorefrontChange, setPendingStorefrontChange] = useState<boolean | null>(null);
  const storefrontActionRef = useRef<HTMLButtonElement>(null);
  const selected = data.orders.find((order) => order.stripeSessionId === selectedId) ?? null;
  const summary = useMemo(() => summarizeOperatorOrders(data.orders), [data.orders]);
  const copy = pageCopy[page];

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pendingStorefrontChange !== null) closeStorefrontConfirmation();
        setDetailsOpen(false);
        setMobileNavOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingStorefrontChange]);

  function navigate(nextPage: Page) {
    setPage(nextPage);
    setMobileNavOpen(false);
    if (nextPage !== "requests") setDetailsOpen(false);
  }

  function selectOrder(id: string, openDetails = true) {
    setSelectedId(id);
    setDetailsOpen(openDetails);
  }

  function closeStorefrontConfirmation() {
    setPendingStorefrontChange(null);
    requestAnimationFrame(() => storefrontActionRef.current?.focus());
  }

  async function confirmStorefrontChange() {
    if (pendingStorefrontChange === null) return;
    const acceptingOrders = pendingStorefrontChange;
    setSaving(true);
    setMessage(null);
    try {
      await request("/api/admin/settings/storefront", { method: "PATCH", body: JSON.stringify({ acceptingOrders }) });
      await onReload();
      setMessage({ text: acceptingOrders ? "Neue Anfragen sind wieder aktiv." : "Neue Anfragen sind pausiert.", kind: "success" });
      closeStorefrontConfirmation();
    } catch (error) {
      setMessage({ text: (error as ApiFailure).message, kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function saveOrder(status: OrderStatus, internalNote: string) {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    try {
      await request(`/api/admin/orders/${encodeURIComponent(selected.stripeSessionId)}`, { method: "PATCH", body: JSON.stringify({ status, internalNote }) });
      await onReload();
      setMessage({ text: "Anfrage gespeichert.", kind: "success" });
    } catch (error) {
      setMessage({ text: (error as ApiFailure).message, kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    try {
      await onLogout();
    } catch (error) {
      setMessage({ text: (error as ApiFailure).message, kind: "error" });
    }
  }

  return <div className="admin-app-shell">
    <aside className={mobileNavOpen ? "admin-sidebar admin-sidebar--open" : "admin-sidebar"}>
      <div className="admin-sidebar-top">
        <a className="admin-brand" href="/admin" aria-label="AutoWunsch Betreiberbereich"><span>Auto</span>Wunsch</a>
        <button className="admin-mobile-menu" type="button" aria-label={mobileNavOpen ? "Navigation schließen" : "Navigation öffnen"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
          {mobileNavOpen ? <X size={19} /> : <Menu size={20} />}
        </button>
      </div>
      <div className="admin-sidebar-content">
        <p className="admin-sidebar-label">BETREIBERBEREICH</p>
        <nav className="admin-nav" aria-label="Betreiber-Navigation">
          <NavItem active={page === "overview"} icon={<LayoutDashboard size={17} />} label="Übersicht" onClick={() => navigate("overview")} />
          <NavItem active={page === "requests"} icon={<ClipboardList size={17} />} label="Anfragen" count={summary.new} onClick={() => navigate("requests")} />
          <NavItem active={page === "storefront"} icon={<Store size={17} />} label="Shopstatus" onClick={() => navigate("storefront")} />
          <NavItem active={page === "settings"} icon={<Settings2 size={17} />} label="Einstellungen" onClick={() => navigate("settings")} />
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="/" className="admin-nav-item admin-nav-link"><span className="admin-nav-icon" aria-hidden="true"><ExternalLink size={17} /></span>Website ansehen</a>
          <button onClick={() => void logout()} className="admin-nav-item"><span className="admin-nav-icon" aria-hidden="true"><LogOut size={17} /></span>Abmelden</button>
        </div>
      </div>
    </aside>

    <main className="admin-main">
      <header className="admin-topbar">
        <div>
          <p className="admin-breadcrumb">AutoWunsch <ChevronRight size={13} aria-hidden="true" /> {copy.crumb}</p>
          <h1>{copy.title}</h1>
          <p className="admin-page-description">{copy.description}</p>
        </div>
        <div className="admin-topbar-actions">
          <StorefrontState acceptingOrders={data.settings.acceptingOrders} />
          <span className="admin-user-chip" title={data.admin.email} aria-label={`Angemeldet als ${data.admin.email}`}>{data.admin.email.slice(0, 1).toUpperCase()}</span>
        </div>
      </header>

      {message ? <div className={message.kind === "error" ? "admin-toast admin-toast--error" : "admin-toast"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}

      {page === "overview" ? <Overview data={data} summary={summary} onOpenRequests={() => navigate("requests")} onSelectOrder={(id) => { selectOrder(id); navigate("requests"); }} onOpenStorefront={() => navigate("storefront")} /> : null}
      {page === "requests" ? <section className={detailsOpen ? "admin-request-workspace admin-request-workspace--detail" : "admin-request-workspace"} aria-label="Anfragen bearbeiten">
        <OrdersTable orders={data.orders} selectedId={selectedId} onSelect={selectOrder} />
        {detailsOpen ? <OrderDetail key={selected?.stripeSessionId ?? "empty"} order={selected} saving={saving} onClose={() => setDetailsOpen(false)} onSave={saveOrder} /> : null}
      </section> : null}
      {page === "storefront" ? <StorefrontPage data={data} saving={saving} actionButtonRef={storefrontActionRef} onRequestChange={setPendingStorefrontChange} /> : null}
      {page === "settings" ? <SettingsPage data={data} /> : null}
    </main>

    {pendingStorefrontChange !== null ? <StorefrontConfirmDialog acceptingOrders={pendingStorefrontChange} saving={saving} onCancel={closeStorefrontConfirmation} onConfirm={() => void confirmStorefrontChange()} /> : null}
  </div>;
}

function Overview({ data, summary, onOpenRequests, onSelectOrder, onOpenStorefront }: {
  data: DashboardData;
  summary: ReturnType<typeof summarizeOperatorOrders>;
  onOpenRequests: () => void;
  onSelectOrder: (id: string) => void;
  onOpenStorefront: () => void;
}) {
  const important = summary.needsAttention > 0;
  return <>
    <section className="admin-overview-grid" aria-label="Statusübersicht der Anfragen">
      <article className="admin-metric admin-metric--attention"><p>Neue Anfragen</p><strong>{summary.new}</strong><span>{summary.new === 1 ? "wartet auf die erste Prüfung" : "warten auf die erste Prüfung"}</span></article>
      <article className="admin-metric"><p>In Bearbeitung</p><strong>{summary.inProgress}</strong><span>aktive Fahrzeugrecherchen</span></article>
      <article className="admin-metric"><p>Rückmeldung offen</p><strong>{summary.awaitingCustomer}</strong><span>bei Kund:innen nachfassen</span></article>
    </section>

    <section className="admin-overview-layout">
      <article className="admin-panel admin-focus-card">
        <div className="admin-panel-heading"><div><p className="admin-panel-eyebrow">HEUTE WICHTIG</p><h2>{important ? "Nächste Schritte" : "Alles im Blick"}</h2></div><button className="admin-text-button" onClick={onOpenRequests}>Alle Anfragen <ChevronRight size={15} aria-hidden="true" /></button></div>
        {summary.total === 0 ? <div className="admin-empty-state"><ClipboardList size={22} aria-hidden="true" /><div><strong>Noch keine bezahlten Anfragen</strong><p>Eingegangene Anfragen erscheinen hier automatisch.</p></div></div> : important ? <ul className="admin-action-list">
          {summary.new > 0 ? <li><span className="admin-list-count">{summary.new}</span><div><strong>{summary.new === 1 ? "Neue Anfrage prüfen" : "Neue Anfragen prüfen"}</strong><p>Neue bezahlte Anfragen warten auf die erste Bearbeitung.</p></div></li> : null}
          {summary.awaitingCustomer > 0 ? <li><span className="admin-list-count admin-list-count--waiting">{summary.awaitingCustomer}</span><div><strong>{summary.awaitingCustomer === 1 ? "Rückmeldung nachhalten" : "Rückmeldungen nachhalten"}</strong><p>Diese Anfragen warten laut Status auf Kund:innen.</p></div></li> : null}
        </ul> : <div className="admin-empty-state admin-empty-state--positive"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>Keine offenen Schritte</strong><p>Es gibt aktuell keine neuen Anfragen und keine ausstehenden Rückmeldungen.</p></div></div>}
      </article>
      <article className="admin-panel admin-acceptance-card">
        <p className="admin-panel-eyebrow">SHOPSTATUS</p>
        <div className="admin-acceptance-state"><StorefrontState acceptingOrders={data.settings.acceptingOrders} /><h2>{data.settings.acceptingOrders ? "Neue Anfragen werden angenommen" : "Neue Anfragen sind pausiert"}</h2></div>
        <p>{data.settings.acceptingOrders ? "Auf der Website können neue Bestellvorgänge gestartet werden." : "Die Website nimmt derzeit keine neuen Bestellvorgänge an."}</p>
        <button className="admin-button admin-button--secondary" onClick={onOpenStorefront}>Shopstatus öffnen</button>
      </article>
    </section>

    <section className="admin-section-head"><div><p className="admin-panel-eyebrow">LETZTE ANFRAGEN</p><h2>Zuletzt eingegangen</h2></div>{summary.total > 0 ? <button className="admin-text-button" onClick={onOpenRequests}>Alle anzeigen <ChevronRight size={15} aria-hidden="true" /></button> : null}</section>
    <OrdersTable orders={data.orders.slice(0, 5)} selectedId={null} compact onSelect={onSelectOrder} />
  </>;
}

function StorefrontPage({ data, saving, actionButtonRef, onRequestChange }: { data: DashboardData; saving: boolean; actionButtonRef: React.RefObject<HTMLButtonElement | null>; onRequestChange: (acceptingOrders: boolean) => void }) {
  const isOwner = data.admin.role === "owner";
  const nextState = !data.settings.acceptingOrders;
  return <section className="admin-settings-stack">
    <article className="admin-panel admin-storefront-card">
      <div className="admin-storefront-status-row"><div><p className="admin-panel-eyebrow">ANNAHME VON ANFRAGEN</p><h2>{data.settings.acceptingOrders ? "Annahme ist aktiv" : "Annahme ist pausiert"}</h2></div><StorefrontState acceptingOrders={data.settings.acceptingOrders} /></div>
      <p>{data.settings.acceptingOrders ? "Neue Bestellvorgänge können auf der Website gestartet werden." : "Neue Bestellvorgänge sind bis zur erneuten Aktivierung nicht möglich."}</p>
      <div className="admin-storefront-action">
        {isOwner ? <><button ref={actionButtonRef} onClick={() => onRequestChange(nextState)} disabled={saving} className={data.settings.acceptingOrders ? "admin-button admin-button--danger" : "admin-button admin-button--primary"}>{data.settings.acceptingOrders ? "Neue Anfragen pausieren" : "Neue Anfragen aktivieren"}</button><small>{data.settings.acceptingOrders ? "Die Pause betrifft nur neue Anfragen." : "Aktiviere die Annahme erst, wenn du neue Anfragen bearbeiten kannst."}</small></> : <div className="admin-readonly-callout"><strong>Nur Inhaber:innen können den Shopstatus ändern.</strong><span>Deine Rolle: Team</span></div>}
      </div>
    </article>
  </section>;
}

function SettingsPage({ data }: { data: DashboardData }) {
  return <section className="admin-settings-stack">
    <article className="admin-panel admin-access-card">
      <p className="admin-panel-eyebrow">BETREIBER-ZUGANG</p>
      <h2>Angemeldet per Magic Link</h2>
      <p>Dein Zugang wird über einen einmal gültigen Login-Link bestätigt. Weitere Einstellungen sind in diesem Betreiberbereich nicht verfügbar.</p>
      <dl className="admin-access-list"><div><dt>E-Mail</dt><dd>{data.admin.email}</dd></div><div><dt>Rolle</dt><dd>{data.admin.role === "owner" ? "Inhaber:in" : "Team"}</dd></div></dl>
    </article>
  </section>;
}

function StorefrontConfirmDialog({ acceptingOrders, saving, onCancel, onConfirm }: { acceptingOrders: boolean; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  const title = acceptingOrders ? "Annahme neuer Anfragen aktivieren?" : "Annahme neuer Anfragen pausieren?";
  return <div className="admin-dialog-backdrop" role="presentation">
    <section className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="storefront-confirm-title" aria-describedby="storefront-confirm-description">
      <p className="admin-panel-eyebrow">SHOPSTATUS ÄNDERN</p>
      <h2 id="storefront-confirm-title">{title}</h2>
      <p id="storefront-confirm-description">{acceptingOrders ? "Danach können auf der Website wieder neue Bestellvorgänge gestartet werden." : "Danach können auf der Website keine neuen Bestellvorgänge gestartet werden. Bereits eingegangene Anfragen bleiben unverändert."}</p>
      <div className="admin-dialog-actions"><button className="admin-button admin-button--secondary" onClick={onCancel} disabled={saving} autoFocus>Abbrechen</button><button className={acceptingOrders ? "admin-button admin-button--primary" : "admin-button admin-button--danger"} onClick={onConfirm} disabled={saving}>{saving ? "Wird gespeichert …" : acceptingOrders ? "Annahme aktivieren" : "Annahme pausieren"}</button></div>
    </section>
  </div>;
}

function OrdersTable({ orders, selectedId, compact = false, onSelect }: { orders: AdminOrder[]; selectedId: string | null; compact?: boolean; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return orders.filter((order) => (statusFilter === "all" || order.status === statusFilter) && (!needle || `${order.stripeSessionId} ${order.customerEmail}`.toLowerCase().includes(needle)));
  }, [orders, query, statusFilter]);

  return <section className={compact ? "admin-table-panel admin-table-panel--compact" : "admin-table-panel"} aria-label={compact ? "Letzte Anfragen" : "Anfragenliste"}>
    {!compact ? <div className="admin-table-heading"><div><h2>Anfragen</h2><p>{filteredOrders.length === 0 ? "Keine passenden Anfragen." : `${filteredOrders.length} ${filteredOrders.length === 1 ? "Anfrage" : "Anfragen"}`}</p></div><div className="admin-order-tools"><label className="admin-search"><Search size={15} aria-hidden="true" /><span className="admin-sr-only">Anfragen durchsuchen</span><input aria-label="Anfragen durchsuchen" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kunde oder Referenz" /></label><label className="admin-sr-only" htmlFor="request-status-filter">Status filtern</label><select id="request-status-filter" aria-label="Status filtern" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | OrderStatus)}><option value="all">Alle Status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div> : null}
    <div className="admin-table-wrap"><table><thead><tr><th>Anfrage</th><th>Kunde</th><th>Status</th><th>E-Mail</th><th>Betrag</th><th>Eingegangen</th></tr></thead><tbody>
      {filteredOrders.length === 0 ? <tr><td colSpan={6} className="admin-empty-row">{orders.length === 0 ? "Bezahlte Anfragen erscheinen hier automatisch." : "Keine Anfrage entspricht der aktuellen Suche."}</td></tr> : filteredOrders.map((order) => <tr key={order.stripeSessionId} className={order.stripeSessionId === selectedId ? "selected" : undefined} aria-selected={order.stripeSessionId === selectedId}>
        <td><button className="admin-request-link" onClick={() => onSelect(order.stripeSessionId)} aria-label={`Anfrage von ${order.customerEmail} öffnen`}><b>{order.stripeSessionId.slice(-12)}</b><small>Details öffnen</small></button></td><td>{order.customerEmail}</td><td><span className={`admin-status ${statusClass[order.status]}`}>{statusLabels[order.status]}</span></td><td><span className={`admin-email-status admin-email-status--${order.emailStatus}`}>{emailStatusLabels[order.emailStatus]}</span></td><td>{euro(order.amountCents, order.currency)}</td><td>{dateTime(order.paidAt)}</td>
      </tr>)}
    </tbody></table></div>
  </section>;
}

function OrderDetail({ order, saving, onClose, onSave }: { order: AdminOrder | null; saving: boolean; onClose: () => void; onSave: (status: OrderStatus, note: string) => Promise<void> }) {
  const [status, setStatus] = useState<OrderStatus>(order?.status ?? "new");
  const [note, setNote] = useState(order?.internalNote ?? "");
  if (!order) return <aside className="admin-detail admin-detail--empty">Die ausgewählte Anfrage ist nicht mehr verfügbar.</aside>;
  const fields = [["Budget", order.criteria.budget], ["Marke", order.criteria.brand], ["Modell", order.criteria.model], ["Kilometer", order.criteria.maxMileage], ["Karosserie", order.criteria.bodyType], ["Getriebe", order.criteria.transmission], ["Antrieb", order.criteria.drive], ["Unfallfrei", order.criteria.accidentFree], ["Farbe", order.criteria.color]];
  return <aside className="admin-detail" aria-label={`Details für ${order.customerEmail}`}>
    <div className="admin-detail-header"><div><p className="admin-panel-eyebrow">ANFRAGE</p><h2>{order.customerEmail}</h2><span>{order.stripeSessionId}</span></div><button className="admin-icon-button" onClick={onClose} aria-label="Anfragedetails schließen"><X size={17} /></button></div>
    <div className="admin-detail-meta"><span>{euro(order.amountCents, order.currency)}</span><span>Eingegangen {dateTime(order.paidAt)}</span></div>
    <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as OrderStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className="admin-detail-section"><h3>Fahrzeugwünsche</h3><dl>{fields.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{order.criteria.notes ? <p className="admin-customer-note">„{order.criteria.notes}“</p> : null}</div>
    <label>Interne Notiz<textarea value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Nur für den Betreiber sichtbar …" /></label>
    <button className="admin-button admin-button--primary admin-save-order" disabled={saving} onClick={() => void onSave(status, note)}>{saving ? "Speichert …" : "Änderungen speichern"}</button>
  </aside>;
}

export default function AdminApp() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const next = await request<DashboardData>("/api/admin/bootstrap");
      setData(next);
      setUnavailable(false);
      setLoadError("");
    } catch (error) {
      const failure = error as ApiFailure;
      setData(null);
      setUnavailable(failure.status === 503);
      setLoadError(failure.status === 401 || failure.status === 503 ? "" : failure.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function logout() {
    await request("/api/admin/logout", { method: "POST" });
    setData(null);
  }

  if (loading && !data) return <main className="admin-loading-page" aria-live="polite"><div className="admin-loading-mark" aria-hidden="true">A</div><p>Betreiberbereich wird geladen …</p></main>;
  return data ? <Dashboard data={data} onReload={load} onLogout={logout} /> : <Login unavailable={unavailable} initialNotice={loadError} />;
}
