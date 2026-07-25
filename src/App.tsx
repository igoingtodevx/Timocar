/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Timo's Auto-Beratung — Frontend
 *
 * Stripe-Checkout-Modus wird per VITE_CHECKOUT_MODE gesteuert:
 *   - "hosted" (default)   → Top-Level-Redirect zu checkout.stripe.com
 *   - "embedded"           → Stripe-iframe inline (TikTok In-App-Browser safe)
 *
 * TikTok-Erkennung: zusätzlich zum source=URL-Parameter wird der
 * User-Agent geprüft. Der "Im Browser öffnen"-Hinweis erscheint nur
 * wenn (a) der Embedded Checkout nicht lädt oder (b) die Zahlung fehlschlägt.
 * Ein nicht-blockierender Banner zeigt den Hinweis dauerhaft klein an.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Car,
  ShieldCheck,
  Star,
  Award,
  Instagram,
  Search,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Gauge,
  Fuel,
  TrendingDown,
  AlertTriangle,
  Check,
  ArrowRight,
  Loader2,
  X,
  Lock,
  Mail,
  Sliders,
  CheckCircle,
  Menu,
  ExternalLink,
  Info,
} from "lucide-react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { PayPalProvider } from "@paypal/react-paypal-js/sdk-v6";
import { usePayPalOneTimePaymentSession } from "@paypal/react-paypal-js/sdk-v6";

// ─────────────────────────────────────────────
//  Stripe Setup
// ─────────────────────────────────────────────
const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const CHECKOUT_MODE = (import.meta.env.VITE_CHECKOUT_MODE === "embedded" ? "embedded" : "hosted") as
  | "hosted"
  | "embedded";

// PayPal (Sandbox default; set VITE_PAYPAL_ENVIRONMENT=production for live)
const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined;
const PAYPAL_ENVIRONMENT = ((import.meta.env.VITE_PAYPAL_ENVIRONMENT as string) || "sandbox")
  .toLowerCase() === "production"
  ? "production"
  : "sandbox";

// loadStripe gibt Promise<Stripe | null>. Wir halten die Promise auf
// Module-Ebene, damit sie nicht bei jedem Render neu erzeugt wird.
const stripePromise: Promise<StripeJs | null> = STRIPE_PUBLISHABLE_KEY
  ? loadStripe(STRIPE_PUBLISHABLE_KEY)
  : Promise.resolve(null);

// ─────────────────────────────────────────────
//  TikTok / In-App-Browser Detection
//  (Heuristik — keine Garantie)
// ─────────────────────────────────────────────
function isLikelyInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /TikTok|BytedanceWebview|musical_ly|FBAN|FBAV|Instagram|Line\/|MicroMessenger/i.test(ua);
}

interface CarDetail {
  name: string;
  leistung: string;
  verbrauch: string;
  wertverlust: string;
  maengel: string;
  details: string;
}

interface CheckoutFormState {
  budget: string;
  brand: string;
  bodyType: string;
  transmission: string;
  drive: string;
  notes: string;
  email: string;
}

const DEFAULT_FORM: CheckoutFormState = {
  budget: "",
  brand: "",
  bodyType: "Limousine",
  transmission: "egal",
  drive: "egal",
  notes: "",
  email: "",
};

