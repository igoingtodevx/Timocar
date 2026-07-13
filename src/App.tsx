/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Car,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Gauge,
  Instagram,
  Loader2,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Undo2,
  X,
} from "lucide-react";
import {
  ACCIDENT_OPTIONS,
  BODY_TYPES,
  COLORS,
  DELIVERY_WINDOW,
  DRIVES,
  PRODUCT_NAME,
  PRODUCT_PRICE_CENTS,
  TRANSMISSIONS,
  type OrderFormData,
  type OrderFormErrors,
  hasOrderFormErrors,
  validateOrderForm,
} from "../shared/order";

interface CarDetail {
  name: string;
  leistung: string;
  verbrauch: string;
  wertverlust: string;
  maengel: string;
  details: string;
}

type ModalKey = "impressum" | "widerruf" | "agb" | "datenschutz" | "withdrawal";
type ViewKey = "home" | "ai-tool";

type CheckoutDetails = {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  paymentStatus: string;
  product: string;
};

const emptyOrderForm: OrderFormData = {
  budget: "",
  brand: "",
  model: "",
  maxMileage: "",
  bodyType: "",
  transmission: "",
  drive: "",
  accidentFree: "",
  color: "",
  notes: "",
  email: "",
  acceptTerms: false,
  startBeforeWithdrawal: false,
  acknowledgeWithdrawalLoss: false,
};

const legalContact = {
  business: "Enricha Einzelunternehmen",
  name: "Timo Bieker",
  address: ["c/o Postflex #10093", "Emsdettener Str. 10", "48268 Greven"],
  email: "enricha@web.de",
  phone: "+49 151 20280600",
};

const socialHandle = "@YoTimoLifestyle";
const tiktokUrl = "https://www.tiktok.com/@YoTimoLifestyle";
const instagramUrl = "https://www.instagram.com/YoTimoLifestyle";

function priceLabel() {
  return `${(PRODUCT_PRICE_CENTS / 100).toLocaleString("de-DE", { minimumFractionDigits: 0 })} €`;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-xs font-semibold text-red-300" role="alert">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

function labelClass(error?: string) {
  return `block text-[10px] font-bold uppercase tracking-wider ${error ? "text-red-300" : "text-white/85"}`;
}

function inputClass(error?: string) {
  return `w-full rounded-lg border bg-[#0D0D0D] px-4 py-3 text-sm font-medium text-white placeholder-white/35 transition-all focus:outline-none focus:ring-1 ${
    error
      ? "border-red-500/70 focus:border-red-400 focus:ring-red-400"
      : "border-[#2A2A2A] focus:border-brand-orange focus:ring-brand-orange"
  }`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#222222] bg-[#111111] p-5">
      <p className="font-display text-2xl font-black text-brand-orange">{value}</p>
      <p className="mt-2 text-sm font-semibold leading-relaxed text-white/90">{label}</p>
    </div>
  );
}

function LegalAddress() {
  return (
    <>
      {legalContact.business}
      <br />
      {legalContact.name}
      <br />
      {legalContact.address.map((line) => (
        <React.Fragment key={line}>
          {line}
          <br />
        </React.Fragment>
      ))}
    </>
  );
}

