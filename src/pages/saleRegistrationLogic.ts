import { phoneDigits } from "../lib/phone";

export interface RepeatSettings {
  keepBusinessUnit: boolean;
  keepStaff: boolean;
  keepProduct: boolean;
  keepPaymentMethod: boolean;
}

export const defaultRepeatSettings: RepeatSettings = {
  keepBusinessUnit: true,
  keepStaff: true,
  keepProduct: false,
  keepPaymentMethod: false,
};

export interface QuickPartyRpcPayload {
  p_customer_name: string;
  p_phone: string;
  p_dog_name: string;
  p_breed: string | null;
}

export function buildQuickPartyRpcPayload({ customerName, phone, dogName, breed }: { customerName: string; phone: string; dogName: string; breed: string }): QuickPartyRpcPayload {
  return {
    p_customer_name: customerName.trim(),
    p_phone: phoneDigits(phone),
    p_dog_name: dogName.trim(),
    p_breed: breed.trim() || null,
  };
}

export function partySearchScore({ query, phoneQuery, dogName, customerName, phone }: { query: string; phoneQuery: string; dogName: string; customerName: string; phone: string }) {
  if (dogName === query) return 0;
  if (dogName.startsWith(query)) return 1;
  if (dogName.includes(query)) return 2;
  if (customerName === query) return 3;
  if (customerName.startsWith(query)) return 4;
  if (customerName.includes(query)) return 5;
  if (phoneQuery.length >= 3 && phone.includes(phoneQuery)) return 6;
  return 99;
}

export function missingSaleRequirement({ hasParty, businessUnitId, productId, paidAmount, staffId }: { hasParty: boolean; businessUnitId: string; productId: string; paidAmount: number; staffId: string }) {
  if (!hasParty) return "고객 또는 반려견을 선택해 주세요.";
  if (!businessUnitId) return "사업부를 선택해 주세요.";
  if (!productId) return "상품을 선택해 주세요.";
  if (!Number.isFinite(paidAmount) || paidAmount < 0) return "금액을 확인해 주세요.";
  if (!staffId) return "담당자를 선택해 주세요.";
  return "";
}

export function duplicateWarningLevel({ createdAt, saleDate, businessUnitId, paidAmount }: { createdAt: string; saleDate: string; businessUnitId: string; paidAmount: number }, current: { now: number; today: string; businessUnitId: string; paidAmount: number }) {
  const withinFiveMinutes = current.now - new Date(createdAt).getTime() <= 5 * 60 * 1000;
  if (withinFiveMinutes && businessUnitId === current.businessUnitId && paidAmount === current.paidAmount) return "strong" as const;
  if (saleDate === current.today) return "weak" as const;
  return null;
}

export interface ResettableSaleForm {
  saleDate: string;
  businessUnitId: string;
  customerId: string;
  dogId: string;
  categoryId: string;
  productId: string;
  originalAmount: number;
  discountAmount: number;
  paidAmount: number;
  refundAmount: number;
  outstandingAmount: number;
  paymentMethod: string;
  customerType: string;
  staffId: string;
  memo: string;
}

export function nextSaleForm(form: ResettableSaleForm, settings: RepeatSettings, options: { today: string; defaultStaffId: string; productDefaultPrice: number | null }): ResettableSaleForm {
  const keepProduct = settings.keepProduct && Boolean(form.productId) && options.productDefaultPrice !== null;
  return {
    saleDate: options.today,
    businessUnitId: keepProduct || settings.keepBusinessUnit ? form.businessUnitId : "",
    customerId: "",
    dogId: "",
    categoryId: keepProduct ? form.categoryId : "",
    productId: keepProduct ? form.productId : "",
    originalAmount: keepProduct ? options.productDefaultPrice ?? 0 : 0,
    discountAmount: 0,
    paidAmount: keepProduct ? options.productDefaultPrice ?? 0 : 0,
    refundAmount: 0,
    outstandingAmount: 0,
    paymentMethod: settings.keepPaymentMethod ? form.paymentMethod : "card",
    customerType: "new",
    staffId: settings.keepStaff ? form.staffId : options.defaultStaffId,
    memo: "",
  };
}
