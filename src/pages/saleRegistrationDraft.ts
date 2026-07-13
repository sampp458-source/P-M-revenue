import {
  calculateFinalSaleAmount,
  calculateGrossAmount,
  calculateOutstandingAmount,
  normalizeQuantity,
} from "./saleRegistrationLogic";

export const saleDraftPrefix = "pnm:sales:new:draft:v1:";
export const saleDraftMaxAgeMs = 24 * 60 * 60 * 1000;
const saleDraftVersion = 1;

export interface SaleRegistrationFormState {
  saleDate: string;
  businessUnitId: string;
  customerId: string;
  dogId: string;
  categoryId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  originalAmount: number;
  additionalAmount: number;
  discountAmount: number;
  paidAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  adjustmentNote: string;
  paymentMethod: string;
  customerType: string;
  staffId: string;
  memo: string;
}

export interface SaleReferenceDraft {
  customerName: string;
  phone: string;
  dogName: string;
}

export interface SaleRegistrationDraft {
  version: 1;
  updatedAt: string;
  form: SaleRegistrationFormState;
  saleReference: SaleReferenceDraft;
  ui: {
    customerSectionOpen: boolean;
    advancedOpen: boolean;
    paidAmountEdited: boolean;
  };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const amount = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
};

export function saleDraftKey(userId: string) {
  return `${saleDraftPrefix}${userId}`;
}

export function normalizeSaleDraftForm(value: unknown): SaleRegistrationFormState | null {
  if (!value || typeof value !== "object") return null;
  const form = value as Record<string, unknown>;
  const quantity = normalizeQuantity(Number(form.quantity));
  const unitPrice = amount(form.unitPrice);
  const originalAmount = calculateGrossAmount(unitPrice, quantity);
  const additionalAmount = amount(form.additionalAmount);
  const discountAmount = amount(form.discountAmount);
  const paidAmount = amount(form.paidAmount);
  const refundAmount = Math.min(amount(form.refundAmount), paidAmount);
  const finalSaleAmount = calculateFinalSaleAmount(
    originalAmount,
    additionalAmount,
    discountAmount,
  );

  return {
    saleDate: text(form.saleDate),
    businessUnitId: text(form.businessUnitId),
    customerId: text(form.customerId),
    dogId: text(form.dogId),
    categoryId: text(form.categoryId),
    productId: text(form.productId),
    quantity,
    unitPrice,
    originalAmount,
    additionalAmount,
    discountAmount,
    paidAmount,
    refundAmount,
    outstandingAmount: calculateOutstandingAmount(finalSaleAmount, paidAmount),
    adjustmentNote: text(form.adjustmentNote),
    paymentMethod: text(form.paymentMethod) || "card",
    customerType: text(form.customerType) || "new",
    staffId: text(form.staffId),
    memo: text(form.memo),
  };
}

export function saleInputFingerprint(
  form: SaleRegistrationFormState,
  saleReference: SaleReferenceDraft,
) {
  return JSON.stringify({ form, saleReference });
}

export function parseSaleDraft(
  value: string,
  now = Date.now(),
): SaleRegistrationDraft | null {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (parsed.version !== saleDraftVersion) return null;
  const updatedAt = text(parsed.updatedAt);
  const updatedAtTime = Date.parse(updatedAt);
  if (
    !updatedAt ||
    !Number.isFinite(updatedAtTime) ||
    now - updatedAtTime > saleDraftMaxAgeMs
  )
    return null;
  const form = normalizeSaleDraftForm(parsed.form);
  if (!form) return null;
  const reference =
    parsed.saleReference && typeof parsed.saleReference === "object"
      ? (parsed.saleReference as Record<string, unknown>)
      : {};
  const ui =
    parsed.ui && typeof parsed.ui === "object"
      ? (parsed.ui as Record<string, unknown>)
      : {};
  return {
    version: saleDraftVersion,
    updatedAt,
    form,
    saleReference: {
      customerName: text(reference.customerName),
      phone: text(reference.phone),
      dogName: text(reference.dogName),
    },
    ui: {
      customerSectionOpen: ui.customerSectionOpen === true,
      advancedOpen: ui.advancedOpen === true,
      paidAmountEdited: ui.paidAmountEdited === true,
    },
  };
}

export function readSaleDraft(storage: DraftStorage, userId: string) {
  const key = saleDraftKey(userId);
  try {
    const stored = storage.getItem(key);
    if (!stored) return null;
    const draft = parseSaleDraft(stored);
    if (!draft) storage.removeItem(key);
    return draft;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
    return null;
  }
}

export function writeSaleDraft(
  storage: DraftStorage,
  userId: string,
  draft: Omit<SaleRegistrationDraft, "version" | "updatedAt">,
) {
  try {
    storage.setItem(
      saleDraftKey(userId),
      JSON.stringify({
        version: saleDraftVersion,
        updatedAt: new Date().toISOString(),
        ...draft,
      } satisfies SaleRegistrationDraft),
    );
  } catch {
    // Draft persistence must never block sale registration.
  }
}

export function removeSaleDraft(storage: DraftStorage, userId: string) {
  try {
    storage.removeItem(saleDraftKey(userId));
  } catch {
    // Draft persistence must never block sale registration.
  }
}

export function clearAllSaleDrafts(storage: DraftStorage) {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    keys.forEach((key) => {
      if (key?.startsWith(saleDraftPrefix)) storage.removeItem(key);
    });
  } catch {
    // Signing out must continue even when sessionStorage is unavailable.
  }
}
