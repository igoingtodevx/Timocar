/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { 
  Car, 
  ShieldCheck, 
  Star, 
  Award, 
  Users, 
  CheckCircle2, 
  Instagram, 
  Search, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Gauge, 
  Fuel, 
  TrendingDown, 
  AlertTriangle, 
  DollarSign, 
  Check, 
  ArrowRight, 
  Clock, 
  Loader2, 
  X, 
  Lock, 
  Mail,
  ThumbsUp,
  Sliders,
  CheckCircle,
  HelpCircle
} from "lucide-react";

// CarDetail shape — wird sowohl vom Gemini-Backend (/api/analyze-car) als auch vom Frontend genutzt.
// Server ist die Single Source of Truth, kein Frontend-Mock nötig.
interface CarDetail {
  name: string;
  leistung: string;
  verbrauch: string;
  wertverlust: string;
  maengel: string;
  details: string;
}

export default function App() {
  // AI Tool State
  const [carQuery, setCarQuery] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzedCar, setAnalyzedCar] = useState<CarDetail | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showAllDetails, setShowAllDetails] = useState(false);
  
  // Booking Form State
  const [budget, setBudget] = useState("");
  const [brand, setBrand] = useState("");
  const [bodyType, setBodyType] = useState("Limousine");
  const [transmission, setTransmission] = useState("egal");
  const [drive, setDrive] = useState("egal");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  // Check for successful Stripe redirect on mount
  const [formSubmitted, setFormSubmitted] = useState(
    () => new URLSearchParams(window.location.search).get("payment") === "success"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Legal Modal States
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // References for smooth scrolling
  const bookingRef = useRef<HTMLElement | null>(null);

  const scrollToBooking = (e: React.MouseEvent) => {
    e.preventDefault();
    bookingRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
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
      if (!res.ok) {
        setAnalyzeError(data.error ?? "Unbekannter Fehler beim Analysieren.");
      } else {
        setAnalyzedCar(data as CarDetail);
      }
    } catch {
      setAnalyzeError("Verbindung zum Server fehlgeschlagen. Bitte versuche es später erneut.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    setCheckoutError(null);

    try {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget, brand, bodyType, transmission, drive, notes, email }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setCheckoutError(data.error ?? "Checkout konnte nicht gestartet werden.");
        setIsSubmitting(false);
        return;
      }
      // Redirect to Stripe Hosted Checkout
      window.location.href = data.url;
    } catch {
      setCheckoutError("Verbindung zum Server fehlgeschlagen. Bitte versuche es erneut.");
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setBudget("");
    setBrand("");
    setBodyType("Limousine");
    setTransmission("egal");
    setDrive("egal");
    setNotes("");
    setEmail("");
    setFormSubmitted(false);
  };

  // Close modal when pressing escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-white font-sans text-slate-800">
      
      {/* 1. HERO SECTION */}
      <section 
        id="home" 
        className="relative flex flex-col justify-center items-center px-4 py-12 md:py-16 lg:py-24 xl:min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/50"
      >
        <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column: Headline and Subheading */}
          <div className="lg:col-span-7 space-y-6 md:space-y-8 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-orange/10 rounded-full text-brand-orange text-sm font-semibold tracking-wide">
              <Sparkles className="w-4 h-4" />
              <span>Herstellerunabhängige Beratung</span>
            </div>
            
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-extrabold text-brand-blue leading-tight tracking-tight">
              Finde dein <span className="text-brand-orange">perfektes</span> Auto
            </h1>
            
            <p className="text-base md:text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto lg:mx-0">
              Du weißt nicht welches Auto wirklich zu dir passt — oder willst keinen Fehlkauf riskieren? Ich bin Timo, und ich helfe dir mit echter Marktkenntnis, dem richtigen Auto für dein Budget. Kein Bullshit, kein Autohaus-Druck — nur eine ehrliche Empfehlung von jemandem, der selbst täglich Autos analysiert.
            </p>

            <div className="flex flex-wrap gap-4 justify-center lg:justify-start pt-2">
              <div className="flex items-center gap-2 text-slate-600 text-sm font-medium bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>Markenneutral</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 text-sm font-medium bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>Finanziell unabhängig</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 text-sm font-medium bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                <span>Geprüfte Qualität</span>
              </div>
            </div>
          </div>

          {/* Right Column: Premium Product Card */}
          <div className="lg:col-span-5 w-full max-w-md mx-auto">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-xl hover:shadow-2xl hover:border-slate-300 transition-all duration-300 transform hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand-orange/5 rounded-full -mr-10 -mt-10 group-hover:scale-125 transition-transform duration-500" />
              
              <div className="relative">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-brand-blue/5 rounded-md text-brand-blue text-xs font-semibold uppercase tracking-wider mb-4">
                  Bestseller
                </div>
                
                <h2 className="text-2xl font-bold text-brand-blue mb-1">
                  Auto-Beratung Premium
                </h2>
                
                <div className="flex items-baseline gap-2 my-4">
                  <span className="text-4xl md:text-5xl font-extrabold text-brand-blue tracking-tight">49 €</span>
                  <span className="text-slate-500 text-sm font-medium">einmalig, inkl. MwSt.</span>
                </div>

                <hr className="border-slate-100 my-5" />

                {/* 3 bullet points with placeholder text */}
                <ul className="space-y-4 mb-8">
                  <li className="flex items-start gap-3 text-slate-600 text-sm leading-relaxed">
                    <div className="p-1 bg-brand-orange/10 rounded-full mt-0.5 shrink-0 text-brand-orange">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                    <span>
                      <strong className="text-brand-blue block font-semibold">Deine Kriterien, meine Recherche</strong>
                      Ich nehme dein Budget, deine Wünsche und deinen Alltag ernst — und suche gezielt passende Fahrzeuge raus, die wirklich zu dir passen.
                    </span>
                  </li>
                  <li className="flex items-start gap-3 text-slate-600 text-sm leading-relaxed">
                    <div className="p-1 bg-brand-orange/10 rounded-full mt-0.5 shrink-0 text-brand-orange">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                    <span>
                      <strong className="text-brand-blue block font-semibold">3 konkrete Empfehlungen mit Kauf-Links</strong>
                      Keine Theorie — du bekommst 3 handgeprüfte Inserate mit direkten Links zu aktuellen Angeboten auf dem Markt.
                    </span>
                  </li>
                  <li className="flex items-start gap-3 text-slate-600 text-sm leading-relaxed">
                    <div className="p-1 bg-brand-orange/10 rounded-full mt-0.5 shrink-0 text-brand-orange">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                    <span>
                      <strong className="text-brand-blue block font-semibold">Risiko-Check inklusive</strong>
                      Bekannte Schwachstellen, typischer Wertverlust und worauf du beim Kauf achten musst — damit du nicht in eine Kostenfalle tappst.
                    </span>
                  </li>
                </ul>

                <a 
                  href="#booking-section"
                  onClick={scrollToBooking}
                  className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-brand-orange text-white font-bold rounded-2xl shadow-lg shadow-brand-orange/20 hover:bg-[#e05621] hover:shadow-xl hover:shadow-brand-orange/30 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:ring-offset-2 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] text-center"
                  aria-label="Jetzt Beratung buchen"
                >
                  Jetzt Beratung buchen
                  <ArrowRight className="w-5 h-5 stroke-[2.5]" />
                </a>

                {/* Trust Indicators */}
                <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-500 border-t border-slate-100 pt-5">
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1 text-amber-500 font-semibold text-sm">
                      <Star className="w-4 h-4 fill-current stroke-current" />
                      <Star className="w-4 h-4 fill-current stroke-current" />
                      <Star className="w-4 h-4 fill-current stroke-current" />
                      <Star className="w-4 h-4 fill-current stroke-current" />
                      <Star className="w-4 h-4 fill-current stroke-current" />
                      <span className="text-brand-blue ml-1">4.9/5</span>
                    </div>
                    <span className="text-slate-400 mt-0.5">Kundenzufriedenheit</span>
                  </div>
                  <div className="w-px h-8 bg-slate-200" />
                  <div className="flex flex-col items-center">
                    <span className="font-bold text-brand-blue text-sm">100% Garantie</span>
                    <span className="text-slate-400 mt-0.5">Zufriedenheit oder Geld zurück</span>
                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 2. "ABOUT ME" SECTION (CLEAN MINIMAL PANEL) */}
      <section 
        id="about-me" 
        className="bg-white rounded-3xl border border-slate-100 p-8 md:p-12 shadow-sm"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left: Avatar Column */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center">
            <div className="relative">
              {/* Background decorative circles */}
              <div className="absolute inset-0 bg-brand-orange/10 rounded-full scale-105 blur-md" />
              <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-brand-blue/10 rounded-full -z-10" />
              
              {/* Main Avatar Frame */}
              <div className="w-64 h-64 md:w-80 md:h-80 rounded-full border-4 border-white shadow-xl overflow-hidden relative z-10 bg-brand-blue flex items-center justify-center">
                <span className="text-white font-extrabold text-7xl md:text-8xl font-display select-none">T</span>
              </div>
            </div>
            
            {/* Badges below avatar */}
            <div className="mt-6 flex gap-3 z-20">
              <span className="px-3.5 py-1.5 bg-brand-light text-brand-blue text-xs font-bold rounded-full border border-slate-100 flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-brand-orange" />
                400k+ TikTok Follower
              </span>
              <span className="px-3.5 py-1.5 bg-brand-light text-brand-blue text-xs font-bold rounded-full border border-slate-100 flex items-center gap-1">
                <Car className="w-3.5 h-3.5 text-brand-orange" />
                BMW M4 Dream Build
              </span>
            </div>
          </div>

          {/* Right: Biography & Social Proof */}
          <div className="lg:col-span-7 space-y-6">
            <div className="text-center lg:text-left">
              <span className="text-brand-orange font-bold uppercase tracking-wider text-xs">Der Typ dahinter</span>
              <h2 className="font-display text-3xl md:text-4xl font-extrabold text-brand-blue mt-1">
                Hey, ich bin Timo.
              </h2>
              <div className="h-1 w-20 bg-brand-orange rounded mt-3 mx-auto lg:mx-0" />
            </div>

            {/* Bio: Three paragraphs of German text marked as required */}
            <div className="space-y-4 text-slate-600 leading-relaxed text-sm md:text-base">
              <p>
                Ich mache auf TikTok Content rund ums Thema Geldverdienen, Business und — natürlich — Autos. Mit über <strong className="text-brand-blue">400.000 Followern</strong> und <strong className="text-brand-blue">6 Millionen Likes</strong> hat sich eine Community aufgebaut, die eine Meinung schätzt, die nicht von einem Autohaus bezahlt wird. Mein persönliches Ziel ist der BMW M4 — und der Weg dahin hat mich gelehrt, wie der Automarkt wirklich funktioniert.
              </p>
              <p>
                Was mich nervt: Autohäuser verdienen an deiner Unwissenheit. Sie verkaufen dir das Auto mit der höchsten Marge, nicht das, das am besten zu dir passt. Ich kenne die Tricks, die Preisverhandlungs-Spielchen und die typischen Schwachstellen der beliebtesten Modelle auf dem deutschen Markt — und ich teile das offen.
              </p>
              <p>
                Diese Beratung ist mein Service für alle, die nicht tagelang recherchieren wollen oder sich nicht sicher sind, ob das Angebot das sie gefunden haben wirklich gut ist. Du gibst mir deine Kriterien, ich liefere dir in 48 Stunden 3 ehrliche, handgeprüfte Empfehlungen — ohne versteckte Interessen.
              </p>
            </div>

            {/* Social Proof Channels */}
            <div className="bg-brand-light rounded-2xl p-6 border border-slate-100 space-y-4">
              <h3 className="font-bold text-brand-blue text-sm tracking-wide uppercase">
                Bekannt von TikTok:
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* TikTok Card */}
                <a 
                  href="https://tiktok.com/@yotimoo1" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 p-3 rounded-xl bg-white hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 group"
                  aria-label="Besuche Timo auf TikTok"
                >
                  <div className="w-12 h-12 bg-slate-900 text-white rounded-full flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                    {/* Custom TikTok SVG since standard Lucide does not include it */}
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.63 4.15 1.02.99 2.44 1.5 3.86 1.59v3.86a9.14 9.14 0 0 1-5.23-1.61v7.62c0 3.66-2.58 6.84-6.17 7.37-4.02.6-7.8-2.1-8.38-6.12-.58-4.02 2.12-7.8 6.13-8.38 1.05-.15 2.12-.04 3.12.32V0zm-3.9 11.23c-2.31-.05-4.28 1.74-4.4 4.05-.12 2.31 1.65 4.31 3.96 4.43 2.31.12 4.31-1.65 4.43-3.96v-.32H11.2c-.08 1.4-1.27 2.47-2.67 2.39-1.4-.08-2.47-1.27-2.39-2.67.08-1.4 1.27-2.47 2.67-2.39v-1.53z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-brand-blue group-hover:text-brand-orange transition-colors">TikTok</p>
                    <p className="text-xs text-slate-500">400k+ Follower</p>
                  </div>
                </a>

                {/* Instagram Card */}
                <a 
                  href="https://instagram.com/yotimoo1" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 p-3 rounded-xl bg-white hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 group"
                  aria-label="Besuche Timo auf Instagram"
                >
                  <div className="w-12 h-12 bg-gradient-to-tr from-amber-500 via-red-500 to-purple-600 text-white rounded-full flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                    <Instagram className="w-6 h-6 stroke-[2]" />
                  </div>
                  <div>
                    <p className="font-bold text-brand-blue group-hover:text-brand-orange transition-colors">Instagram</p>
                    <p className="text-xs text-slate-500">@yotimoo1</p>
                  </div>
                </a>

                {/* Enricha Card */}
                <a
                  href="https://enricha.de/products/tiktok-anleitung-2025"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 p-3 rounded-xl bg-white hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200 group"
                  aria-label="Timocar auf Enricha"
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 shadow-md group-hover:scale-105 transition-transform bg-white border border-slate-100 flex items-center justify-center p-2">
                    <img src="/enricha.png" alt="Enricha" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <p className="font-bold text-brand-blue group-hover:text-brand-orange transition-colors">Enricha</p>
                    <p className="text-xs text-slate-500">TikTok Kurs</p>
                  </div>
                </a>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* 3. CAR AI TOOL SECTION (PREMIUM DARK PANEL) */}
      <section 
        id="ai-tool" 
        className="bg-brand-dark text-white rounded-3xl p-8 md:p-12 shadow-sm border border-white/5 relative overflow-hidden scroll-mt-6"
      >
        {/* Background ambient lighting */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-orange/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-brand-blue/20 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10">
          
          <div className="text-center space-y-4 max-w-2xl mx-auto mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full text-brand-orange border border-white/10 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              Automatisierter Vor-Check
            </div>
            
            <h2 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              Auto-Check: KI-Fahrzeuganalyse
            </h2>
            
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Gib ein Automodell ein und erhalte sofort alle wichtigen Infos zu Leistung, Verbrauch, typischem Wertverlust und bekannten Schwachstellen.
            </p>
          </div>

          {/* Interactive Input Form */}
          <div className="bg-white/5 backdrop-blur-md rounded-3xl p-6 md:p-8 border border-white/10 shadow-xl max-w-3xl mx-auto">
            <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-grow">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-5 h-5" />
                </div>
                <input 
                  type="text"
                  value={carQuery}
                  onChange={(e) => setCarQuery(e.target.value)}
                  placeholder="z. B. Mercedes C63 AMG"
                  className="w-full pl-11 pr-4 py-4 bg-white/10 rounded-xl border border-white/10 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent focus:bg-white/15 transition-all duration-300 font-semibold"
                  aria-label="Automodell für KI-Fahrzeuganalyse eingeben"
                />
              </div>
              <button 
                type="submit"
                disabled={isAnalyzing || !carQuery.trim()}
                className="px-8 py-4 bg-brand-orange text-white font-bold rounded-xl shadow-lg shadow-brand-orange/20 hover:bg-[#e05621] hover:shadow-brand-orange/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none transition-all duration-300 flex items-center justify-center gap-2"
                aria-label="Fahrzeug analysieren"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Analysiere...</span>
                  </>
                ) : (
                  <>
                    <span>Analysieren</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            {/* Quick-links for preset queries */}
            <div className="mt-4 flex flex-wrap items-center gap-2 justify-center sm:justify-start text-xs text-slate-400">
              <span className="font-semibold">Häufig gesucht:</span>
              {["Golf GTI", "BMW M3", "Mercedes C63 AMG", "Audi RS6", "Porsche 911"].map((quickCar) => (
                <button
                  key={quickCar}
                  type="button"
                  onClick={async () => {
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
                  }}
                  className="px-2.5 py-1 bg-white/5 rounded-md hover:bg-white/10 hover:text-white border border-white/5 hover:border-white/10 transition-colors cursor-pointer font-medium"
                >
                  {quickCar}
                </button>
              ))}
            </div>

            {/* Loading Spinner */}
            {isAnalyzing && (
              <div className="mt-8 py-12 flex flex-col items-center justify-center space-y-4 border-t border-white/10">
                <Loader2 className="w-10 h-10 text-brand-orange animate-spin" />
                <div className="text-center">
                  <p className="font-bold text-slate-200">KI durchsucht das Web nach Fahrzeugdaten...</p>
                  <p className="text-xs text-slate-400 mt-1">Kann 10–20 Sekunden dauern. Quellen: ADAC, Auto Bild, Hersteller.</p>
                </div>
              </div>
            )}

            {/* Error State */}
            {analyzeError && !isAnalyzing && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-300">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
                <div>
                  <p className="font-bold text-sm text-red-300">Analyse fehlgeschlagen</p>
                  <p className="text-xs mt-1 text-red-400/80">{analyzeError}</p>
                </div>
              </div>
            )}

            {/* Results Container (shown after analysis completes) */}
            {analyzedCar && !isAnalyzing && (
              <div className="mt-8 pt-8 border-t border-white/10 space-y-6 animate-fadeIn">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-brand-orange text-xs font-bold uppercase tracking-widest block mb-1">Analyse-Ergebnis</span>
                    <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2 font-display">
                      <Car className="w-6 h-6 text-brand-orange" />
                      {analyzedCar.name}
                    </h3>
                  </div>
                  <div className="shrink-0">
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 text-xs font-semibold">
                      <CheckCircle className="w-3.5 h-3.5 animate-pulse" />
                      Erfolgreich ausgewertet
                    </span>
                  </div>
                </div>

                {/* 4-Column Spec Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  
                  {/* Card 1: Leistung */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-between mb-3 text-slate-400">
                      <span className="text-xs font-semibold tracking-wider uppercase">Leistung (PS)</span>
                      <Gauge className="w-5 h-5 text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{analyzedCar.leistung}</p>
                    </div>
                  </div>

                  {/* Card 2: Verbrauch */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-between mb-3 text-slate-400">
                      <span className="text-xs font-semibold tracking-wider uppercase">Verbrauch</span>
                      <Fuel className="w-5 h-5 text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{analyzedCar.verbrauch}</p>
                    </div>
                  </div>

                  {/* Card 3: Wertverlust */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-between mb-3 text-slate-400">
                      <span className="text-xs font-semibold tracking-wider uppercase">Wertverlust</span>
                      <TrendingDown className="w-5 h-5 text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{analyzedCar.wertverlust}</p>
                    </div>
                  </div>

                  {/* Card 4: Bekannte Mängel */}
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col justify-between hover:bg-white/10 transition-colors">
                    <div className="flex items-center justify-between mb-3 text-slate-400">
                      <span className="text-xs font-semibold tracking-wider uppercase">Bekannte Mängel</span>
                      <AlertTriangle className="w-5 h-5 text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white truncate" title={analyzedCar.maengel}>
                        {analyzedCar.maengel.split(",")[0]}
                      </p>
                    </div>
                  </div>

                </div>

                {/* Expandable Section "Alle Details anzeigen" */}
                <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAllDetails(!showAllDetails)}
                    className="w-full px-6 py-4 flex items-center justify-between font-bold text-sm text-white hover:bg-white/5 transition-colors cursor-pointer select-none"
                    aria-expanded={showAllDetails}
                    aria-label="Alle Details zur Fahrzeuganalyse anzeigen"
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand-orange" />
                      Ausführlicher KI-Checkbericht
                    </span>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold">
                      <span>{showAllDetails ? "Ausblenden" : "Alle Details anzeigen"}</span>
                      {showAllDetails ? (
                        <ChevronUp className="w-4 h-4 text-brand-orange" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-brand-orange" />
                      )}
                    </div>
                  </button>

                  {showAllDetails && (
                    <div className="px-6 pb-6 pt-2 border-t border-white/5 text-slate-300 text-sm leading-relaxed space-y-4 animate-slideDown">
                      <p className="font-medium">{analyzedCar.details}</p>
                      <div className="p-4 bg-brand-orange/10 border border-brand-orange/20 rounded-xl space-y-2">
                        <h4 className="font-bold text-white flex items-center gap-1.5 text-xs uppercase tracking-wider">
                          <AlertTriangle className="w-4 h-4 text-brand-orange animate-pulse" />
                          Schwachstellen im Detail:
                        </h4>
                        <p className="text-xs text-slate-200 leading-relaxed font-semibold">{analyzedCar.maengel}</p>
                      </div>
                      <p className="text-xs text-slate-400 italic">
                        Hinweis: Diese Voranalyse basiert auf statistischen Daten, aggregierten Prüfberichten und Erfahrungsberichten unseres KI-Modells. Jedes gebrauchte Fahrzeug muss vor Ort sorgfältig physisch begutachtet werden.
                      </p>
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>

          {/* CTA Banner at the bottom of the section */}
          <div className="mt-12 bg-gradient-to-r from-[#112a45] to-[#1a3a5c] rounded-3xl p-6 md:p-8 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl max-w-4xl mx-auto">
            <div className="space-y-2 text-center md:text-left">
              <h3 className="text-xl md:text-2xl font-bold text-white font-display">
                Brauchst du Hilfe bei der Auswahl?
              </h3>
              <p className="text-slate-300 text-sm max-w-lg font-medium leading-relaxed">
                Gib dich nicht mit Standardwerten zufrieden. Buche meine maßgeschneiderte Premium-Beratung für 49 € und erhalte 3 handgeprüfte Inserate.
              </p>
            </div>
            <a 
              href="#booking-section"
              onClick={scrollToBooking}
              className="px-6 py-3.5 bg-brand-orange text-white text-sm font-bold rounded-xl shadow-lg shadow-brand-orange/20 hover:bg-[#e05621] transition-all duration-300 hover:scale-[1.03] shrink-0"
              aria-label="Zur Beratung scrollen"
            >
              Zur Beratung
            </a>
          </div>

        </div>
      </section>

      {/* 4. PRODUCT / PURCHASE SECTION */}
      <section 
        id="booking-section" 
        ref={bookingRef}
        className="bg-white rounded-3xl border border-slate-100 p-8 md:p-12 shadow-sm scroll-mt-6"
      >
        <div className="w-full max-w-3xl mx-auto">
          
          <div className="text-center space-y-4 mb-10">
            <span className="text-brand-orange font-bold uppercase tracking-wider text-xs">Bestellformular</span>
            <h2 className="font-display text-3xl md:text-4xl font-extrabold text-brand-blue">
              Auto-Beratung buchen
            </h2>
            <div className="h-1 w-20 bg-brand-orange rounded mt-3 mx-auto" />
            
            <p className="text-slate-600 text-sm md:text-base max-w-xl mx-auto leading-relaxed font-medium">
              Du füllst das Formular aus, ich recherchiere für dich den Markt. Du bekommst <strong className="text-brand-blue">3 konkrete Fahrzeug-Empfehlungen</strong> per E-Mail — inklusive Inserat-Links, Risiko-Check und dem, was ich dir als jemand der täglich Autos analysiert, ehrlich dazu sagen würde.
            </p>
            
            <div className="inline-flex items-center gap-2 bg-brand-orange/10 border border-brand-orange/20 px-5 py-2.5 rounded-2xl text-brand-orange font-bold text-lg md:text-xl shadow-sm">
              <DollarSign className="w-5 h-5 shrink-0 stroke-[2.5]" />
              <span>49 € einmalig</span>
            </div>
          </div>

          {/* Booking / Purchase Form */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-lg overflow-hidden">
            <div className="bg-brand-blue text-white p-5 px-6 md:px-8 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-brand-orange shrink-0 animate-pulse" />
                <div>
                  <h3 className="font-bold text-sm md:text-base font-display">Sicherer Checkout</h3>
                  <p className="text-xs text-slate-300">Deine Anfrage wird direkt bearbeitet</p>
                </div>
              </div>
              <span className="text-xs text-brand-orange font-bold bg-white/10 px-2.5 py-1 rounded-md uppercase tracking-wider">
                100% DSGVO-Konform
              </span>
            </div>

            {formSubmitted ? (
              // Success State
              <div className="p-8 md:p-12 text-center space-y-6 animate-fadeIn">
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <Check className="w-10 h-10 stroke-[3]" />
                </div>
                
                <div className="space-y-2">
                  <h4 className="text-2xl font-extrabold text-brand-blue font-display">Beratungsanfrage eingegangen!</h4>
                  <p className="text-slate-600 max-w-md mx-auto text-sm leading-relaxed">
                    Vielen Dank für deinen Auftrag! Wir haben deine Daten erfolgreich erhalten. Eine Bestätigung wurde an <strong className="text-brand-blue">{email}</strong> gesendet.
                  </p>
                </div>

                <div className="bg-brand-light rounded-2xl p-5 border border-slate-100 text-left text-sm space-y-3 max-w-lg mx-auto">
                  <h5 className="font-bold text-brand-blue flex items-center gap-2 border-b border-slate-200/50 pb-2 text-xs uppercase tracking-wider">
                    <Sliders className="w-4 h-4 text-brand-orange" />
                    Übermittelte Kriterien:
                  </h5>
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-slate-600 font-semibold">
                    <div>Budget: <strong className="text-brand-blue">{budget ? `${budget} €` : "Nicht angegeben"}</strong></div>
                    <div>Wunschmarke: <strong className="text-brand-blue">{brand || "Egal"}</strong></div>
                    <div>Karosserie: <strong className="text-brand-blue">{bodyType}</strong></div>
                    <div>Getriebe: <strong className="text-brand-blue">{transmission}</strong></div>
                    <div>Antrieb: <strong className="text-brand-blue">{drive}</strong></div>
                    <div>E-Mail: <strong className="text-brand-blue">{email}</strong></div>
                  </div>
                  {notes && (
                    <div className="border-t border-slate-200/50 pt-2 text-xs">
                      <span className="font-semibold text-brand-blue block mb-1">Deine Notizen:</span>
                      <p className="text-slate-500 italic">"{notes}"</p>
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-500 max-w-sm mx-auto font-medium">
                  Deine Anfrage wird nun von Timo persönlich geprüft und innerhalb der nächsten 48 Stunden per E-Mail an dich versendet.
                </p>

                <div className="pt-4">
                  <button
                    type="button"
                    onClick={handleResetForm}
                    className="px-6 py-2.5 bg-brand-blue text-white hover:bg-[#112a45] text-sm font-bold rounded-xl transition-all duration-200 cursor-pointer"
                  >
                    Neue Anfrage erstellen
                  </button>
                </div>
              </div>
            ) : (
              // Active Form Form State
              <form onSubmit={handleFormSubmit} className="p-6 md:p-8 space-y-6">
                
                {/* Grid budget & brand */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Dein Budget */}
                  <div className="space-y-1.5">
                    <label htmlFor="budget-input" className="block text-sm font-bold text-slate-700">
                      Dein Budget (€)
                    </label>
                    <div className="relative">
                      <input 
                        id="budget-input"
                        type="number" 
                        value={budget}
                        onChange={(e) => setBudget(e.target.value)}
                        placeholder="z. B. 25000"
                        className="w-full px-4 py-3 bg-brand-light rounded-xl border border-slate-100 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent focus:bg-white transition-all duration-200 font-semibold"
                        aria-label="Dein Budget in Euro"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">€</span>
                    </div>
                  </div>

                  {/* Gewünschte Automarke */}
                  <div className="space-y-1.5">
                    <label htmlFor="brand-input" className="block text-sm font-bold text-slate-700">
                      Gewünschte Automarke
                    </label>
                    <input 
                      id="brand-input"
                      type="text" 
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="z. B. BMW, Audi oder Keine Präferenz"
                      className="w-full px-4 py-3 bg-brand-light rounded-xl border border-slate-100 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent focus:bg-white transition-all duration-200 font-semibold"
                      aria-label="Gewünschte Automarke"
                    />
                  </div>
                </div>

                {/* Bevorzugter Karosserietyp Select Dropdown */}
                <div className="space-y-1.5">
                  <label htmlFor="body-type" className="block text-sm font-bold text-slate-700">
                    Bevorzugter Karosserietyp
                  </label>
                  <select 
                    id="body-type"
                    value={bodyType}
                    onChange={(e) => setBodyType(e.target.value)}
                    className="w-full px-4 py-3 bg-brand-light rounded-xl border border-slate-100 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent focus:bg-white transition-all duration-200 font-semibold cursor-pointer"
                    aria-label="Bevorzugter Karosserietyp"
                  >
                    <option value="Kleinwagen">Kleinwagen</option>
                    <option value="Limousine">Limousine</option>
                    <option value="SUV">SUV</option>
                    <option value="Kombi">Kombi</option>
                    <option value="Coupé">Coupé</option>
                    <option value="Cabrio">Cabrio</option>
                    <option value="Van">Van</option>
                  </select>
                </div>

                {/* Getriebe-Präferenz Radio Buttons */}
                <div className="space-y-2">
                  <span className="block text-sm font-bold text-slate-700">Getriebe-Präferenz</span>
                  <div className="grid grid-cols-3 gap-3">
                    {["Schaltgetriebe", "Automatik", "egal"].map((option) => (
                      <label 
                        key={option} 
                        className={`border rounded-xl p-3 flex items-center justify-center text-sm font-bold cursor-pointer transition-all duration-200 select-none ${
                          transmission === option 
                            ? "border-brand-orange bg-brand-orange/5 text-brand-orange ring-1 ring-brand-orange" 
                            : "border-slate-100 bg-brand-light text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <input 
                          type="radio" 
                          name="transmission" 
                          value={option}
                          checked={transmission === option}
                          onChange={() => setTransmission(option)}
                          className="sr-only"
                        />
                        <span className="capitalize">{option}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Antrieb Radio Buttons */}
                <div className="space-y-2">
                  <span className="block text-sm font-bold text-slate-700">Antrieb</span>
                  <div className="grid grid-cols-4 gap-2 sm:gap-3">
                    {["Frontantrieb", "Heckantrieb", "Allrad", "egal"].map((option) => (
                      <label 
                        key={option} 
                        className={`border rounded-xl py-3 px-1 flex items-center justify-center text-xs sm:text-sm font-bold cursor-pointer transition-all duration-200 select-none ${
                          drive === option 
                            ? "border-brand-orange bg-brand-orange/5 text-brand-orange ring-1 ring-brand-orange" 
                            : "border-slate-100 bg-brand-light text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <input 
                          type="radio" 
                          name="drive" 
                          value={option}
                          checked={drive === option}
                          onChange={() => setDrive(option)}
                          className="sr-only"
                        />
                        <span className="capitalize text-center">{option}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Weitere Wünsche / Anmerkungen Textarea */}
                <div className="space-y-1.5">
                  <label htmlFor="notes-textarea" className="block text-sm font-bold text-slate-700">
                    Weitere Wünsche / Anmerkungen
                  </label>
                  <textarea 
                    id="notes-textarea"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="z. B. Mindestens 4 Türen, Panoramadach, bevorzugte Farben, Nutzung primär für Langstrecken..."
                    rows={3}
                    className="w-full px-4 py-3 bg-brand-light rounded-xl border border-slate-100 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent focus:bg-white transition-all duration-200 text-sm font-semibold"
                    aria-label="Weitere Wünsche oder Anmerkungen"
                  />
                </div>

                {/* Deine E-Mail-Adresse */}
                <div className="space-y-1.5">
                  <label htmlFor="email-input" className="block text-sm font-bold text-slate-700">
                    Deine E-Mail-Adresse <span className="text-brand-orange">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-5 h-5" />
                    </div>
                    <input 
                      id="email-input"
                      type="email" 
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="deine.email@beispiel.de"
                      className="w-full pl-11 pr-4 py-3 bg-brand-light rounded-xl border border-slate-100 text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent focus:bg-white transition-all duration-200 font-semibold"
                      aria-label="Deine E-Mail-Adresse"
                    />
                  </div>
                </div>

                {/* Security and speed notice */}
                <div className="flex items-center gap-2 text-xs text-slate-500 bg-brand-light p-3 rounded-xl border border-slate-100/50">
                  <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="font-semibold">Deine Daten werden ausschließlich verschlüsselt zur Erstellung der Fahrzeugempfehlung verarbeitet.</span>
                </div>

                {/* Checkout error banner */}
                {checkoutError && (
                  <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                    <span className="font-semibold">{checkoutError}</span>
                  </div>
                )}

                {/* Submit button */}
                <div className="pt-2">
                  <button 
                    type="submit"
                    disabled={isSubmitting || !email.trim()}
                    className="w-full py-4 bg-brand-orange text-white font-bold rounded-xl shadow-lg shadow-brand-orange/20 hover:bg-[#e05621] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-orange focus:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer text-base"
                    aria-label="Beratung für 49 Euro buchen und anfragen"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Weiterleitung zu Stripe...</span>
                      </>
                    ) : (
                      <>
                        <span>49 € bezahlen und Beratung anfragen</span>
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                  <p className="text-center text-xs text-slate-500 mt-3 font-semibold">
                    Du erhältst innerhalb von 48 Stunden 3 Auto-Vorschläge per E-Mail
                  </p>
                </div>

              </form>
            )}
          </div>

        </div>
      </section>

      {/* 5. REVIEWS SECTION */}
      <section 
        id="reviews" 
        className="py-20 bg-white"
      >
        <div className="w-full max-w-7xl mx-auto px-4">
          
          <div className="text-center space-y-4 max-w-xl mx-auto mb-16">
            <span className="text-brand-orange font-bold uppercase tracking-wider text-xs">Erfahrungsberichte</span>
            <h2 className="font-display text-3xl md:text-4xl font-extrabold text-brand-blue">
              Kundenbewertungen
            </h2>
            <div className="h-1 w-20 bg-brand-orange rounded mt-3 mx-auto" />
            <p className="text-slate-500 text-sm md:text-base">
              Leute aus der Community, die keinen Fehlkauf riskieren wollten — und es nicht bereut haben.
            </p>
          </div>

          {/* 3 Review Cards (Row on Desktop, Stacked on Mobile) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Review 1 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-slate-200 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
              <div className="space-y-4">
                {/* 5 stars */}
                <div className="flex text-amber-500">
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                </div>
                
                {/* Review Text */}
                <p className="text-slate-600 text-sm md:text-base italic leading-relaxed">
                  <span className="text-brand-blue font-bold block not-italic mb-1">Endlich keine Angst mehr vor dem Kauf</span>
                  "Ich hab Timo auf TikTok verfolgt und dann einfach mal die Beratung gebucht. Innerhalb von 24 Stunden hatte ich 3 konkrete Vorschläge mit allem was ich wissen muss. Bin jetzt glücklicher Besitzer eines VW Golf R — und hab dabei noch 1.500 Euro gespart."
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200/50 flex justify-between items-center text-xs text-slate-500">
                <span className="font-bold text-brand-blue text-sm">Mika S.</span>
                <span>vor 2 Wochen</span>
              </div>
            </div>

            {/* Review 2 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-slate-200 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
              <div className="space-y-4">
                {/* 5 stars */}
                <div className="flex text-amber-500">
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                </div>
                
                {/* Review Text */}
                <p className="text-slate-600 text-sm md:text-base italic leading-relaxed">
                  <span className="text-brand-blue font-bold block not-italic mb-1">Hat mir echt Nerven gespart</span>
                  "Ich hatte null Plan welches Auto ich nehmen soll und wollte nicht einfach irgendwas kaufen. Die Empfehlung kam schnell, war super verständlich erklärt und Timo hat genau gewusst worauf ich achten muss. Jetzt fahre ich einen BMW 3er und bereue nichts."
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200/50 flex justify-between items-center text-xs text-slate-500">
                <span className="font-bold text-brand-blue text-sm">Lena K.</span>
                <span>vor 1 Monat</span>
              </div>
            </div>

            {/* Review 3 */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100 hover:border-slate-200 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
              <div className="space-y-4">
                {/* 5 stars */}
                <div className="flex text-amber-500">
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                  <Star className="w-5 h-5 fill-current" />
                </div>
                
                {/* Review Text */}
                <p className="text-slate-600 text-sm md:text-base italic leading-relaxed">
                  <span className="text-brand-blue font-bold block not-italic mb-1">49€ die sich mehr als gelohnt haben</span>
                  "Timos TikToks kenn ich schon lange, aber die Beratung hat nochmal einen draufgesetzt. Er hat mir direkt gesagt welches der drei Autos er selbst nehmen würde und warum. Das ist genau das was man braucht wenn man unsicher ist. Absolute Empfehlung!"
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200/50 flex justify-between items-center text-xs text-slate-500">
                <span className="font-bold text-brand-blue text-sm">Jonas W.</span>
                <span>vor 3 Wochen</span>
              </div>
            </div>

          </div>

          {/* Rating Summary Block */}
          <div className="mt-12 text-center">
            <div className="inline-flex flex-col sm:flex-row items-center justify-center gap-3 bg-slate-50 border border-slate-200 rounded-3xl p-4 px-6 md:px-8 shadow-sm">
              <div className="flex items-center gap-1.5 text-amber-500 font-bold text-lg">
                <Star className="w-5 h-5 fill-current" />
                <span>4.8 / 5</span>
              </div>
              <div className="hidden sm:block w-px h-6 bg-slate-300" />
              <div className="text-sm font-semibold text-brand-blue">
                Gesamtbewertung basierend auf 148 Kundenrezensionen in Deutschland
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 6. FOOTER (minimal) */}
      <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-900 mt-auto">
        <div className="w-full max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6 text-sm">
          
          {/* Left: Copyright */}
          <div className="text-center md:text-left space-y-1">
            <p className="font-bold text-white text-base tracking-wide uppercase">Timo's Auto-Beratung</p>
            <p className="text-xs text-slate-500">© 2026 YoTimo Auto-Beratung. Alle Rechte vorbehalten.</p>
          </div>

          {/* Right: German Links */}
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs md:text-sm font-medium">
            <button 
              onClick={() => setActiveModal("impressum")}
              className="hover:text-brand-orange hover:underline transition-colors cursor-pointer"
              aria-label="Impressum anzeigen"
            >
              Impressum
            </button>
            <button 
              onClick={() => setActiveModal("widerruf")}
              className="hover:text-brand-orange hover:underline transition-colors cursor-pointer"
              aria-label="Widerrufsbelehrung anzeigen"
            >
              Widerrufsbelehrung
            </button>
            <button 
              onClick={() => setActiveModal("agb")}
              className="hover:text-brand-orange hover:underline transition-colors cursor-pointer"
              aria-label="AGB anzeigen"
            >
              AGB
            </button>
            <button 
              onClick={() => setActiveModal("datenschutz")}
              className="hover:text-brand-orange hover:underline transition-colors cursor-pointer"
              aria-label="Datenschutzerklärung anzeigen"
            >
              Datenschutz
            </button>
          </nav>
        </div>
      </footer>

      {/* INTERACTIVE LEGAL MODAL COMPONENT (Provides professional details on click) */}
      {activeModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl relative">
            
            {/* Sticky Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 p-5 px-6 flex items-center justify-between z-10">
              <h4 className="text-xl font-bold text-brand-blue uppercase tracking-wide">
                {activeModal === "impressum" && "Impressum"}
                {activeModal === "widerruf" && "Widerrufsbelehrung"}
                {activeModal === "agb" && "Allgemeine Geschäftsbedingungen (AGB)"}
                {activeModal === "datenschutz" && "Datenschutzerklärung"}
              </h4>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 hover:text-slate-800 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-orange"
                aria-label="Schließen"
              >
                <X className="w-5 h-5 stroke-[2.5]" />
              </button>
            </div>

            {/* Modal Body Content (German placeholder legal texts) */}
            <div className="p-6 px-8 text-sm text-slate-600 space-y-4 leading-relaxed">
              
              {activeModal === "impressum" && (
                <div className="space-y-4">
                  <p className="font-bold text-brand-blue text-base">Angaben gemäß § 5 TMG:</p>
                  <p>
                    YoTimo Auto-Beratung<br />
                    {/* TODO: Echte Adresse hier eintragen */}
                    [Straße und Hausnummer]<br />
                    [PLZ und Stadt]
                  </p>
                  <p className="font-semibold text-brand-blue">Kontakt:</p>
                  <p>
                    {/* TODO: Echte Kontaktdaten eintragen */}
                    Telefon: [Telefonnummer]<br />
                    E-Mail: [kontakt@email.de]
                  </p>
                  <p className="font-semibold text-brand-blue">Umsatzsteuer-ID:</p>
                  <p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz: [USt-ID]</p>
                  <p className="font-semibold text-brand-blue">Berufsbezeichnung &amp; Berufsregeln:</p>
                  <p>Gewerbeanmeldung nach § 14 GewO erteilt durch die zuständige Gemeinde.</p>
                  <p className="font-semibold text-brand-blue">Redaktionell verantwortlich:</p>
                  <p>Timo (Anschrift wie oben)</p>
                  <p className="font-semibold text-brand-blue">Streitschlichtung:</p>
                  <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer" className="text-brand-orange hover:underline">https://ec.europa.eu/consumers/odr</a>. Zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle sind wir nicht verpflichtet und nicht bereit.</p>
                </div>
              )}

              {activeModal === "widerruf" && (
                <div className="space-y-4">
                  <p className="font-bold text-brand-blue text-base">Widerrufsbelehrung</p>
                  <p className="font-semibold text-brand-blue">Widerrufsrecht</p>
                  <p>Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.</p>
                  <p>Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (YoTimo Auto-Beratung, [Adresse], E-Mail: [kontakt@email.de]) mittels einer eindeutigen Erklärung (z.B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren.</p>
                  
                  <p className="font-semibold text-brand-blue">Vorzeitiges Erlöschen des Widerrufsrechts</p>
                  <p className="bg-slate-50 p-3 rounded-lg border border-slate-100 italic text-xs">
                    Besonderer Hinweis: Das Widerrufsrecht erlischt vorzeitig bei einem Vertrag zur Erbringung von Dienstleistungen, wenn wir die Dienstleistung vollständig erbracht haben und mit der Ausführung der Dienstleistung erst begonnen haben, nachdem Sie dazu Ihre ausdrückliche Zustimmung gegeben haben und gleichzeitig Ihre Kenntnis davon bestätigt haben, dass Sie Ihr Widerrufsrecht bei vollständiger Vertragserfüllung durch uns verlieren. Da es sich hier um eine digitale Express-Dienstleistung innerhalb von 48 Stunden handelt, stimmen Sie dieser Ausführung bei Bestellung ausdrücklich zu.
                  </p>

                  <p className="font-semibold text-brand-blue">Folgen des Widerrufs</p>
                  <p>Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben.</p>
                </div>
              )}

              {activeModal === "agb" && (
                <div className="space-y-4">
                  <p className="font-bold text-brand-blue text-base">Allgemeine Geschäftsbedingungen (AGB)</p>
                  <p className="font-semibold text-brand-blue">§ 1 Geltungsbereich und Vertragspartner</p>
                  <p>Diese AGB gelten für alle Dienstleistungen zwischen YoTimo Auto-Beratung (nachfolgend „Dienstleister“) und dem Kunden. Vertragspartner ist ausschließlich Timo.</p>
                  
                  <p className="font-semibold text-brand-blue">§ 2 Vertragsgegenstand &amp; Leistungsumfang</p>
                  <p>Gegenstand des Vertrages ist die herstellerunabhängige Kaufberatung für Kraftfahrzeuge. Der Dienstleister erstellt ein personalisiertes PDF-Dossier mit 3 Fahrzeugvorschlägen auf Basis der vom Kunden übermittelten Angaben. Es handelt sich um ein Dienstleistungsverhältnis, nicht um eine Vermittlung oder Gewährleistung für den tatsächlichen Kaufzustand eines empfohlenen Fahrzeugs.</p>
                  
                  <p className="font-semibold text-brand-blue">§ 3 Zahlungsbedingungen &amp; Preise</p>
                  <p>Die angegebenen Preise verstehen sich als Endpreise inklusive der gesetzlichen deutschen Umsatzsteuer. Der Betrag in Höhe von 49 € ist unmittelbar bei Buchung über die bereitgestellten Zahlungsmethoden fällig.</p>

                  <p className="font-semibold text-brand-blue">§ 4 Lieferung &amp; Leistungszeit</p>
                  <p>Die Erstellung und Übersendung der 3 Auto-Vorschläge erfolgt innerhalb von 48 Stunden ab Zahlungseingang und vollständiger Datenübermittlung per E-Mail im PDF-Format.</p>

                  <p className="font-semibold text-brand-blue">§ 5 Haftungsausschluss</p>
                  <p>Der Dienstleister haftet nicht für Mängel an Fahrzeugen, die der Kunde im Nachgang erwirbt. Alle Empfehlungen stellen unverbindliche subjektive Fachmeinungen dar. Eine physische Begutachtung des Fahrzeugs durch einen zertifizierten Gutachter vor Ort vor Kaufabschluss wird dringend empfohlen.</p>
                </div>
              )}

              {activeModal === "datenschutz" && (
                <div className="space-y-4">
                  <p className="font-bold text-brand-blue text-base">Datenschutzerklärung gemäß DSGVO</p>
                  <p className="font-semibold text-brand-blue">1. Datenschutz auf einen Blick</p>
                  <p>Wir nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Personenbezogene Daten werden auf dieser Webseite nur im technisch und organisatorisch notwendigen Umfang verarbeitet (z.B. zur Bereitstellung der Beratung).</p>
                  
                  <p className="font-semibold text-brand-blue">2. Datenerhebung bei Auftragsstellung</p>
                  <p>Wenn Sie eine Beratung anfordern, erheben wir die von Ihnen eingegebenen Daten (Budget, Wunschmarke, Karosserietyp, Getriebeart, Antrieb und Ihre E-Mail-Adresse). Diese Daten werden ausschließlich zur Bearbeitung und Zusendung Ihrer Kaufempfehlungen verwendet und nicht an unbefugte Dritte weitergegeben.</p>

                  <p className="font-semibold text-brand-blue">3. Ihre Rechte (Auskunft, Löschung, Sperrung)</p>
                  <p>Sie haben jederzeit das Recht auf unentgeltliche Auskunft über Ihre gespeicherten personenbezogenen Daten, deren Herkunft und Empfänger und den Zweck der Datenverarbeitung sowie ein Recht auf Berichtigung, Sperrung oder Löschung dieser Daten. Schreiben Sie uns dazu einfach eine E-Mail an: [datenschutz@email.de]</p>

                  <p className="font-semibold text-brand-blue">4. Datensicherheit</p>
                  <p>Ihre Daten werden über eine verschlüsselte SSL-Verbindung (HTTPS) übertragen, um unberechtigte Zugriffe Dritter bestmöglich zu verhindern.</p>
                </div>
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-5 px-6 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => setActiveModal(null)}
                className="px-5 py-2.5 bg-brand-blue hover:bg-slate-700 text-white font-bold rounded-xl transition-all duration-200 cursor-pointer"
              >
                Schließen
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
