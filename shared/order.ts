export const PRODUCT_NAME = "Autoempfehlung Premium";
export const PRODUCT_PRICE_CENTS = 4_900;
export const DELIVERY_WINDOW = "innerhalb von 48 Stunden";
export const CONSENT_VERSION = "2026-07-13";

export const BODY_TYPES = [
  "Limousine",
  "Kombi",
  "SUV",
  "Coupé",
  "Cabrio",
  "Kleinwagen",
  "Van",
] as const;

export const TRANSMISSIONS = ["Schaltgetriebe", "Automatik", "Egal"] as const;
export const DRIVES = ["Frontantrieb", "Heckantrieb", "Allrad", "Egal"] as const;
export const ACCIDENT_OPTIONS = ["Ja", "Nein"] as const;
export const COLORS = ["Schwarz", "Weiß", "Grau", "Blau", "Rot", "Gelb"] as const;

export type OrderFormData = {
  budget: string;
  brand: string;
  model: string;
  maxMileage: string;
  bodyType: string;
  transmission: string;
  drive: string;
  accidentFree: string;
  color: string;
  notes: string;
  email: string;
  acceptTerms: boolean;
  startBeforeWithdrawal: boolean;
  acknowledgeWithdrawalLoss: boolean;
};

export type OrderFormErrors = Partial<Record<keyof OrderFormData, string>>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isChoice(value: string | undefined, choices: readonly string[]) {
  return Boolean(value && choices.includes(value));
}

function validatePositiveNumber(
  value: string | undefined,
  label: string,
  min: number,
  max: number,
) {
  if (!value?.trim()) return `${label} ist erforderlich.`;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < min || numericValue > max) {
    return `${label} muss zwischen ${min.toLocaleString("de-DE")} und ${max.toLocaleString("de-DE")} liegen.`;
  }
  return undefined;
}

export function validateOrderForm(data: Partial<OrderFormData>): OrderFormErrors {
  const errors: OrderFormErrors = {};

  errors.budget = validatePositiveNumber(data.budget, "Budget", 1_000, 2_000_000);
  errors.maxMileage = validatePositiveNumber(data.maxMileage, "Maximale Kilometer", 0, 1_000_000);

  if (!data.brand?.trim()) errors.brand = "Marke ist erforderlich.";
  if (!data.model?.trim()) errors.model = "Modell ist erforderlich.";
  if (!isChoice(data.bodyType, BODY_TYPES)) errors.bodyType = "Bitte Karosserietyp auswählen.";
  if (!isChoice(data.transmission, TRANSMISSIONS)) errors.transmission = "Bitte Getriebe auswählen.";
  if (!isChoice(data.drive, DRIVES)) errors.drive = "Bitte Antrieb auswählen.";
  if (!isChoice(data.accidentFree, ACCIDENT_OPTIONS)) errors.accidentFree = "Bitte Unfallfreiheit auswählen.";
  if (!isChoice(data.color, COLORS)) errors.color = "Bitte Farbe auswählen.";
  if (!data.notes?.trim()) errors.notes = "Weitere Wünsche sind erforderlich.";
  if (!data.email?.trim() || !emailPattern.test(data.email.trim())) errors.email = "Bitte gültige E-Mail-Adresse eingeben.";
  if (!data.acceptTerms) errors.acceptTerms = "Bitte Pflichtinformation bestätigen.";
  if (!data.startBeforeWithdrawal) errors.startBeforeWithdrawal = "Bitte vorzeitigen Leistungsbeginn ausdrücklich bestätigen.";
  if (!data.acknowledgeWithdrawalLoss) errors.acknowledgeWithdrawalLoss = "Bitte Kenntnis vom möglichen Erlöschen des Widerrufsrechts bestätigen.";

  for (const key of Object.keys(errors) as Array<keyof OrderFormErrors>) {
    if (!errors[key]) delete errors[key];
  }

  return errors;
}

export function hasOrderFormErrors(errors: OrderFormErrors) {
  return Object.keys(errors).length > 0;
}