export default function App() {
  const [carQuery, setCarQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedCar, setAnalyzedCar] = useState<CarDetail | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showAllDetails, setShowAllDetails] = useState(false);

  const [orderForm, setOrderForm] = useState<OrderFormData>(emptyOrderForm);
  const [formErrors, setFormErrors] = useState<OrderFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutDetails, setCheckoutDetails] = useState<CheckoutDetails | null>(null);
  const [checkoutLookupError, setCheckoutLookupError] = useState<string | null>(null);
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false);

  const [withdrawalStep, setWithdrawalStep] = useState<1 | 2>(1);
  const [withdrawalForm, setWithdrawalForm] = useState({
    name: "",
    reference: "",
    email: "",
    declaration: `Hiermit widerrufe ich meinen Vertrag über ${PRODUCT_NAME}.`,
  });
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null);
  const [withdrawalReceipt, setWithdrawalReceipt] = useState<{ receipt?: string; timestamp?: string } | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const [activeModal, setActiveModal] = useState<ModalKey | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("home");

  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const paymentState = searchParams.get("payment");
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    const handler = () => setNavScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (activeView !== "home") {
      setActiveSection("ai-tool");
      return;
    }
    const handler = () => {
      const aboutEl = document.getElementById("about-me");
      const bookingEl = document.getElementById("booking-section");
      const reviewsEl = document.getElementById("reviews");
      const scrollPoint = window.scrollY + window.innerHeight / 3;
      if (reviewsEl && scrollPoint >= reviewsEl.offsetTop) setActiveSection("reviews");
      else if (bookingEl && scrollPoint >= bookingEl.offsetTop) setActiveSection("booking-section");
      else if (aboutEl && scrollPoint >= aboutEl.offsetTop) setActiveSection("about-me");
      else setActiveSection("home");
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, [activeView]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveModal(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (paymentState !== "success" || !sessionId) return;
    setIsLoadingCheckout(true);
    setCheckoutLookupError(null);
    fetch(`/api/checkout-session?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Checkout-Details konnten nicht geladen werden.");
        setCheckoutDetails(data as CheckoutDetails);
      })
      .catch((error: unknown) => {
        setCheckoutLookupError(error instanceof Error ? error.message : "Checkout-Details konnten nicht geladen werden.");
      })
      .finally(() => setIsLoadingCheckout(false));
  }, [paymentState, sessionId]);

  const updateOrderField = <K extends keyof OrderFormData>(field: K, value: OrderFormData[K]) => {
    setOrderForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const scrollToSection = (id: string, event?: React.MouseEvent) => {
    event?.preventDefault();
    setIsMobileMenuOpen(false);
    if (activeView !== "home") {
      setActiveView("home");
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 100);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!carQuery.trim()) return;
    setIsAnalyzing(true);
    setAnalyzedCar(null);
    setAnalyzeError(null);
    setShowAllDetails(false);
    try {
      const res = await fetch("/api/analyze-car", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: carQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setAnalyzeError(data.error ?? "Unbekannter Fehler.");
      else setAnalyzedCar(data as CarDetail);
    } catch {
      setAnalyzeError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const runQuickAnalyze = async (quickCar: string) => {
    setCarQuery(quickCar);
    setIsAnalyzing(true);
    setAnalyzedCar(null);
    setAnalyzeError(null);
    setShowAllDetails(false);
    try {
      const res = await fetch("/api/analyze-car", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: quickCar }),
      });
      const data = await res.json();
      if (!res.ok) setAnalyzeError(data.error ?? "Fehler");
      else setAnalyzedCar(data as CarDetail);
    } catch {
      setAnalyzeError("Verbindung fehlgeschlagen.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateOrderForm(orderForm);
    setFormErrors(errors);
    setCheckoutError(null);
    if (hasOrderFormErrors(errors)) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setCheckoutError(data.error ?? "Checkout konnte nicht gestartet werden.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setCheckoutError("Verbindung fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    window.location.assign(window.location.pathname);
  };

  const proceedWithdrawal = (event: React.FormEvent) => {
    event.preventDefault();
    setWithdrawalError(null);
    if (!withdrawalForm.name.trim() || !withdrawalForm.reference.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(withdrawalForm.email.trim())) {
      setWithdrawalError("Bitte alle Felder ausfüllen, bevor du den Widerruf prüfst.");
      return;
    }
    setWithdrawalStep(2);
  };

  const submitWithdrawal = async () => {
    setIsWithdrawing(true);
    setWithdrawalError(null);
    setWithdrawalReceipt(null);
    try {
      const res = await fetch("/api/withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withdrawalForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWithdrawalError(data.error ?? "Widerruf konnte nicht gesendet werden.");
        return;
      }
      setWithdrawalReceipt({
        receipt: data.receiptReference,
        timestamp: data.receivedAt,
      });
    } catch {
      setWithdrawalError("Verbindung fehlgeschlagen. Bitte sende den Widerruf alternativ per E-Mail.");
    } finally {
      setIsWithdrawing(false);
    }
  };

  const navLinks: { label: string; section: string; action: (event?: React.MouseEvent) => void }[] = [
    { label: "Startseite", section: "home", action: () => { setActiveView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { label: "KI-Fahrzeugcheck", section: "ai-tool", action: () => { setActiveView("ai-tool"); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { label: "Über Timo", section: "about-me", action: (event) => scrollToSection("about-me", event) },
    { label: PRODUCT_NAME, section: "booking-section", action: (event) => scrollToSection("booking-section", event) },
    { label: "Bewertungen", section: "reviews", action: (event) => scrollToSection("reviews", event) },
  ];

  const renderSelect = (
    field: keyof OrderFormData,
    label: string,
    options: readonly string[],
  ) => {
    const error = formErrors[field];
    const errorId = `${field}-error`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={`${field}-input`} className={labelClass(error)}>
          {label} <span aria-hidden="true">*</span>
        </label>
        <select
          id={`${field}-input`}
          value={String(orderForm[field])}
          onChange={(event) => updateOrderField(field, event.target.value)}
          required
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={inputClass(error)}
        >
          <option value="">Bitte auswählen</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <FieldError id={errorId} message={error} />
      </div>
    );
  };

  const renderTextInput = (
    field: keyof OrderFormData,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => {
    const error = formErrors[field];
    const errorId = `${field}-error`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={`${field}-input`} className={labelClass(error)}>
          {label} <span aria-hidden="true">*</span>
        </label>
        <input
          id={`${field}-input`}
          value={String(orderForm[field])}
          onChange={(event) => updateOrderField(field, event.target.value)}
          required
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={inputClass(error)}
          {...props}
        />
        <FieldError id={errorId} message={error} />
      </div>
    );
  };

  const renderCheckbox = (field: "acceptTerms" | "startBeforeWithdrawal" | "acknowledgeWithdrawalLoss", label: React.ReactNode) => {
    const error = formErrors[field];
    const errorId = `${field}-error`;
    return (
      <div className="space-y-2">
        <label className={`flex items-start gap-3 rounded-lg border p-4 text-sm leading-relaxed ${error ? "border-red-500/70 bg-red-950/20" : "border-[#222222] bg-[#0D0D0D]"}`}>
          <input
            type="checkbox"
            checked={orderForm[field]}
            onChange={(event) => updateOrderField(field, event.target.checked)}
            required
            aria-required="true"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="mt-1 h-4 w-4 shrink-0 accent-brand-orange"
          />
          <span className="text-white/90">{label}</span>
        </label>
        <FieldError id={errorId} message={error} />
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0D0D0D] font-sans text-white/85">
      <header className={`fixed left-0 right-0 top-0 z-30 h-16 transition-all duration-300 ${navScrolled ? "border-b border-[#1A1A1A] bg-[#0D0D0D]/95 backdrop-blur-md" : "bg-transparent"}`}>
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6 md:px-8 lg:px-12">
          <button onClick={() => { setActiveView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="group flex cursor-pointer items-center gap-2.5" aria-label="AutoWunsch.com Startseite">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-orange transition-colors group-hover:bg-[#e05621]">
              <Car className="h-4 w-4 text-white" />
            </div>
            <div className="leading-none">
              <span className="block font-display text-sm font-black uppercase tracking-tight text-white">AutoWunsch.com</span>
              <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-brand-orange">Autoempfehlung</span>
            </div>
          </button>

          <nav className="hidden items-center gap-7 text-sm font-semibold lg:flex" aria-label="Hauptnavigation">
            {navLinks.map(({ label, action, section }) => (
              <button key={label} onClick={(event) => action(event)} className={`cursor-pointer transition-colors ${activeSection === section ? "text-white" : "text-white/60 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </nav>

          <button onClick={(event) => scrollToSection("booking-section", event)} className="hidden cursor-pointer items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#e05621] lg:inline-flex">
            {priceLabel()} buchen <ArrowRight className="h-4 w-4" />
          </button>

          <button onClick={() => setIsMobileMenuOpen(true)} className="cursor-pointer p-1.5 text-white/70 transition-colors hover:text-white lg:hidden" aria-label="Menü öffnen">
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-[#0D0D0D] lg:hidden">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#1A1A1A] px-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-orange">
                <Car className="h-4 w-4 text-white" />
              </div>
              <span className="font-display text-sm font-black uppercase tracking-tight text-white">AutoWunsch.com</span>
            </div>
            <button onClick={() => setIsMobileMenuOpen(false)} className="cursor-pointer p-1.5 text-white/70 hover:text-white" aria-label="Schließen">
              <X className="h-6 w-6" />
            </button>
          </div>
          <nav className="flex flex-grow flex-col overflow-y-auto px-6 pt-4" aria-label="Mobile Navigation">
            {navLinks.map(({ label, action }) => (
              <button key={label} onClick={(event) => { action(event); setIsMobileMenuOpen(false); }} className="w-full cursor-pointer border-b border-[#1A1A1A] py-5 text-left text-2xl font-black text-white transition-colors last:border-0 hover:text-brand-orange">
                {label}
              </button>
            ))}
          </nav>
          <div className="shrink-0 border-t border-[#1A1A1A] p-6">
            <button onClick={(event) => { scrollToSection("booking-section", event); setIsMobileMenuOpen(false); }} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-orange py-4 text-base font-bold text-white transition-colors hover:bg-[#e05621]">
              {PRODUCT_NAME} buchen <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-grow pt-16">
        {activeView === "home" ? (
          <>
            <section id="home" className="hero-dot-grid flex min-h-[calc(100vh-64px)] flex-col">
              <div className="mx-auto grid w-full max-w-7xl flex-grow grid-cols-1 items-center gap-12 px-6 py-20 md:px-8 md:py-28 lg:grid-cols-12 lg:gap-16 lg:px-12">
                <div className="space-y-8 lg:col-span-7">
                  <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-brand-orange">Herstellerunabhängige Autoempfehlung</p>
                  <h1 className="font-display font-black leading-[0.88] tracking-tight">
                    <span className="block text-6xl text-white md:text-7xl lg:text-[84px]">Finde dein</span>
                    <span className="block text-6xl italic text-brand-orange md:text-7xl lg:text-[84px]">PERFEKTES</span>
                    <span className="block text-6xl text-white md:text-7xl lg:text-[84px]">Auto.</span>
                  </h1>
                  <p className="max-w-lg text-base leading-relaxed text-white/85 md:text-lg">
                    AutoWunsch.com liefert dir eine klare Autoempfehlung ohne Autohaus-Druck. Du bekommst drei konkrete Links zu passenden Autos auf Verkaufsplattformen innerhalb von 48 Stunden.
                  </p>
                  <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                    <button onClick={(event) => scrollToSection("booking-section", event)} className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-orange px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#e05621]">
                      {PRODUCT_NAME} buchen <ArrowRight className="h-4 w-4" />
                    </button>
                    <button onClick={() => { setActiveView("ai-tool"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#2A2A2A] px-6 py-3.5 text-sm font-bold text-white/85 transition-colors hover:border-[#444444] hover:text-white">
                      KI-Fahrzeugcheck <ArrowRight className="h-4 w-4 text-white/50" />
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <div className="space-y-6 rounded-xl border border-[#222222] bg-[#111111] p-7">
                    <div>
                      <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.3em] text-white/70">Dienstleistung</span>
                      <h2 className="font-display text-2xl font-extrabold leading-snug text-white">{PRODUCT_NAME}</h2>
                    </div>
                    <div className="flex items-baseline gap-2.5 border-t border-[#1A1A1A] pt-5">
                      <span className="font-display text-5xl font-black tracking-tight text-white">{priceLabel()}</span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-white/70">einmaliger Gesamtpreis</span>
                    </div>
                    <div className="space-y-4 border-t border-[#1A1A1A] pt-5">
                      {[
                        { n: "01", t: "Kriterien sauber erfassen", d: "Budget, Marke, Modell und Alltag werden konkret eingegrenzt." },
                        { n: "02", t: "3 Links auf Verkaufsplattformen", d: "Du erhältst drei passende Autos als direkte Inserat-Links." },
                        { n: "03", t: "Lieferung innerhalb von 48 Stunden", d: "Express-Ausführung nach Zahlung und deinen Bestätigungen." },
                      ].map(({ n, t, d }) => (
                        <div key={n} className="flex gap-3.5">
                          <span className="mt-0.5 w-5 shrink-0 font-display text-[11px] font-black text-brand-orange">{n}</span>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-white">{t}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-white/85">{d}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button onClick={(event) => scrollToSection("booking-section", event)} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-orange py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#e05621]">
                      Jetzt buchen <ArrowRight className="h-4 w-4" />
                    </button>
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                      <span className="text-brand-orange">4.8/5 Zufriedenheit</span>
                      <span className="text-white">100% transparent</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#1A1A1A]">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 md:gap-6 md:px-8 lg:px-12">
                  <span>AutoWunsch.com</span><span className="text-[#2A2A2A]">-</span>
                  <span>Markenneutral</span><span className="text-[#2A2A2A]">-</span>
                  <span>3 Verkaufsplattform-Links</span><span className="text-[#2A2A2A]">-</span>
                  <span>48h Lieferzeit</span><span className="text-[#2A2A2A]">-</span>
                  <span className="text-white">50.000 Follower · {socialHandle}</span>
                </div>
              </div>
            </section>

            <section id="about-me" className="scroll-mt-16 border-t border-[#1A1A1A] py-24 md:py-32">
              <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-12 px-6 md:px-8 lg:grid-cols-12 lg:gap-16 lg:px-12">
                <div className="space-y-8 lg:col-span-7">
                  <div>
                    <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.3em] text-brand-orange">Der Typ dahinter</span>
                    <h2 className="font-display text-4xl font-black leading-tight text-white md:text-5xl">Hey, ich bin<br />Timo.</h2>
                  </div>
                  <div className="space-y-5 leading-relaxed text-white/90">
                    <p>Ich bin <strong className="text-brand-orange">Timo Bieker</strong> und betreibe AutoWunsch.com für Menschen, die ein passendes Auto suchen, ohne sich von Inseraten, Verkäufern und widersprüchlichen Meinungen erschlagen zu lassen.</p>
                    <p>Auf TikTok und Instagram findest du mich als <strong className="text-brand-orange">{socialHandle}</strong>. Der Account hat rund <strong className="text-brand-orange">50.000 Follower</strong>; über mein Netzwerk laufen <strong className="text-brand-orange">1 Mio.+ Follower über 15+ Social-Media-Accounts</strong>.</p>
                    <p>Du gibst deine Kriterien an, ich liefere dir innerhalb von 48 Stunden <strong className="text-brand-orange">3 Links zu passenden Autos auf Verkaufsplattformen</strong> mit einer klaren Einordnung, warum diese Fahrzeuge zu deinem Profil passen.</p>
                  </div>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <a href={tiktokUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#222222] bg-[#111111] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-[#3A3A3A] hover:text-brand-orange">
                      <Sparkles className="h-4 w-4 shrink-0" /> TikTok · {socialHandle}
                    </a>
                    <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#222222] bg-[#111111] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-[#3A3A3A] hover:text-brand-orange">
                      <Instagram className="h-4 w-4 shrink-0" /> Instagram · {socialHandle}
                    </a>
                    <a href="https://autowunsch.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#222222] bg-[#111111] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-[#3A3A3A] hover:text-brand-orange">
                      <Award className="h-4 w-4 shrink-0" /> AutoWunsch.com
                    </a>
                  </div>
                </div>

                <div className="space-y-5 lg:col-span-5">
                  <img src="/timo-autowunsch.jpeg" alt="Timo von AutoWunsch.com" className="aspect-[4/5] w-full rounded-xl border border-[#222222] object-cover object-center" />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <StatCard value="15+" label="Autos selbst gekauft" />
                    <StatCard value="AMG GT 63 & GLE 300 Coupé" label="Aktuelle Fahrzeuge" />
                    <StatCard value="Ferrari 812 Superfast Novitec" label="Persönliches Ziel" />
                    <StatCard value="1 Mio.+" label="Follower über 15+ Social-Media-Accounts" />
                  </div>
                </div>
              </div>
            </section>

            <section id="booking-section" className="scroll-mt-16 border-t border-[#1A1A1A] py-24 md:py-32">
              <div className="mx-auto max-w-7xl px-6 md:px-8 lg:px-12">
                <div className="mx-auto max-w-3xl">
                  <div className="mb-12">
                    <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.3em] text-brand-orange">Bestellformular</span>
                    <h2 className="font-display text-4xl font-black leading-tight text-white md:text-5xl">{PRODUCT_NAME}<br />buchen.</h2>
                    <p className="mt-4 max-w-lg leading-relaxed text-white/85">Du erhältst <strong className="text-brand-orange">3 Links zu Autos auf Verkaufsplattformen innerhalb von 48 Stunden</strong>. Alle Pflichtfelder werden ohne stille Standardwerte abgefragt.</p>
                  </div>

                  <div className="overflow-hidden rounded-xl border border-[#222222] bg-[#111111]">
                    <div className="flex items-center justify-between border-b border-[#1A1A1A] px-6 py-4">
                      <div className="flex items-center gap-2 text-sm font-bold text-white">
                        <ShieldCheck className="h-4 w-4 text-brand-orange" /> Sichere Bestellung
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider text-white/70">Stripe Checkout</span>
                    </div>

                    {paymentState === "success" && sessionId ? (
                      <div className="space-y-6 p-8 text-center md:p-12">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-900/50 bg-emerald-950/40">
                          <Check className="h-7 w-7 text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="font-display text-2xl font-black text-white">{checkoutDetails ? "Zahlung bestätigt." : "Zahlung wird bestätigt."}</h3>
                          <p className="mt-2 text-sm leading-relaxed text-white/85">Session-ID: <span className="font-mono text-brand-orange">{sessionId ?? "nicht übergeben"}</span></p>
                        </div>
                        {isLoadingCheckout && (
                          <p className="inline-flex items-center gap-2 text-sm font-semibold text-white/85">
                            <Loader2 className="h-4 w-4 animate-spin text-brand-orange" /> Serverbestätigung wird geladen...
                          </p>
                        )}
                        {checkoutLookupError && (
                          <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-left text-sm text-red-200">
                            <p className="font-bold">Serverbestätigung fehlgeschlagen</p>
                            <p className="mt-1">{checkoutLookupError}</p>
                          </div>
                        )}
                        {checkoutDetails && (
                          <div className="rounded-lg border border-[#222222] bg-[#0D0D0D] p-5 text-left text-sm text-white/85">
                            <p><strong className="text-white">Referenz:</strong> <span className="font-mono">{checkoutDetails.reference}</span></p>
                            <p><strong className="text-white">Status:</strong> {checkoutDetails.paymentStatus}</p>
                            <p><strong className="text-white">Betrag:</strong> {`${(checkoutDetails.amount / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} ${checkoutDetails.currency.toUpperCase()}`}</p>
                            <p><strong className="text-white">Produkt:</strong> {checkoutDetails.product}</p>
                          </div>
                        )}
                        <button onClick={handleResetForm} className="cursor-pointer rounded-lg border border-[#2A2A2A] px-5 py-3 text-sm font-bold text-white transition-colors hover:border-[#444444]">
                          Neue Anfrage starten
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleFormSubmit} noValidate className="space-y-5 p-6 md:p-8">
                        {paymentState === "cancelled" && (
                          <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-4 text-sm text-amber-100">
                            Zahlung abgebrochen. Du kannst die Bestellung erneut starten.
                          </div>
                        )}
                        <div className="space-y-5">
                          {renderTextInput("budget", "Budget (€)", { inputMode: "numeric", placeholder: "z. B. 35000" })}
                          {renderTextInput("brand", "Marke", { placeholder: "z. B. Mercedes-Benz" })}
                          {renderTextInput("model", "Modell", { placeholder: "z. B. C-Klasse" })}
                          {renderTextInput("maxMileage", "Max Kilometer", { inputMode: "numeric", placeholder: "z. B. 80000" })}
                        </div>
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                          {renderSelect("bodyType", "Karosserietyp", BODY_TYPES)}
                          {renderSelect("transmission", "Getriebe", TRANSMISSIONS)}
                          {renderSelect("drive", "Antrieb", DRIVES)}
                          {renderSelect("accidentFree", "Unfallfrei", ACCIDENT_OPTIONS)}
                          {renderSelect("color", "Farbe", COLORS)}
                          {renderTextInput("email", "E-Mail", { type: "email", placeholder: "du@example.com", autoComplete: "email" })}
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="notes-input" className={labelClass(formErrors.notes)}>
                            Weitere Wünsche <span aria-hidden="true">*</span>
                          </label>
                          <textarea
                            id="notes-input"
                            value={orderForm.notes}
                            onChange={(event) => updateOrderField("notes", event.target.value)}
                            required
                            aria-required="true"
                            aria-invalid={Boolean(formErrors.notes)}
                            aria-describedby={formErrors.notes ? "notes-error" : undefined}
                            rows={4}
                            placeholder="Ausstattung, Nutzungsprofil, No-Gos, Finanzierung, regionale Suche..."
                            className={`${inputClass(formErrors.notes)} min-h-28 resize-y`}
                          />
                          <FieldError id="notes-error" message={formErrors.notes} />
                        </div>

                        <div className="space-y-3">
                          {renderCheckbox("acceptTerms", <>Ich akzeptiere die <button type="button" onClick={(event) => { event.preventDefault(); setActiveModal("agb"); }} className="cursor-pointer font-bold text-brand-orange hover:underline">AGB</button> und habe die <button type="button" onClick={(event) => { event.preventDefault(); setActiveModal("widerruf"); }} className="cursor-pointer font-bold text-brand-orange hover:underline">Widerrufsbelehrung</button> sowie die <button type="button" onClick={(event) => { event.preventDefault(); setActiveModal("datenschutz"); }} className="cursor-pointer font-bold text-brand-orange hover:underline">Datenschutzerklärung</button> zur Kenntnis genommen.</>)}
                          {renderCheckbox("startBeforeWithdrawal", <>Ich verlange ausdrücklich, dass AutoWunsch.com vor Ablauf der Widerrufsfrist mit der Dienstleistung beginnt.</>)}
                          {renderCheckbox("acknowledgeWithdrawalLoss", <>Ich weiß, dass mein Widerrufsrecht bei vollständiger Erbringung der Dienstleistung erlischt.</>)}
                        </div>

                        {checkoutError && (
                          <div className="flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-red-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p className="text-sm font-semibold">{checkoutError}</p>
                          </div>
                        )}

                        <button type="submit" disabled={isSubmitting} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-orange py-4 text-base font-bold text-white transition-colors hover:bg-[#e05621] disabled:cursor-not-allowed disabled:opacity-50">
                          {isSubmitting ? <><Loader2 className="h-5 w-5 animate-spin" /><span>Weiterleitung zu Stripe...</span></> : <><span>{priceLabel()} zahlen & Autoempfehlung anfragen</span><ArrowRight className="h-5 w-5" /></>}
                        </button>
                        <p className="text-center text-xs text-white/70">Produkt: {PRODUCT_NAME}. Lieferung: {DELIVERY_WINDOW}.</p>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section id="reviews" className="scroll-mt-16 border-t border-[#1A1A1A] py-24 md:py-32">
              <div className="mx-auto max-w-7xl px-6 md:px-8 lg:px-12">
                <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
                  <div>
                    <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.3em] text-brand-orange">Kundenstimmen</span>
                    <h2 className="font-display text-4xl font-black leading-tight text-white md:text-5xl">Direkt verwertbare<br />Empfehlungen.</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-display text-2xl font-black text-white">4.8</span>
                    <div className="flex text-brand-orange">{[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}</div>
                    <span className="text-sm text-white/70">148 Bewertungen</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  {[
                    { title: "Endlich konkrete Inserate", text: "Ich hatte nach der Autoempfehlung drei Links, die wirklich zu meinem Budget gepasst haben. Kein Ratespiel mehr.", name: "Mika S.", time: "vor 2 Wochen" },
                    { title: "Sehr klare Einordnung", text: "Timo hat nicht einfach Modelle genannt, sondern erklärt, welche Ausstattung und Laufleistung für mich sinnvoll ist.", name: "Lena K.", time: "vor 1 Monat" },
                    { title: "49 € gut investiert", text: "Die Empfehlung kam schnell und hat mir geholfen, ein schlechtes Inserat direkt auszusortieren.", name: "Jonas W.", time: "vor 3 Wochen" },
                  ].map(({ title, text, name, time }) => (
                    <div key={name} className="flex flex-col rounded-xl border border-[#222222] bg-[#111111] p-7 transition-colors hover:border-[#333333]">
                      <div className="mb-5 flex text-brand-orange">{[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}</div>
                      <blockquote className="flex-grow space-y-2">
                        <p className="text-sm font-bold text-white">{title}</p>
                        <p className="text-sm leading-relaxed text-white/85">"{text}"</p>
                      </blockquote>
                      <div className="mt-6 flex items-center justify-between border-t border-[#1A1A1A] pt-5">
                        <span className="text-sm font-bold text-white">{name}</span>
                        <span className="text-xs text-white/60">{time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : (
          <section id="ai-tool" className="min-h-[calc(100vh-64px)] scroll-mt-16 py-16 md:py-24">
            <div className="mx-auto max-w-7xl px-6 md:px-8 lg:px-12">
              <div className="mb-10">
                <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[#222222] bg-[#111111] px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-orange">
                  <Sparkles className="h-3.5 w-3.5" /> Automatisierter Vor-Check
                </div>
                <h2 className="font-display text-4xl font-black leading-tight text-white md:text-5xl">KI-Fahrzeug&shy;analyse.</h2>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/85">Gib ein Automodell ein und erhalte eine erste Einschätzung zu Leistung, Verbrauch, Wertverlust und bekannten Schwachstellen.</p>
              </div>

              <div className="max-w-3xl rounded-xl border border-[#222222] bg-[#111111] p-6 md:p-8">
                <form onSubmit={handleAnalyze} className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-grow">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
                    <input type="text" value={carQuery} onChange={(event) => setCarQuery(event.target.value)} placeholder="z. B. Mercedes C63 AMG" className="w-full rounded-lg border border-[#222222] bg-[#0D0D0D] py-3.5 pl-11 pr-4 text-sm font-medium text-white placeholder-white/35 transition-all focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange" />
                  </div>
                  <button type="submit" disabled={isAnalyzing || !carQuery.trim()} className="flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-orange px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#e05621] disabled:cursor-not-allowed disabled:opacity-50">
                    {isAnalyzing ? <><Loader2 className="h-4 w-4 animate-spin" /><span>Analysiere...</span></> : <><span>Analysieren</span><ArrowRight className="h-4 w-4" /></>}
                  </button>
                </form>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-white/70">Häufig gesucht:</span>
                  {["Golf GTI", "BMW M3", "Mercedes C63 AMG", "Audi RS6", "Porsche 911"].map((quickCar) => (
                    <button key={quickCar} type="button" onClick={() => runQuickAnalyze(quickCar)} className="cursor-pointer rounded-md border border-[#1E1E1E] bg-[#0D0D0D] px-2.5 py-1 font-medium text-white/70 transition-colors hover:border-[#333333] hover:text-white">
                      {quickCar}
                    </button>
                  ))}
                </div>

                {isAnalyzing && (
                  <div className="mt-8 flex flex-col items-center gap-3 border-t border-[#1A1A1A] py-10">
                    <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
                    <div className="text-center">
                      <p className="text-sm font-bold text-white">KI analysiert Fahrzeugdaten...</p>
                      <p className="mt-1 text-xs text-white/60">Die AutoWunsch.com Empfehlung ersetzt keine Besichtigung.</p>
                    </div>
                  </div>
                )}

                {analyzeError && !isAnalyzing && (
                  <div className="mt-5 flex items-start gap-3 rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-red-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-bold">Analyse fehlgeschlagen</p>
                      <p className="mt-1 text-xs">{analyzeError}</p>
                    </div>
                  </div>
                )}

                {analyzedCar && !isAnalyzing && (
                  <div className="mt-8 space-y-5 border-t border-[#1A1A1A] pt-6">
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                      <div>
                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-brand-orange">Analyse-Ergebnis</span>
                        <h3 className="flex items-center gap-2 font-display text-xl font-black text-white">
                          <Car className="h-5 w-5 shrink-0 text-brand-orange" />{analyzedCar.name}
                        </h3>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-900/50 bg-emerald-950/40 px-3 py-1 text-xs font-bold text-emerald-300">
                        <CheckCircle className="h-3.5 w-3.5" /> Ausgewertet
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {[
                        { label: "Leistung", value: analyzedCar.leistung, icon: <Gauge className="h-4 w-4 text-brand-orange" /> },
                        { label: "Verbrauch", value: analyzedCar.verbrauch, icon: <Car className="h-4 w-4 text-brand-orange" /> },
                        { label: "Wertverlust", value: analyzedCar.wertverlust, icon: <Award className="h-4 w-4 text-brand-orange" /> },
                        { label: "Mängel", value: analyzedCar.maengel.split(",")[0], icon: <AlertTriangle className="h-4 w-4 text-brand-orange" /> },
                      ].map(({ label, value, icon }) => (
                        <div key={label} className="rounded-lg border border-[#1E1E1E] bg-[#0D0D0D] p-4 transition-colors hover:border-[#2A2A2A]">
                          <div className="mb-2.5 flex items-center justify-between">
                            {icon}
                            <span className="text-right text-[9px] font-bold uppercase tracking-wider text-white/60">{label}</span>
                          </div>
                          <p className="text-sm font-bold leading-snug text-white">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="overflow-hidden rounded-lg border border-[#1E1E1E] bg-[#0D0D0D]">
                      <button type="button" onClick={() => setShowAllDetails(!showAllDetails)} className="flex w-full cursor-pointer select-none items-center justify-between px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#111111]">
                        <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-orange" />Ausführlicher KI-Checkbericht</span>
                        {showAllDetails ? <ChevronUp className="h-4 w-4 text-brand-orange" /> : <ChevronDown className="h-4 w-4 text-brand-orange" />}
                      </button>
                      {showAllDetails && (
                        <div className="space-y-4 border-t border-[#1A1A1A] px-5 pb-5 pt-3">
                          <p className="text-sm leading-relaxed text-white/85">{analyzedCar.details}</p>
                          <div className="rounded-lg border border-brand-orange/10 bg-brand-orange/5 p-4">
                            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white">
                              <AlertTriangle className="h-3.5 w-3.5 text-brand-orange" /> Schwachstellen im Detail:
                            </h4>
                            <p className="text-xs leading-relaxed text-white/85">{analyzedCar.maengel}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-10 flex max-w-3xl flex-col items-start justify-between gap-5 rounded-xl border border-[#222222] bg-[#111111] p-6 md:flex-row md:items-center md:p-8">
                <div>
                  <h3 className="font-display text-lg font-black text-white">Brauchst du eine echte Autoempfehlung?</h3>
                  <p className="mt-1 text-sm text-white/85">3 Links zu passenden Autos auf Verkaufsplattformen innerhalb von 48 Stunden.</p>
                </div>
                <button onClick={(event) => scrollToSection("booking-section", event)} className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-brand-orange px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#e05621]">
                  Zur Autoempfehlung <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="mt-auto border-t border-[#1A1A1A] py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-6 text-xs text-white/70 md:flex-row md:px-8 lg:px-12">
          <div className="space-y-0.5 text-center md:text-left">
            <p className="font-display text-sm font-black uppercase tracking-wide text-white">AutoWunsch.com</p>
            <p>© 2026 Enricha Einzelunternehmen. Produkt: {PRODUCT_NAME}.</p>
          </div>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium" aria-label="Rechtliches">
            <button onClick={() => setActiveModal("withdrawal")} className="cursor-pointer font-bold text-brand-orange transition-colors hover:text-white">Vertrag widerrufen</button>
            {[["impressum", "Impressum"], ["widerruf", "Widerrufsbelehrung"], ["agb", "AGB"], ["datenschutz", "Datenschutz"]].map(([key, label]) => (
              <button key={key} onClick={() => setActiveModal(key as ModalKey)} className="cursor-pointer transition-colors hover:text-white">{label}</button>
            ))}
          </nav>
        </div>
      </footer>

      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#222222] bg-[#111111] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#1A1A1A] bg-[#111111] px-6 py-4">
              <h4 className="font-display text-base font-black uppercase tracking-wide text-white">
                {activeModal === "impressum" && "Impressum"}
                {activeModal === "widerruf" && "Widerrufsbelehrung"}
                {activeModal === "agb" && "Allgemeine Geschäftsbedingungen"}
                {activeModal === "datenschutz" && "Datenschutzerklärung"}
                {activeModal === "withdrawal" && "Vertrag widerrufen"}
              </h4>
              <button onClick={() => setActiveModal(null)} className="cursor-pointer rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/5 hover:text-white" aria-label="Schließen">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6 text-sm leading-relaxed text-white/85 md:p-8">
              {activeModal === "impressum" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">Angaben gemäß § 5 DDG</p>
                  <p><LegalAddress /></p>
                  <p className="font-semibold text-white">Kontakt</p>
                  <p>Telefon: <a className="text-brand-orange hover:underline" href={`tel:${legalContact.phone.replace(/\s/g, "")}`}>{legalContact.phone}</a><br />E-Mail: <a className="text-brand-orange hover:underline" href={`mailto:${legalContact.email}`}>{legalContact.email}</a></p>
                  <p className="font-semibold text-white">Redaktionell verantwortlich</p>
                  <p>Timo Bieker, Anschrift wie oben.</p>
                  <p className="font-semibold text-white">Verbraucherstreitbeilegung</p>
                  <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle im Sinne des VSBG teilzunehmen.</p>
                </div>
              )}

              {activeModal === "widerruf" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">Widerrufsbelehrung für Dienstleistungen</p>
                  <p className="font-semibold text-white">Widerrufsrecht</p>
                  <p>Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.</p>
                  <p>Um Ihr Widerrufsrecht auszuüben, müssen Sie uns ({legalContact.business}, {legalContact.name}, {legalContact.address.join(", ")}, E-Mail: {legalContact.email}, Telefon: {legalContact.phone}) mittels einer eindeutigen Erklärung über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren.</p>
                  <p className="font-semibold text-white">Beginn vor Ablauf der Widerrufsfrist</p>
                  <p>Verlangen Sie ausdrücklich, dass wir während der Widerrufsfrist mit der Dienstleistung beginnen, schulden Sie uns bei Widerruf einen angemessenen Betrag, der dem Anteil der bis zum Widerruf bereits erbrachten Leistungen im Vergleich zum Gesamtumfang der vereinbarten Dienstleistung entspricht.</p>
                  <p className="font-semibold text-white">Erlöschen des Widerrufsrechts</p>
                  <p>Das Widerrufsrecht erlischt bei einem Dienstleistungsvertrag nur, wenn die Dienstleistung vollständig erbracht wurde und wir mit der Ausführung erst begonnen haben, nachdem Sie ausdrücklich zugestimmt haben, dass wir vor Ablauf der Widerrufsfrist mit der Ausführung beginnen, und Sie Ihre Kenntnis bestätigt haben, dass Ihr Widerrufsrecht bei vollständiger Vertragserfüllung erlischt.</p>
                  <p className="font-semibold text-white">Folgen des Widerrufs</p>
                  <p>Wenn Sie diesen Vertrag widerrufen, erstatten wir alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab Eingang Ihres Widerrufs. Für die Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, sofern nichts anderes vereinbart wurde.</p>
                  <div className="rounded-lg border border-[#222222] bg-[#0D0D0D] p-4">
                    <p className="font-semibold text-white">Muster-Widerrufsformular</p>
                    <p className="mt-2">Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die Erbringung der Dienstleistung {PRODUCT_NAME}. Bestellt am: ____. Name: ____. Anschrift: ____. Datum: ____.</p>
                  </div>
                </div>
              )}

              {activeModal === "agb" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">Allgemeine Geschäftsbedingungen</p>
                  <p className="font-semibold text-white">§ 1 Anbieter und Geltung</p>
                  <p>Diese AGB gelten für alle Bestellungen von {PRODUCT_NAME} über AutoWunsch.com bei {legalContact.business}, Inhaber Timo Bieker.</p>
                  <p className="font-semibold text-white">§ 2 Vertragsgegenstand</p>
                  <p>Gegenstand ist eine herstellerunabhängige Autoempfehlung. Auf Basis Ihrer Angaben recherchieren wir drei passende Fahrzeuge und senden Ihnen drei Links zu Autos auf Verkaufsplattformen mit kurzer Einordnung per E-Mail.</p>
                  <p className="font-semibold text-white">§ 3 Vertragsschluss und Zahlung</p>
                  <p>Der Vertrag kommt nach Absenden der Bestellung und erfolgreicher Zahlung über Stripe Checkout zustande. Der Gesamtpreis beträgt {priceLabel()}; zusätzliche Kosten fallen für die Dienstleistung nicht an.</p>
                  <p className="font-semibold text-white">§ 4 Lieferzeit</p>
                  <p>Die Autoempfehlung wird {DELIVERY_WINDOW} nach Zahlung und vollständiger Übermittlung der erforderlichen Angaben per E-Mail geliefert.</p>
                  <p className="font-semibold text-white">§ 5 Grenzen der Empfehlung</p>
                  <p>Unsere Empfehlung ist eine fachliche Vorauswahl und keine Garantie für Zustand, Verfügbarkeit, Preisentwicklung oder späteren Vertragsschluss mit einem Verkäufer. Eine Prüfung vor Ort und eigene Kaufentscheidung bleiben erforderlich.</p>
                  <p className="font-semibold text-white">§ 6 Widerruf</p>
                  <p>Für Verbraucher gilt die gesonderte Widerrufsbelehrung. Bei ausdrücklich gewünschtem Leistungsbeginn während der Widerrufsfrist kann Wertersatz für bereits erbrachte Leistungen anfallen; das Widerrufsrecht erlischt nur nach vollständiger Leistungserbringung und den gesetzlich erforderlichen Bestätigungen.</p>
                </div>
              )}

              {activeModal === "datenschutz" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">Datenschutzerklärung</p>
                  <p className="font-semibold text-white">Verantwortlicher</p>
                  <p>{legalContact.business}, Timo Bieker, {legalContact.address.join(", ")}, E-Mail: {legalContact.email}, Telefon: {legalContact.phone}.</p>
                  <p className="font-semibold text-white">Verarbeitete Daten und Zwecke</p>
                  <p>Wir verarbeiten die von Ihnen eingegebenen Bestelldaten (Budget, Marke, Modell, maximale Kilometer, Karosserietyp, Getriebe, Antrieb, Unfallfreiheit, Farbe, weitere Wünsche und E-Mail), um {PRODUCT_NAME} zu erstellen, die Zahlung abzuwickeln, Rückfragen zu beantworten und gesetzliche Nachweise zu führen. Rechtsgrundlagen sind Art. 6 Abs. 1 lit. b DSGVO für Vertragserfüllung, Art. 6 Abs. 1 lit. c DSGVO für gesetzliche Pflichten und Art. 6 Abs. 1 lit. f DSGVO für Sicherheit und Missbrauchsschutz.</p>
                  <p className="font-semibold text-white">Hosting, Zahlung, E-Mail und Serverlogs</p>
                  <p>AutoWunsch.com wird aktuell über Vercel bereitgestellt. Vercel verarbeitet technische Zugriffsdaten und Serverlogs wie IP-Adresse, Zeitpunkt, URL, Statuscode und Browserdaten zur Auslieferung, Sicherheit und Fehleranalyse. Zahlungen laufen über Stripe; Stripe verarbeitet Zahlungs- und Checkout-Daten eigenverantwortlich bzw. als Dienstleister. E-Mails werden über einen SMTP-Dienst versendet; dafür werden Empfängeradresse, Inhalt und Versandmetadaten verarbeitet.</p>
                  <p className="font-semibold text-white">Speicherdauer</p>
                  <p>Bestell- und Zahlungsnachweise speichern wir, solange dies für Vertragserfüllung, steuerliche und handelsrechtliche Aufbewahrungspflichten erforderlich ist. Serverlogs werden nur so lange gespeichert, wie sie für Betrieb, Sicherheit und Fehleranalyse benötigt werden. Kontakt- und Widerrufsanfragen speichern wir bis zur abschließenden Bearbeitung und nach Maßgabe gesetzlicher Nachweisfristen.</p>
                  <p className="font-semibold text-white">Ihre Rechte</p>
                  <p>Sie haben nach Maßgabe der DSGVO Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Außerdem können Sie sich bei einer Datenschutzaufsichtsbehörde beschweren. Kontakt: <a className="text-brand-orange hover:underline" href={`mailto:${legalContact.email}`}>{legalContact.email}</a>.</p>
                  <p className="font-semibold text-white">Sicherheit</p>
                  <p>Die Übertragung erfolgt per HTTPS. Zugriff auf Bestellinformationen wird auf die Personen und Dienstleister beschränkt, die für Bearbeitung, Zahlung, E-Mail-Versand, Betrieb oder gesetzliche Pflichten erforderlich sind.</p>
                </div>
              )}

              {activeModal === "withdrawal" && (
                <div className="space-y-5">
                  {withdrawalReceipt ? (
                    <div className="space-y-4 rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-5 text-emerald-100">
                      <div className="flex items-center gap-2 font-bold text-white"><CheckCircle className="h-5 w-5 text-emerald-300" /> Widerruf eingegangen</div>
                      <p>Beleg: <span className="font-mono">{withdrawalReceipt.receipt}</span></p>
                      <p>Zeitpunkt: {new Date(withdrawalReceipt.timestamp ?? Date.now()).toLocaleString("de-DE")}</p>
                    </div>
                  ) : withdrawalStep === 1 ? (
                    <form onSubmit={proceedWithdrawal} className="space-y-4">
                      <p>Nutze dieses Formular, um deinen Vertrag über {PRODUCT_NAME} eindeutig zu widerrufen.</p>
                      <div className="space-y-1.5">
                        <label htmlFor="withdrawal-name" className="block text-[10px] font-bold uppercase tracking-wider text-white/85">Name *</label>
                        <input id="withdrawal-name" value={withdrawalForm.name} onChange={(event) => setWithdrawalForm((current) => ({ ...current, name: event.target.value }))} required className={inputClass()} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="withdrawal-ref" className="block text-[10px] font-bold uppercase tracking-wider text-white/85">Stripe-Checkout-Referenz *</label>
                        <input id="withdrawal-ref" value={withdrawalForm.reference} onChange={(event) => setWithdrawalForm((current) => ({ ...current, reference: event.target.value }))} required className={inputClass()} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor="withdrawal-email" className="block text-[10px] font-bold uppercase tracking-wider text-white/85">Bestätigungs-E-Mail *</label>
                        <input id="withdrawal-email" type="email" value={withdrawalForm.email} onChange={(event) => setWithdrawalForm((current) => ({ ...current, email: event.target.value }))} required className={inputClass()} />
                      </div>
                      <div className="space-y-1.5">
                        <p className="block text-[10px] font-bold uppercase tracking-wider text-white/85">Widerrufserklärung</p>
                        <p className="rounded-lg border border-[#2A2A2A] bg-[#0D0D0D] p-4 text-sm text-white">{withdrawalForm.declaration}</p>
                      </div>
                      {withdrawalError && <p className="text-sm font-semibold text-red-300">{withdrawalError}</p>}
                      <button type="submit" className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-orange px-5 py-3 text-sm font-bold text-white hover:bg-[#e05621]">
                        Angaben prüfen <ArrowRight className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-4">
                      <p className="font-semibold text-white">Bitte bestätige den Widerruf.</p>
                      <div className="rounded-lg border border-[#222222] bg-[#0D0D0D] p-4 text-sm">
                        <p><strong>Name:</strong> {withdrawalForm.name}</p>
                        <p><strong>Referenz:</strong> {withdrawalForm.reference}</p>
                        <p><strong>E-Mail:</strong> {withdrawalForm.email}</p>
                        <p><strong>Erklärung:</strong> {withdrawalForm.declaration}</p>
                      </div>
                      {withdrawalError && <p className="text-sm font-semibold text-red-300">{withdrawalError}</p>}
                      <div className="flex flex-wrap gap-3">
                        <button onClick={() => setWithdrawalStep(1)} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#2A2A2A] px-5 py-3 text-sm font-bold text-white hover:border-[#444444]">
                          <Undo2 className="h-4 w-4" /> Zurück
                        </button>
                        <button onClick={submitWithdrawal} disabled={isWithdrawing} className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-orange px-5 py-3 text-sm font-bold text-white hover:bg-[#e05621] disabled:cursor-not-allowed disabled:opacity-50">
                          {isWithdrawing ? <><Loader2 className="h-4 w-4 animate-spin" /> Sende...</> : <>Widerruf bestätigen</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-[#1A1A1A] px-6 py-4">
              <button onClick={() => setActiveModal(null)} className="cursor-pointer rounded-lg bg-brand-orange px-5 py-2.5 font-bold text-white transition-colors hover:bg-[#e05621]">
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