export default function App() {
  const [carQuery, setCarQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedCar, setAnalyzedCar] = useState<CarDetail | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showAllDetails, setShowAllDetails] = useState(false);

  const [form, setForm] = useState<CheckoutFormState>(DEFAULT_FORM);
  const [formSubmitted, setFormSubmitted] = useState(
    () => new URLSearchParams(window.location.search).get("payment") === "success"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showFallbackHint, setShowFallbackHint] = useState(false);

  // Source: aus ?source=… (TikTok-Tracking)
  const [source, setSource] = useState<string>("direct");

  // Embedded Checkout State
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);

  // TikTok-In-App-Browser: wird im mount-Block berechnet, entscheidet ob PayPal separat angezeigt wird
  const [isTikTokInApp, setIsTikTokInApp] = useState<boolean>(false);

  // PayPal State
  const [paypalProcessing, setPaypalProcessing] = useState(false);
  const [paypalError, setPaypalError] = useState<string | null>(null);

  // Doppelklick-Schutz: Referenz auf laufende Request-Promise
  const inFlightCheckout = useRef<Promise<void> | null>(null);

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"home" | "ai-tool">("home");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("home");

  const bookingRef = useRef<HTMLElement | null>(null);
  const likelyInApp = useRef<boolean>(false);

  // ─── Mount: source, in-app-detection, draft-restore ───
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get("source");
    if (src) setSource(src);

    // Erfolg-Redirect: ?payment=success → formSubmitted true
    if (params.get("payment") === "success") {
      setFormSubmitted(true);
    }

    likelyInApp.current = isLikelyInAppBrowser();
    setIsTikTokInApp(likelyInApp.current);

    // Optional: Draft-Token aus URL (?draft=…) — nur für User, die im
    // TikTok-Browser auf "Im Browser öffnen" geklickt haben.
    const draftToken = params.get("draft");
    if (draftToken && /^[a-f0-9]{64}$/.test(draftToken)) {
      void loadDraft(draftToken);
    }
  }, []);

  async function loadDraft(token: string) {
    try {
      const res = await fetch(`/api/checkout-draft/${encodeURIComponent(token)}`);
      if (!res.ok) return; // silently ignore — Form bleibt leer
      const data = (await res.json()) as Partial<CheckoutFormState> & { source?: string };
      setForm((prev) => ({
        ...prev,
        budget: data.budget ?? prev.budget,
        brand: data.brand ?? prev.brand,
        bodyType: data.bodyType ?? prev.bodyType,
        transmission: data.transmission ?? prev.transmission,
        drive: data.drive ?? prev.drive,
        notes: data.notes ?? prev.notes,
        email: data.email ?? prev.email,
      }));
      if (data.source) setSource(data.source);
    } catch {
      // silently ignore
    }
  }

  useEffect(() => {
    const handler = () => setNavScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (activeView !== "home") { setActiveSection("ai-tool"); return; }
    const handler = () => {
      const bookingEl = document.getElementById("booking-section");
      const reviewsEl = document.getElementById("reviews");
      const sp = window.scrollY + window.innerHeight / 3;
      if (reviewsEl && sp >= reviewsEl.offsetTop) setActiveSection("reviews");
      else if (bookingEl && sp >= bookingEl.offsetTop) setActiveSection("booking-section");
      else setActiveSection("home");
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, [activeView]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setActiveModal(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const scrollToSection = (id: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    setIsMobileMenuOpen(false);
    if (activeView !== "home") {
      setActiveView("home");
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 100);
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }
  };

  // ─── KI-Analyse (unverändert) ───
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!carQuery.trim()) return;
    setIsAnalyzing(true); setAnalyzedCar(null); setAnalyzeError(null); setShowAllDetails(false);
    try {
      const res = await fetch("/api/analyze-car", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: carQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setAnalyzeError(data.error ?? "Unbekannter Fehler.");
      else setAnalyzedCar(data as CarDetail);
    } catch { setAnalyzeError("Verbindung zum Server fehlgeschlagen."); }
    finally { setIsAnalyzing(false); }
  };

  const runQuickAnalyze = async (quickCar: string) => {
    setCarQuery(quickCar); setIsAnalyzing(true); setAnalyzedCar(null); setAnalyzeError(null); setShowAllDetails(false);
    try {
      const res = await fetch("/api/analyze-car", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: quickCar }),
      });
      const data = await res.json();
      if (!res.ok) setAnalyzeError(data.error ?? "Fehler");
      else setAnalyzedCar(data as CarDetail);
    } catch { setAnalyzeError("Verbindung fehlgeschlagen."); }
    finally { setIsAnalyzing(false); }
  };

  // ─── startCheckout: extrahierte async Funktion (statt inline in handleFormSubmit) ───
  const startCheckout = useCallback(async (): Promise<void> => {
    if (inFlightCheckout.current) {
      // Doppelklick-Schutz: laufenden Request wiederverwenden
      return inFlightCheckout.current;
    }
    if (!form.email.trim()) return;

    setIsSubmitting(true);
    setCheckoutError(null);
    setShowFallbackHint(false);

    const promise = (async () => {
      try {
        const res = await fetch("/api/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            budget: form.budget,
            brand: form.brand,
            bodyType: form.bodyType,
            transmission: form.transmission,
            drive: form.drive,
            notes: form.notes,
            email: form.email,
            source,
            // TikTok-Browser bekommt serverseitig PayPal aus der Stripe-Session entfernt
            // (s. UA-Check in /api/create-checkout).
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCheckoutError(data.error ?? "Checkout konnte nicht gestartet werden.");
          setShowFallbackHint(true);
          return;
        }

        if (CHECKOUT_MODE === "embedded") {
          if (!data.clientSecret) {
            setCheckoutError("Server hat keinen client_secret zurückgegeben.");
            setShowFallbackHint(true);
            return;
          }
          setCheckoutSessionId(data.sessionId);
          setCheckoutClientSecret(data.clientSecret);
        } else {
          if (!data.url) {
            setCheckoutError("Server hat keine Checkout-URL zurückgegeben.");
            setShowFallbackHint(true);
            return;
          }
          // Hosted-Mode: Top-Level-Redirect
          window.location.href = data.url;
        }
      } catch {
        setCheckoutError("Verbindung fehlgeschlagen. Bitte versuche es erneut.");
        setShowFallbackHint(true);
      } finally {
        setIsSubmitting(false);
        inFlightCheckout.current = null;
      }
    })();

    inFlightCheckout.current = promise;
    return promise;
  }, [form, source]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void startCheckout();
  };

  const handleResetForm = () => {
    setForm(DEFAULT_FORM);
    setFormSubmitted(false);
    setCheckoutClientSecret(null);
    setCheckoutSessionId(null);
    setCheckoutError(null);
    setShowFallbackHint(false);
    setPaypalProcessing(false);
    setPaypalError(null);
  };

  // PayPal-Zahlung wird über die TikTokPayPalButton-Subkomponente verarbeitet
  // (siehe Datei-Ende). Diese Komponente bekommt das `form`-Objekt + `source`
  // als Props und macht createOrder / captureOrder serverseitig.

  // ─── Embedded Checkout: onComplete → formSubmitted ───
  const handleEmbeddedComplete = useCallback(() => {
    setFormSubmitted(true);
    setCheckoutClientSecret(null);
  }, []);

  // Fallback-Link: User kann aus dem In-App-Browser in den echten Browser wechseln
  // Wir legen einen Draft an und schicken User auf timocar.de/?draft=<token>
  const handleOpenInExternalBrowser = useCallback(async () => {
    if (!form.email.trim()) {
      setCheckoutError("Bitte zuerst E-Mail ausfüllen, damit wir die Daten übertragen können.");
      return;
    }
    try {
      const res = await fetch("/api/checkout-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source }),
      });
      if (!res.ok) {
        setCheckoutError("Konnte Daten nicht für Browser-Wechsel vorbereiten.");
        return;
      }
      const { token } = (await res.json()) as { token: string };
      const target = `${window.location.origin}/?draft=${token}&source=${encodeURIComponent(source)}`;
      // Versuche, in externen Browser zu öffnen via intent-URL (Android)
      // Auf iOS gibt es keinen universellen Trick — wir zeigen den Link an,
      // den User manuell antippen muss.
      const intent = `intent://${target.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
      if (/android/i.test(navigator.userAgent)) {
        window.location.href = intent;
      } else {
        // iOS / Desktop: zeige URL zum manuellen Kopieren
        navigator.clipboard?.writeText(target).catch(() => {});
        setCheckoutError(`Link zum Fortfahren wurde in die Zwischenablage kopiert: ${target}`);
      }
    } catch {
      setCheckoutError("Verbindung fehlgeschlagen.");
    }
  }, [form, source]);

  const navLinks: { label: string; section: string; action: (e?: React.MouseEvent) => void }[] = [
    { label: "Startseite", section: "home", action: () => { setActiveView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { label: "KI-Fahrzeugsuche", section: "ai-tool", action: () => { setActiveView("ai-tool"); window.scrollTo({ top: 0, behavior: "smooth" }); } },
    { label: "Beratung", section: "booking-section", action: (e) => scrollToSection("booking-section", e) },
    { label: "Bewertungen", section: "reviews", action: (e) => scrollToSection("reviews", e) },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#0D0D0D] font-sans text-zinc-400">

      {/* ─── TOP NAV ─── */}
      <header className={`fixed top-0 left-0 right-0 z-30 h-16 transition-all duration-300 ${navScrolled ? "bg-[#0D0D0D]/95 backdrop-blur-md border-b border-[#1A1A1A]" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 h-full flex items-center justify-between">

          <button onClick={() => { setActiveView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="flex items-center gap-2.5 cursor-pointer group">
            <div className="w-8 h-8 bg-brand-orange rounded-md flex items-center justify-center group-hover:bg-[#e05621] transition-colors shrink-0">
              <Car className="w-4 h-4 text-white" />
            </div>
            <div className="leading-none">
              <span className="font-display font-black text-white text-sm tracking-tight uppercase block">Timo's</span>
              <span className="text-brand-orange text-[9px] font-bold tracking-[0.2em] uppercase block">Auto-Beratung</span>
            </div>
          </button>

          <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold">
            {navLinks.map(({ label, action, section }) => (
              <button key={label} onClick={() => action()} className={`transition-colors cursor-pointer ${activeSection === section ? "text-white" : "text-zinc-500 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </nav>

          <button onClick={(e) => scrollToSection("booking-section", e)} className="hidden lg:inline-flex items-center gap-2 px-4 py-2 bg-brand-orange text-white text-sm font-bold rounded-lg hover:bg-[#e05621] transition-colors cursor-pointer">
            49 € buchen <ArrowRight className="w-4 h-4" />
          </button>

          <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden p-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer" aria-label="Menü öffnen">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* ─── MOBILE DRAWER ─── */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-[#0D0D0D] flex flex-col">
          <div className="flex items-center justify-between px-6 h-16 border-b border-[#1A1A1A] shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-brand-orange rounded-md flex items-center justify-center"><Car className="w-4 h-4 text-white" /></div>
              <span className="font-display font-black text-white text-sm tracking-tight uppercase">Timo's Auto-Beratung</span>
            </div>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 text-zinc-400 hover:text-white cursor-pointer" aria-label="Schließen"><X className="w-6 h-6" /></button>
          </div>
          <nav className="flex flex-col flex-grow px-6 pt-4 overflow-y-auto">
            {navLinks.map(({ label, action }) => (
              <button key={label} onClick={() => { action(); setIsMobileMenuOpen(false); }} className="w-full text-left py-5 text-2xl font-black text-white border-b border-[#1A1A1A] hover:text-brand-orange transition-colors cursor-pointer last:border-0">
                {label}
              </button>
            ))}
          </nav>
          <div className="p-6 border-t border-[#1A1A1A] shrink-0">
            <button onClick={(e) => { scrollToSection("booking-section", e); setIsMobileMenuOpen(false); }} className="w-full py-4 bg-brand-orange text-white text-base font-bold rounded-lg hover:bg-[#e05621] transition-colors flex items-center justify-center gap-2 cursor-pointer">
              49 € Beratung buchen <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ─── MAIN ─── */}
      <main className="flex-grow pt-16">

        {activeView === "home" ? (
          <>
            {/* ── HERO ── */}
            <section id="home" className="min-h-[calc(100vh-64px)] flex flex-col hero-dot-grid">
              <div className="flex-grow max-w-7xl mx-auto w-full px-6 md:px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center py-20 md:py-28">

                {/* Headline */}
                <div className="lg:col-span-7 space-y-8">
                  <p className="text-[10px] font-bold text-brand-orange uppercase tracking-[0.35em]">Herstellerunabhängige Beratung</p>

                  <h1 className="font-display font-black leading-[0.88] tracking-tight">
                    <span className="block text-6xl md:text-7xl lg:text-[84px] text-white">Finde dein</span>
                    <span className="block text-6xl md:text-7xl lg:text-[84px] text-brand-orange italic">PERFEKTES</span>
                    <span className="block text-6xl md:text-7xl lg:text-[84px] text-white">Auto.</span>
                  </h1>

                  <p className="text-zinc-400 text-base md:text-lg leading-relaxed max-w-lg">
                    Du weißt nicht welches Auto zu dir passt — oder willst keinen Fehlkauf riskieren? Kein Bullshit, kein Autohaus-Druck. Nur eine ehrliche Empfehlung von jemandem, der täglich Autos analysiert.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button onClick={(e) => scrollToSection("booking-section", e)} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-brand-orange text-white text-sm font-bold rounded-lg hover:bg-[#e05621] transition-colors cursor-pointer">
                      Beratung für 49 € buchen <ArrowRight className="w-4 h-4" />
                    </button>
                    <button onClick={() => { setActiveView("ai-tool"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="inline-flex items-center justify-center gap-2 px-6 py-3.5 border border-[#2A2A2A] text-zinc-300 text-sm font-bold rounded-lg hover:border-[#444444] hover:text-white transition-colors cursor-pointer">
                      KI-Fahrzeugcheck <ArrowRight className="w-4 h-4 text-zinc-600" />
                    </button>
                  </div>
                </div>

                {/* Pricing Card */}
                <div className="lg:col-span-5">
                  <div className="bg-[#111111] border border-[#222222] rounded-xl p-7 space-y-6">
                    <div>
                      <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-[0.3em] block mb-2">Dienstleistung</span>
                      <h2 className="font-display text-2xl font-extrabold text-white leading-snug">Auto-Beratung<br />Premium</h2>
                    </div>

                    <div className="border-t border-[#1A1A1A] pt-5 flex items-baseline gap-2.5">
                      <span className="font-display font-black text-5xl text-white tracking-tight">49 €</span>
                      <span className="text-xs text-zinc-600 font-semibold uppercase tracking-wider">einmalig, inkl. MwSt.</span>
                    </div>

                    <div className="border-t border-[#1A1A1A] pt-5 space-y-4">
                      {[
                        { n: "01", t: "Recherche & Kriterien", d: "Budget, Wünsche und Alltag — gezielt passende Fahrzeuge." },
                        { n: "02", t: "3 Empfehlungen mit Links", d: "Handgeprüfte Inserate mit direkten Links auf dem Markt." },
                        { n: "03", t: "Risiko-Check inklusive", d: "Schwachstellen, Wertverlust und worauf du achten musst." },
                      ].map(({ n, t, d }) => (
                        <div key={n} className="flex gap-3.5">
                          <span className="text-[11px] font-black text-brand-orange/50 font-display shrink-0 mt-0.5 w-5">{n}</span>
                          <div>
                            <p className="text-xs font-bold text-white uppercase tracking-wide">{t}</p>
                            <p className="text-xs text-zinc-600 leading-relaxed mt-0.5">{d}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button onClick={(e) => scrollToSection("booking-section", e)} className="w-full py-3.5 bg-brand-orange text-white text-sm font-bold rounded-lg hover:bg-[#e05621] transition-colors flex items-center justify-center gap-2 cursor-pointer">
                      Jetzt buchen <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="flex items-center justify-between text-[10px] text-zinc-600 uppercase tracking-wider">
                      <span className="text-brand-orange font-bold">★ 4.8/5 Zufriedenheit</span>
                      <span className="text-white font-bold">100% Geld-zurück</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* Trust bar */}
              <div className="border-t border-[#1A1A1A]">
                <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-4 flex flex-wrap items-center gap-3 md:gap-6 text-[10px] font-bold text-zinc-700 uppercase tracking-[0.2em]">
                  <span>Markenneutral</span><span className="text-[#1E1E1E]">—</span>
                  <span>Finanziell unabhängig</span><span className="text-[#1E1E1E]">—</span>
                  <span>Geprüfte Qualität</span><span className="text-[#1E1E1E]">—</span>
                  <span>48h Lieferzeit</span><span className="text-[#1E1E1E]">—</span>
                  <span className="text-zinc-500 font-semibold">★ 4.8/5 · 148 Bewertungen</span>
                </div>
              </div>
            </section>

            {/* ── ABOUT ── */}
            <section id="about-me" className="border-t border-[#1A1A1A] py-24 md:py-32 scroll-mt-16">
              <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">

                <div className="lg:col-span-7 space-y-8">
                  <div>
                    <span className="text-[10px] font-bold text-brand-orange uppercase tracking-[0.3em] block mb-4">Der Typ dahinter</span>
                    <h2 className="font-display font-black text-4xl md:text-5xl text-white leading-tight">Hey, ich bin<br />Timo.</h2>
                  </div>

                  <div className="space-y-5 text-zinc-400 leading-relaxed">
                    <p>Ich mache auf TikTok Content rund ums Thema Geldverdienen, Business und — natürlich — Autos. Mit über <strong className="text-white">400.000 Followern</strong> und <strong className="text-white">6 Millionen Likes</strong> hat sich eine Community aufgebaut, die eine Meinung schätzt, die nicht von einem Autohaus bezahlt wird.</p>
                    <p>Was mich nervt: Autohäuser verdienen an deiner Unwissenheit. Ich kenne die Tricks, die Preisverhandlungs-Spielchen und die typischen Schwachstellen der beliebtesten Modelle — und ich teile das offen.</p>
                    <p>Du gibst mir deine Kriterien, ich liefere dir in 48 Stunden 3 ehrliche, handgeprüfte Empfehlungen — ohne versteckte Interessen.</p>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-1">
                    <a href="https://tiktok.com/@yotimoo1" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#111111] border border-[#222222] rounded-lg text-sm font-bold text-white hover:border-[#3A3A3A] hover:text-brand-orange transition-colors">
                      <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.63 4.15 1.02.99 2.44 1.5 3.86 1.59v3.86a9.14 9.14 0 0 1-5.23-1.61v7.62c0 3.66-2.58 6.84-6.17 7.37-4.02.6-7.8-2.1-8.38-6.12-.58-4.02 2.12-7.8 6.13-8.38 1.05-.15 2.12-.04 3.12.32V0zm-3.9 11.23c-2.31-.05-4.28 1.74-4.4 4.05-.12 2.31 1.65 4.31 3.96 4.43 2.31.12 4.31-1.65 4.43-3.96v-.32H11.2c-.08 1.4-1.27 2.47-2.67 2.39-1.4-.08-2.47-1.27-2.39-2.67.08-1.4 1.27-2.47 2.67-2.39v-1.53z"/>
                      </svg>
                      TikTok · 400k+
                    </a>
                    <a href="https://instagram.com/yotimoo1" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#111111] border border-[#222222] rounded-lg text-sm font-bold text-white hover:border-[#3A3A3A] hover:text-brand-orange transition-colors">
                      <Instagram className="w-4 h-4 shrink-0" />
                      Instagram · @yotimoo1
                    </a>
                    <a href="https://enricha.de/products/tiktok-anleitung-2025" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#111111] border border-[#222222] rounded-lg text-sm font-bold text-white hover:border-[#3A3A3A] hover:text-brand-orange transition-colors">
                      <Award className="w-4 h-4 text-brand-orange shrink-0" />
                      Enricha · TikTok Kurs
                    </a>
                  </div>
                </div>

                {/* Stats panel */}
                <div className="lg:col-span-5">
                  <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
                    {[
                      { value: "400K", label: "TikTok-Follower", sub: "@yotimoo1" },
                      { value: "6M", label: "Likes", sub: "auf TikTok" },
                      { value: "BMW M4", label: "Persönliches Ziel", sub: "Dream Build" },
                      { value: "48h", label: "Lieferzeit", sub: "garantiert" },
                    ].map(({ value, label, sub }, i, arr) => (
                      <div key={label} className={`px-8 py-6 ${i < arr.length - 1 ? "border-b border-[#1A1A1A]" : ""}`}>
                        <div className="font-display font-black text-3xl md:text-4xl text-white">{value}</div>
                        <div className="text-sm font-semibold text-zinc-300 mt-1">{label}</div>
                        <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </section>

            {/* ── BOOKING ── */}
            <section id="booking-section" ref={bookingRef} className="border-t border-[#1A1A1A] py-24 md:py-32 scroll-mt-16">
              <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12">
                <div className="max-w-3xl mx-auto">

                  <div className="mb-12">
                    <span className="text-[10px] font-bold text-brand-orange uppercase tracking-[0.3em] block mb-4">Bestellformular</span>
                    <h2 className="font-display font-black text-4xl md:text-5xl text-white leading-tight">Auto-Beratung<br />buchen.</h2>
                    <p className="text-zinc-400 mt-4 leading-relaxed max-w-lg">Du füllst das Formular aus, ich recherchiere den Markt. <strong className="text-white">3 konkrete Fahrzeug-Empfehlungen</strong> per E-Mail innerhalb von 48 Stunden.</p>
                  </div>

                  <div className="bg-[#111111] border border-[#222222] rounded-xl overflow-hidden">
                    <div className="border-b border-[#1A1A1A] px-6 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-brand-orange" />
                        <span className="text-sm font-bold text-white">
                          Sicherer Checkout · Stripe {CHECKOUT_MODE === "embedded" ? "(inline)" : ""}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-zinc-600 uppercase tracking-wider">DSGVO-Konform</span>
                    </div>

                    {formSubmitted ? (
                      <div className="p-8 md:p-12 text-center space-y-6">
                        <div className="w-14 h-14 bg-emerald-950/40 border border-emerald-900/50 rounded-xl flex items-center justify-center mx-auto">
                          <Check className="w-7 h-7 text-emerald-400 stroke-[2.5]" />
                        </div>
                        <div>
                          <h4 className="text-xl font-black text-white font-display">Anfrage eingegangen!</h4>
                          <p className="text-zinc-400 mt-2 text-sm">Bestätigung an <strong className="text-white">{form.email}</strong> gesendet.</p>
                        </div>
                        <div className="bg-[#0D0D0D] border border-[#1A1A1A] rounded-lg p-5 text-left space-y-3 max-w-md mx-auto">
                          <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-[#1A1A1A]">
                            <Sliders className="w-3.5 h-3.5 text-brand-orange" /> Übermittelte Kriterien
                          </h5>
                          <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-zinc-500">
                            <span>Budget: <strong className="text-white">{form.budget ? `${form.budget} €` : "—"}</strong></span>
                            <span>Marke: <strong className="text-white">{form.brand || "Egal"}</strong></span>
                            <span>Karosserie: <strong className="text-white">{form.bodyType}</strong></span>
                            <span>Getriebe: <strong className="text-white">{form.transmission}</strong></span>
                            <span>Antrieb: <strong className="text-white">{form.drive}</strong></span>
                            <span>E-Mail: <strong className="text-white">{form.email}</strong></span>
                          </div>
                          {form.notes && <p className="text-xs text-zinc-600 italic pt-2 border-t border-[#1A1A1A]">"{form.notes}"</p>}
                        </div>
                        <p className="text-xs text-zinc-600 max-w-xs mx-auto">Timo prüft deine Anfrage persönlich und sendet dir innerhalb von 48 Stunden 3 Vorschläge.</p>
                        <button onClick={handleResetForm} className="px-5 py-2.5 bg-[#1A1A1A] border border-[#2A2A2A] text-white text-sm font-bold rounded-lg hover:border-[#3A3A3A] transition-colors cursor-pointer">
                          Neue Anfrage
                        </button>
                      </div>
                    ) : checkoutClientSecret && CHECKOUT_MODE === "embedded" ? (
                      // ─── EMBEDDED CHECKOUT (Stripe) ───
                      <div className="p-4 md:p-6">
                        {!STRIPE_PUBLISHABLE_KEY && (
                          <div className="mb-4 p-3 bg-red-950/20 border border-red-900/50 rounded-lg flex items-start gap-2.5 text-red-400 text-xs">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>VITE_STRIPE_PUBLISHABLE_KEY fehlt. In Vercel unter Environment Variables setzen.</span>
                          </div>
                        )}
                        {STRIPE_PUBLISHABLE_KEY && stripePromise && (
                          <EmbeddedCheckoutProvider
                            key={checkoutSessionId ?? "checkout"}
                            stripe={stripePromise}
                            options={{
                              clientSecret: checkoutClientSecret,
                              onComplete: handleEmbeddedComplete,
                            }}
                          >
                            <div className="bg-white rounded-lg overflow-hidden min-h-[500px]">
                              <EmbeddedCheckout />
                            </div>
                          </EmbeddedCheckoutProvider>
                        )}

                        {/* TikTok-In-App-Browser: separater PayPal-v6-Button (presentationMode: "modal") */}
                        {isTikTokInApp && PAYPAL_CLIENT_ID && (
                          <div className="mt-6 pt-6 border-t border-[#1A1A1A]">
                            <p className="text-xs text-zinc-500 mb-3 text-center">
                              Oder mit PayPal bezahlen (im TikTok-Browser als Modal):
                            </p>
                            <PayPalProvider
                              clientId={PAYPAL_CLIENT_ID}
                              environment={PAYPAL_ENVIRONMENT}
                              components={["paypal-payments"]}
                              pageType="checkout"
                            >
                              <TikTokPayPalButton
                                form={form}
                                source={source}
                                disabled={paypalProcessing || !form.email.trim()}
                                onError={setPaypalError}
                                onSuccess={() => setFormSubmitted(true)}
                                onProcessingChange={setPaypalProcessing}
                              />
                            </PayPalProvider>
                            {paypalError && (
                              <p className="mt-2 text-xs text-red-400 text-center">{paypalError}</p>
                            )}
                          </div>
                        )}

                        <button
                          onClick={() => { setCheckoutClientSecret(null); setCheckoutSessionId(null); setCheckoutError(null); setPaypalError(null); }}
                          className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5" /> Formular zurücksetzen
                        </button>
                      </div>
                    ) : (
                      // ─── FORMULAR (oder hosted-mode pre-submit) ───
                      <form onSubmit={handleFormSubmit} className="p-6 md:p-8 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="space-y-1.5">
                            <label htmlFor="budget-input" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Budget (€)</label>
                            <div className="relative">
                              <input id="budget-input" type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="z. B. 25000"
                                className="w-full px-4 py-3 bg-[#0D0D0D] border border-[#222222] rounded-lg text-white placeholder-zinc-700 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-orange focus:border-brand-orange transition-all" />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-700 text-sm">€</span>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label htmlFor="brand-input" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Wunschmarke</label>
                            <input id="brand-input" type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="BMW, Audi, Egal..."
                              className="w-full px-4 py-3 bg-[#0D0D0D] border border-[#222222] rounded-lg text-white placeholder-zinc-700 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-orange focus:border-brand-orange transition-all" />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="body-type" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Karosserietyp</label>
                          <select id="body-type" value={form.bodyType} onChange={(e) => setForm({ ...form, bodyType: e.target.value })}
                            className="w-full px-4 py-3 bg-[#0D0D0D] border border-[#222222] rounded-lg text-white text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-orange focus:border-brand-orange transition-all cursor-pointer">
                            {["Kleinwagen","Limousine","SUV","Kombi","Coupé","Cabrio","Van"].map(o => <option key={o} value={o} className="bg-[#0D0D0D]">{o}</option>)}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Getriebe</span>
                          <div className="grid grid-cols-3 gap-2">
                            {["Schaltgetriebe","Automatik","egal"].map(o => (
                              <label key={o} className={`border rounded-lg p-3 flex items-center justify-center text-sm font-bold cursor-pointer transition-all select-none ${form.transmission === o ? "border-brand-orange bg-brand-orange/10 text-brand-orange" : "border-[#222222] bg-[#0D0D0D] text-zinc-600 hover:border-[#333333] hover:text-zinc-300"}`}>
                                <input type="radio" name="transmission" value={o} checked={form.transmission === o} onChange={() => setForm({ ...form, transmission: o })} className="sr-only" />
                                <span className="capitalize">{o}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Antrieb</span>
                          <div className="grid grid-cols-4 gap-2">
                            {["Frontantrieb","Heckantrieb","Allrad","egal"].map(o => (
                              <label key={o} className={`border rounded-lg py-3 px-1 flex items-center justify-center text-xs font-bold cursor-pointer transition-all select-none ${form.drive === o ? "border-brand-orange bg-brand-orange/10 text-brand-orange" : "border-[#222222] bg-[#0D0D0D] text-zinc-600 hover:border-[#333333] hover:text-zinc-300"}`}>
                                <input type="radio" name="drive" value={o} checked={form.drive === o} onChange={() => setForm({ ...form, drive: o })} className="sr-only" />
                                <span className="capitalize text-center">{o}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="notes-textarea" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Weitere Wünsche</label>
                          <textarea id="notes-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="z. B. Mindestens 4 Türen, Panoramadach, Langstrecke..." rows={3}
                            className="w-full px-4 py-3 bg-[#0D0D0D] border border-[#222222] rounded-lg text-white placeholder-zinc-700 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-orange focus:border-brand-orange transition-all resize-none" />
                        </div>

                        <div className="space-y-1.5">
                          <label htmlFor="email-input" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">E-Mail <span className="text-brand-orange">*</span></label>
                          <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-700" />
                            <input id="email-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="deine.email@beispiel.de"
                              className="w-full pl-11 pr-4 py-3 bg-[#0D0D0D] border border-[#222222] rounded-lg text-white placeholder-zinc-700 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-orange focus:border-brand-orange transition-all" />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-zinc-700">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          <span>Verschlüsselt übertragen · Nur zur Erstellung der Empfehlung verwendet</span>
                        </div>

                        {/* Nicht-blockierender TikTok-Hinweis (nur sichtbar wenn Heuristik zutrifft) */}
                        {likelyInApp.current && (
                          <div className="flex items-start gap-2.5 p-3 bg-zinc-900/40 border border-zinc-800/50 rounded-lg text-zinc-500 text-xs">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-zinc-600" />
                            <span>
                              Du bist im In-App-Browser. Die Zahlung funktioniert, aber für ein reibungsloses Erlebnis empfehlen wir{" "}
                              <button
                                type="button"
                                onClick={handleOpenInExternalBrowser}
                                className="underline hover:text-zinc-300 cursor-pointer"
                              >
                                im normalen Browser öffnen
                              </button>
                              .
                            </span>
                          </div>
                        )}

                        {checkoutError && (
                          <div className="space-y-3">
                            <div className="flex items-start gap-2.5 p-3.5 bg-red-950/20 border border-red-900/50 rounded-lg text-red-400 text-xs">
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>{checkoutError}</span>
                            </div>
                            {showFallbackHint && (
                              <button
                                type="button"
                                onClick={handleOpenInExternalBrowser}
                                className="w-full py-2.5 border border-amber-700/50 bg-amber-950/20 text-amber-200 text-xs font-bold rounded-lg hover:bg-amber-950/40 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Im normalen Browser fortsetzen
                              </button>
                            )}
                          </div>
                        )}

                        <button type="submit" disabled={isSubmitting || !form.email.trim()}
                          className="w-full py-4 bg-brand-orange text-white font-bold rounded-lg hover:bg-[#e05621] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-base cursor-pointer">
                          {isSubmitting
                            ? <><Loader2 className="w-5 h-5 animate-spin" /><span>Wird vorbereitet…</span></>
                            : <><span>49 € zahlen & Beratung anfragen</span><ArrowRight className="w-5 h-5" /></>}
                        </button>

                        <p className="text-center text-xs text-zinc-700">Du erhältst innerhalb von 48 Stunden 3 Auto-Vorschläge per E-Mail</p>
                      </form>
                    )}
                  </div>

                </div>
              </div>
            </section>

            {/* ── REVIEWS ── */}
            <section id="reviews" className="border-t border-[#1A1A1A] py-24 md:py-32 scroll-mt-16">
              <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12">

                <div className="mb-14">
                  <span className="text-[10px] font-bold text-brand-orange uppercase tracking-[0.3em] block mb-4">Erfahrungsberichte</span>
                  <h2 className="font-display font-black text-4xl md:text-5xl text-white leading-tight">Kunden&shy;bewertungen.</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {[
                    { title: "Endlich keine Angst mehr vor dem Kauf", text: "Ich hab Timo auf TikTok verfolgt und dann einfach mal die Beratung gebucht. Innerhalb von 24 Stunden hatte ich 3 konkrete Vorschläge mit allem was ich wissen muss. Bin jetzt glücklicher Besitzer eines VW Golf R — und hab dabei noch 1.500 Euro gespart.", name: "Mika S.", time: "vor 2 Wochen" },
                    { title: "Hat mir echt Nerven gespart", text: "Ich hatte null Plan welches Auto ich nehmen soll und wollte nicht einfach irgendwas kaufen. Die Empfehlung kam schnell, war super verständlich erklärt und Timo hat genau gewusst worauf ich achten muss. Jetzt fahre ich einen BMW 3er und bereue nichts.", name: "Lena K.", time: "vor 1 Monat" },
                    { title: "49€ die sich mehr als gelohnt haben", text: "Timos TikToks kenn ich schon lange, aber die Beratung hat nochmal einen draufgesetzt. Er hat mir direkt gesagt welches der drei Autos er selbst nehmen würde und warum. Das ist genau das was man braucht wenn man unsicher ist. Absolute Empfehlung!", name: "Jonas W.", time: "vor 3 Wochen" },
                  ].map(({ title, text, name, time }) => (
                    <div key={name} className="bg-[#111111] border border-[#222222] rounded-xl p-7 flex flex-col hover:border-[#333333] transition-colors">
                      <div className="flex text-brand-orange mb-5">
                        {[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}
                      </div>
                      <blockquote className="flex-grow space-y-2">
                        <p className="font-bold text-white text-sm">{title}</p>
                        <p className="text-zinc-500 text-sm leading-relaxed">"{text}"</p>
                      </blockquote>
                      <div className="mt-6 pt-5 border-t border-[#1A1A1A] flex justify-between items-center">
                        <span className="font-bold text-white text-sm">{name}</span>
                        <span className="text-xs text-zinc-700">{time}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-10 flex items-center gap-3">
                  <span className="font-display font-black text-2xl text-white">4.8</span>
                  <div className="flex text-amber-500">{[...Array(5)].map((_, i) => <Star key={i} className="w-4 h-4 fill-current" />)}</div>
                  <span className="text-zinc-600 text-sm">· 148 Bewertungen in Deutschland</span>
                </div>

              </div>
            </section>
          </>
        ) : (
          /* ── KI-TOOL ── */
          <section id="ai-tool" className="py-16 md:py-24 scroll-mt-16 min-h-[calc(100vh-64px)]">
            <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12">

              <div className="mb-10">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#111111] border border-[#222222] rounded-full text-brand-orange text-xs font-bold uppercase tracking-wider mb-4">
                  <Sparkles className="w-3.5 h-3.5" /> Automatisierter Vor-Check
                </div>
                <h2 className="font-display font-black text-4xl md:text-5xl text-white leading-tight">KI-Fahrzeug&shy;analyse.</h2>
                <p className="text-zinc-500 mt-3 max-w-lg leading-relaxed text-sm">Gib ein Automodell ein und erhalte sofort Infos zu Leistung, Verbrauch, Wertverlust und bekannten Schwachstellen.</p>
              </div>

              <div className="bg-[#111111] border border-[#222222] rounded-xl p-6 md:p-8 max-w-3xl">
                <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-grow">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-700" />
                    <input type="text" value={carQuery} onChange={(e) => setCarQuery(e.target.value)} placeholder="z. B. Mercedes C63 AMG"
                      className="w-full pl-11 pr-4 py-3.5 bg-[#0D0D0D] border border-[#222222] rounded-lg text-white placeholder-zinc-700 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-brand-orange focus:border-brand-orange transition-all" />
                  </div>
                  <button type="submit" disabled={isAnalyzing || !carQuery.trim()}
                    className="px-6 py-3.5 bg-brand-orange text-white font-bold rounded-lg hover:bg-[#e05621] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm cursor-pointer">
                    {isAnalyzing ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Analysiere...</span></> : <><span>Analysieren</span><ArrowRight className="w-4 h-4" /></>}
                  </button>
                </form>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-zinc-600">Häufig gesucht:</span>
                  {["Golf GTI","BMW M3","Mercedes C63 AMG","Audi RS6","Porsche 911"].map(qc => (
                    <button key={qc} type="button" onClick={() => runQuickAnalyze(qc)}
                      className="px-2.5 py-1 bg-[#0D0D0D] border border-[#1E1E1E] rounded-md hover:border-[#333333] hover:text-zinc-300 text-zinc-600 transition-colors cursor-pointer font-medium">
                      {qc}
                    </button>
                  ))}
                </div>

                {isAnalyzing && (
                  <div className="mt-8 py-10 flex flex-col items-center gap-3 border-t border-[#1A1A1A]">
                    <Loader2 className="w-8 h-8 text-brand-orange animate-spin" />
                    <div className="text-center">
                      <p className="font-bold text-zinc-200 text-sm">KI analysiert Fahrzeugdaten...</p>
                      <p className="text-xs text-zinc-600 mt-1">Quellen: ADAC, Auto Bild, Hersteller</p>
                    </div>
                  </div>
                )}

                {analyzeError && !isAnalyzing && (
                  <div className="mt-5 p-4 bg-red-950/20 border border-red-900/50 rounded-lg flex items-start gap-3 text-red-400">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-sm">Analyse fehlgeschlagen</p>
                      <p className="text-xs mt-1 opacity-80">{analyzeError}</p>
                    </div>
                  </div>
                )}

                {analyzedCar && !isAnalyzing && (
                  <div className="mt-8 pt-6 border-t border-[#1A1A1A] space-y-5">
                    <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
                      <div>
                        <span className="text-[10px] text-brand-orange font-bold uppercase tracking-widest block mb-1">Analyse-Ergebnis</span>
                        <h3 className="text-xl font-black text-white font-display flex items-center gap-2">
                          <Car className="w-5 h-5 text-brand-orange shrink-0" />{analyzedCar.name}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-950/40 text-emerald-400 border border-emerald-900/50 rounded-full text-xs font-bold shrink-0">
                        <CheckCircle className="w-3.5 h-3.5" /> Ausgewertet
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: "Leistung (PS)", value: analyzedCar.leistung, icon: <Gauge className="w-4 h-4 text-brand-orange" /> },
                        { label: "Verbrauch", value: analyzedCar.verbrauch, icon: <Fuel className="w-4 h-4 text-brand-orange" /> },
                        { label: "Wertverlust", value: analyzedCar.wertverlust, icon: <TrendingDown className="w-4 h-4 text-brand-orange" /> },
                        { label: "Bekannte Mängel", value: analyzedCar.maengel.split(",")[0], icon: <AlertTriangle className="w-4 h-4 text-brand-orange" /> },
                      ].map(({ label, value, icon }) => (
                        <div key={label} className="bg-[#0D0D0D] border border-[#1E1E1E] rounded-lg p-4 hover:border-[#2A2A2A] transition-colors">
                          <div className="flex items-center justify-between mb-2.5">
                            {icon}
                            <span className="text-[9px] text-zinc-700 uppercase tracking-wider font-bold text-right">{label}</span>
                          </div>
                          <p className="text-sm font-bold text-white leading-snug">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="bg-[#0D0D0D] border border-[#1E1E1E] rounded-lg overflow-hidden">
                      <button type="button" onClick={() => setShowAllDetails(!showAllDetails)}
                        className="w-full px-5 py-3.5 flex items-center justify-between text-sm font-bold text-white hover:bg-[#111111] transition-colors cursor-pointer select-none">
                        <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-brand-orange" />Ausführlicher KI-Checkbericht</span>
                        {showAllDetails ? <ChevronUp className="w-4 h-4 text-brand-orange" /> : <ChevronDown className="w-4 h-4 text-brand-orange" />}
                      </button>
                      {showAllDetails && (
                        <div className="px-5 pb-5 pt-3 border-t border-[#1A1A1A] space-y-4">
                          <p className="text-sm text-zinc-400 leading-relaxed">{analyzedCar.details}</p>
                          <div className="p-4 bg-brand-orange/5 border border-brand-orange/10 rounded-lg">
                            <h4 className="font-bold text-white text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-brand-orange" /> Schwachstellen im Detail:
                            </h4>
                            <p className="text-xs text-zinc-300 leading-relaxed">{analyzedCar.maengel}</p>
                          </div>
                          <p className="text-xs text-zinc-700 italic">Hinweis: Diese Voranalyse basiert auf statistischen Daten. Jedes gebrauchte Fahrzeug muss vor Ort begutachtet werden.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* CTA under AI tool */}
              <div className="mt-10 max-w-3xl bg-[#111111] border border-[#222222] rounded-xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
                <div>
                  <h3 className="text-lg font-black text-white font-display">Brauchst du persönliche Hilfe?</h3>
                  <p className="text-zinc-500 text-sm mt-1">3 handgeprüfte Inserate — maßgeschneidert für dein Budget.</p>
                </div>
                <button onClick={(e) => scrollToSection("booking-section", e)}
                  className="px-5 py-3 bg-brand-orange text-white text-sm font-bold rounded-lg hover:bg-[#e05621] transition-colors shrink-0 flex items-center gap-2 cursor-pointer">
                  Zur Beratung <ArrowRight className="w-4 h-4" />
                </button>
              </div>

            </div>
          </section>
        )}

      </main>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-[#1A1A1A] py-10 mt-auto">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 flex flex-col md:flex-row justify-between items-center gap-5 text-xs text-zinc-600">
          <div className="text-center md:text-left space-y-0.5">
            <p className="font-black text-white text-sm uppercase tracking-wide font-display">Timo's Auto-Beratung</p>
            <p>© 2026 YoTimo Auto-Beratung. Alle Rechte vorbehalten.</p>
          </div>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 font-medium">
            {[["impressum","Impressum"],["widerruf","Widerrufsbelehrung"],["agb","AGB"],["datenschutz","Datenschutz"]].map(([key,label]) => (
              <button key={key} onClick={() => setActiveModal(key)} className="hover:text-white transition-colors cursor-pointer">{label}</button>
            ))}
          </nav>
        </div>
      </footer>

      {/* ─── LEGAL MODALS ─── */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#111111] border border-[#222222] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl relative">
            <div className="sticky top-0 bg-[#111111] border-b border-[#1A1A1A] px-6 py-4 flex items-center justify-between z-10">
              <h4 className="text-base font-black text-white uppercase tracking-wide font-display">
                {activeModal === "impressum" && "Impressum"}
                {activeModal === "widerruf" && "Widerrufsbelehrung"}
                {activeModal === "agb" && "Allgemeine Geschäftsbedingungen"}
                {activeModal === "datenschutz" && "Datenschutzerklärung"}
              </h4>
              <button onClick={() => setActiveModal(null)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer" aria-label="Schließen">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 md:p-8 text-sm text-zinc-400 space-y-4 leading-relaxed">
              {activeModal === "impressum" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">Angaben gemäß § 5 TMG:</p>
                  <p>
                    YoTimo Auto-Beratung<br />
                    {/* TODO: Echte Adresse eintragen */}
                    <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: Straße und Hausnummer]</span><br />
                    <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: PLZ und Ort]</span>
                  </p>
                  <p>
                    <strong className="text-white">Kontakt:</strong><br />
                    E-Mail: <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: E-Mail-Adresse]</span>
                  </p>
                  <p>
                    <strong className="text-white">Umsatzsteuer-ID:</strong><br />
                    <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: USt-IdNr. falls vorhanden]</span>
                  </p>
                  <p>
                    <strong className="text-white">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV:</strong><br />
                    <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: Name und Anschrift]</span>
                  </p>
                </div>
              )}

              {activeModal === "widerruf" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">Widerrufsbelehrung</p>
                  <p>Verbraucher haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.</p>
                  <p>Um Ihr Widerrufsrecht auszuüben, müssen Sie uns ([TODO: E-Mail]) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren.</p>
                  <p><strong className="text-white">Folgen des Widerrufs:</strong> Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich zurückzuzahlen.</p>
                </div>
              )}

              {activeModal === "agb" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">§1 Geltungsbereich</p>
                  <p>Diese AGB gelten für alle Verträge zwischen YoTimo Auto-Beratung und dem Kunden über die Erbringung von Auto-Beratungsdienstleistungen.</p>

                  <p className="font-bold text-white">§2 Leistungen</p>
                  <p>Der Anbieter erbringt individuelle Auto-Beratungsdienstleistungen auf Basis der vom Kunden gemachten Angaben. Die Beratung umfasst die Recherche und Empfehlung von drei Fahrzeugen per E-Mail innerhalb von 48 Stunden.</p>

                  <p className="font-bold text-white">§3 Vergütung</p>
                  <p>Die Vergütung beträgt 49 € inkl. MwSt. pro Beratung. Die Zahlung erfolgt über den Zahlungsdienstleister Stripe.</p>

                  <p className="font-bold text-white">§4 Pflichten des Kunden</p>
                  <p>Der Kunde ist verpflichtet, wahrheitsgemäße und vollständige Angaben zu machen. Eine Beratung erfolgt auf Basis dieser Angaben.</p>

                  <p className="font-bold text-white">§5 Haftung</p>
                  <p>Die Beratung basiert auf Marktrecherche und statistischen Daten. Der Anbieter übernimmt keine Haftung für die Korrektheit der Empfehlungen oder für Schäden, die aus dem Kauf eines empfohlenen Fahrzeugs entstehen.</p>

                  <p className="font-bold text-white">§6 Schlussbestimmungen</p>
                  <p>Es gilt das Recht der Bundesrepublik Deutschland. Gerichtsstand ist [TODO: Sitz des Anbieters].</p>
                </div>
              )}

              {activeModal === "datenschutz" && (
                <div className="space-y-4">
                  <p className="font-bold text-white">1. Datenschutz auf einen Blick</p>
                  <p>Wir nehmen den Schutz deiner persönlichen Daten ernst. Personenbezogene Daten werden nur im Rahmen der gesetzlichen Vorschriften, insbesondere der DSGVO, erhoben und verarbeitet.</p>

                  <p className="font-bold text-white">2. Verantwortliche Stelle</p>
                  <p>YoTimo Auto-Beratung · <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: Adresse]</span> · <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: E-Mail]</span></p>

                  <p className="font-bold text-white">3. Erhebung und Verarbeitung von Daten</p>
                  <p>Beim Besuch dieser Website werden automatisch Informationen wie IP-Adresse, Browsertyp und Zugriffszeitpunkt verarbeitet. Bei der Buchung einer Beratung erheben wir die im Formular angegebenen Daten (E-Mail, Budget, Wünsche etc.).</p>

                  <p className="font-bold text-white">4. Zahlungsabwicklung</p>
                  <p>Die Zahlungsabwicklung erfolgt über den externen Zahlungsdienstleister Stripe. Es gelten die Datenschutzbestimmungen von Stripe: <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">https://stripe.com/privacy</a>.</p>

                  <p className="font-bold text-white">5. KI-Fahrzeuganalyse</p>
                  <p>Die KI-Fahrzeuganalyse nutzt Google Gemini und Exa zur Verarbeitung der von dir eingegebenen Fahrzeugnamen. Die Daten werden nicht zu Trainingszwecken verwendet.</p>

                  <p className="font-bold text-white">6. Deine Rechte</p>
                  <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Wende dich dazu an <span className="bg-amber-500/20 text-amber-300 font-bold px-1 rounded">[TODO: E-Mail]</span>.</p>

                  <p className="font-bold text-white">7. Cookies</p>
                  <p>Diese Website verwendet keine Tracking-Cookies. Stripe kann im Rahmen der Zahlungsabwicklung technisch notwendige Cookies setzen.</p>
                </div>
              )}

              <p className="mt-8 pt-4 border-t border-[#1A1A1A] text-xs text-zinc-700 italic">
                Dies ist eine Vorlage. Bitte durch einen Anwalt prüfen lassen.
              </p>

              <p className="text-zinc-700">
                <strong className="text-white">Streitschlichtung:</strong>
              </p>
              <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">https://ec.europa.eu/consumers/odr</a>. Zur Teilnahme an einem Streitbeilegungsverfahren sind wir nicht verpflichtet und nicht bereit.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
//  TikTok-PayPal-Button: nutzt usePayPalOneTimePaymentSession Hook
//  mit explizitem presentationMode: "modal" (TikTok-sicher).
//  Die PayPal-SDK-Reference v6 dokumentiert diesen Modus als speziell
//  für WebView-Szenarien vorgesehen.
// ─────────────────────────────────────────────
interface TikTokPayPalButtonProps {
  form: CheckoutFormState;
  source: string;
  disabled: boolean;
  onError: (msg: string) => void;
  onSuccess: () => void;
  onProcessingChange: (busy: boolean) => void;
}

function TikTokPayPalButton({ form, source, disabled, onError, onSuccess, onProcessingChange }: TikTokPayPalButtonProps) {
  const { isPending, handleClick } = usePayPalOneTimePaymentSession({
    // presentationMode: "modal" = TikTok-sicher (iframe-Overlay, KEIN redirect).
    // Per PayPal-SDK-v6-Referenz speziell für WebView-Szenarien empfohlen.
    presentationMode: "modal",
    createOrder: async () => {
      const res = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, email: form.email, source }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "PayPal-Order konnte nicht erstellt werden.");
      }
      const data = (await res.json()) as { id: string };
      return { orderId: data.id };
    },
    onApprove: async (data) => {
      if (!data.orderId) {
        onError("PayPal hat keine orderId zurückgegeben.");
        return;
      }
      try {
        const res = await fetch("/api/paypal/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderId }),
        });
        const payload = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
        if (!res.ok || payload.status !== "COMPLETED") {
          throw new Error(payload.error ?? "PayPal-Capture nicht autorisiert.");
        }
        onSuccess();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "PayPal-Capture fehlgeschlagen.";
        onError(msg);
      }
    },
    onCancel: () => onError("PayPal-Zahlung abgebrochen. Du kannst es erneut versuchen."),
    onError: (err) => onError(err instanceof Error ? err.message : "PayPal-Fehler aufgetreten."),
  });

  // Processing-State an Parent weitergeben
  React.useEffect(() => {
    onProcessingChange(isPending);
  }, [isPending, onProcessingChange]);

  return (
    <button
      type="button"
      disabled={disabled || isPending}
      onClick={() => {
        // presentationMode ist bereits im Hook-Props auf "modal" gesetzt.
        // handleClick() ist parameterlos.
        handleClick();
      }}
      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-[#FFC439] hover:bg-[#FFB400] disabled:opacity-50 disabled:cursor-not-allowed text-[#003087] text-sm font-bold rounded-lg transition-colors"
    >
      <span className="italic text-base">Pay</span>
      <span className="font-bold">Pal</span>
      {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
    </button>
  );
}
