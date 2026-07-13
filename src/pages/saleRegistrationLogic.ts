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

export interface SaleReferenceSnapshot {
  customerName: string | null;
  customerPhone: string | null;
  dogName: string | null;
}

export function buildQuickPartyRpcPayload({
  customerName,
  phone,
  dogName,
  breed,
}: {
  customerName: string;
  phone: string;
  dogName: string;
  breed: string;
}): QuickPartyRpcPayload {
  return {
    p_customer_name: customerName.trim(),
    p_phone: phoneDigits(phone),
    p_dog_name: dogName.trim(),
    p_breed: breed.trim() || null,
  };
}

export function normalizeSaleReference({
  customerName,
  phone,
  dogName,
}: {
  customerName: string;
  phone: string;
  dogName: string;
}): SaleReferenceSnapshot {
  return {
    customerName: customerName.trim() || null,
    customerPhone: phoneDigits(phone) || null,
    dogName: dogName.trim() || null,
  };
}

export function normalizeProductName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko");
}

export function normalizeQuantity(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

export function parseCurrencyInput(
  value: string,
  max = Number.MAX_SAFE_INTEGER,
) {
  const digits = value.replace(/[^0-9]/g, "");
  return Math.min(Number(digits || 0), Math.max(0, Math.trunc(max)));
}

export function recentProductIdsForUser(
  sales: Array<{
    productId: string;
    createdBy: string;
    status: string;
  }>,
  userId: string | null | undefined,
  limit = 8,
) {
  if (!userId || limit <= 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sale of sales) {
    if (
      sale.createdBy !== userId ||
      sale.status === "cancelled" ||
      seen.has(sale.productId)
    )
      continue;
    seen.add(sale.productId);
    result.push(sale.productId);
    if (result.length >= limit) break;
  }
  return result;
}

export function calculateGrossAmount(unitPrice: number, quantity: number) {
  const safeUnitPrice = Number.isFinite(unitPrice)
    ? Math.max(0, Math.trunc(unitPrice))
    : 0;
  return safeUnitPrice * normalizeQuantity(quantity);
}

export function calculateFinalSaleAmount(
  originalAmount: number,
  additionalAmount: number,
  discountAmount: number,
) {
  return Math.max(
    0,
    Math.trunc(originalAmount) +
      Math.trunc(additionalAmount) -
      Math.trunc(discountAmount),
  );
}

export function calculateOutstandingAmount(
  finalSaleAmount: number,
  paidAmount: number,
) {
  return Math.max(0, Math.trunc(finalSaleAmount) - Math.trunc(paidAmount));
}

export function calculatePricingChange({
  unitPrice,
  quantity,
  additionalAmount = 0,
  discountAmount = 0,
  paidAmount,
  paidAmountEdited,
}: {
  unitPrice: number;
  quantity: number;
  additionalAmount?: number;
  discountAmount?: number;
  paidAmount: number;
  paidAmountEdited: boolean;
}) {
  const nextQuantity = normalizeQuantity(quantity);
  const originalAmount = calculateGrossAmount(unitPrice, nextQuantity);
  const finalSaleAmount = calculateFinalSaleAmount(
    originalAmount,
    additionalAmount,
    discountAmount,
  );
  const nextPaidAmount = paidAmountEdited ? paidAmount : finalSaleAmount;
  return {
    quantity: nextQuantity,
    unitPrice: Math.max(0, Math.trunc(unitPrice || 0)),
    originalAmount,
    paidAmount: nextPaidAmount,
    outstandingAmount: calculateOutstandingAmount(
      finalSaleAmount,
      nextPaidAmount,
    ),
  };
}

export function isValidPaymentPlan({
  originalAmount,
  additionalAmount = 0,
  discountAmount,
  paidAmount,
  outstandingAmount,
}: {
  originalAmount: number;
  additionalAmount?: number;
  discountAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}) {
  const finalSaleAmount = calculateFinalSaleAmount(
    originalAmount,
    additionalAmount,
    discountAmount,
  );
  return paidAmount + outstandingAmount <= finalSaleAmount;
}

export function isBalancedPaymentPlan({
  originalAmount,
  additionalAmount = 0,
  discountAmount,
  paidAmount,
  outstandingAmount,
}: {
  originalAmount: number;
  additionalAmount?: number;
  discountAmount: number;
  paidAmount: number;
  outstandingAmount: number;
}) {
  const finalSaleAmount = calculateFinalSaleAmount(
    originalAmount,
    additionalAmount,
    discountAmount,
  );
  return (
    paidAmount <= finalSaleAmount &&
    paidAmount + outstandingAmount === finalSaleAmount
  );
}

export function hasProductNameDuplicate(
  products: { businessUnitId: string; name: string }[],
  businessUnitId: string,
  name: string,
) {
  const normalizedName = normalizeProductName(name);
  return (
    Boolean(normalizedName) &&
    products.some(
      (product) =>
        product.businessUnitId === businessUnitId &&
        normalizeProductName(product.name) === normalizedName,
    )
  );
}

export function hasCategoryNameDuplicate(
  categories: { businessUnitId: string; name: string }[],
  businessUnitId: string,
  name: string,
) {
  const normalizedName = normalizeProductName(name);
  return (
    Boolean(normalizedName) &&
    categories.some(
      (category) =>
        category.businessUnitId === businessUnitId &&
        normalizeProductName(category.name) === normalizedName,
    )
  );
}

export function suggestUnitLabel({
  businessUnitName,
  categoryName,
  productName,
}: {
  businessUnitName: string;
  categoryName?: string;
  productName?: string;
}) {
  const source = normalizeProductName(
    `${categoryName ?? ""} ${productName ?? ""}`,
  );
  if (/(용품|사료|간식|패드|장난감)/.test(source)) return "개";
  if (businessUnitName.includes("호텔") || source.includes("호텔")) return "박";
  if (
    businessUnitName.includes("유치원") ||
    businessUnitName.includes("교육") ||
    /(레슨|수업|교육|유치원)/.test(source)
  )
    return "회";
  return "";
}

export function isProductScopeValid(
  product: { businessUnitId: string; categoryId: string | null } | undefined,
  businessUnitId: string,
  categoryId: string,
) {
  return (
    Boolean(product) &&
    product?.businessUnitId === businessUnitId &&
    (product.categoryId ?? "") === categoryId
  );
}

export function partySearchScore({
  query,
  phoneQuery,
  dogName,
  customerName,
  phone,
}: {
  query: string;
  phoneQuery: string;
  dogName: string;
  customerName: string;
  phone: string;
}) {
  if (dogName === query) return 0;
  if (dogName.startsWith(query)) return 1;
  if (dogName.includes(query)) return 2;
  if (customerName === query) return 3;
  if (customerName.startsWith(query)) return 4;
  if (customerName.includes(query)) return 5;
  if (phoneQuery.length >= 3 && phone.includes(phoneQuery)) return 6;
  return 99;
}

export function missingSaleRequirement({
  businessUnitId,
  productId,
  originalAmount,
  paidAmount,
  outstandingAmount,
  staffId,
}: {
  businessUnitId: string;
  productId: string;
  originalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  staffId: string;
}) {
  if (!businessUnitId) return "사업부를 선택해 주세요.";
  if (!productId) return "상품을 선택해 주세요.";
  if (!Number.isFinite(originalAmount) || originalAmount <= 0)
    return "판매 금액을 입력해 주세요.";
  if (
    ![paidAmount, outstandingAmount].every(
      (amount) => Number.isFinite(amount) && amount >= 0,
    ) ||
    paidAmount + outstandingAmount <= 0
  )
    return "결제 금액 또는 미수금을 입력해 주세요.";
  if (!staffId) return "담당자를 선택해 주세요.";
  return "";
}

export function duplicateWarningLevel(
  {
    createdAt,
    saleDate,
    businessUnitId,
    paidAmount,
  }: {
    createdAt: string;
    saleDate: string;
    businessUnitId: string;
    paidAmount: number;
  },
  current: {
    now: number;
    today: string;
    businessUnitId: string;
    paidAmount: number;
  },
) {
  const withinFiveMinutes =
    current.now - new Date(createdAt).getTime() <= 5 * 60 * 1000;
  if (
    withinFiveMinutes &&
    businessUnitId === current.businessUnitId &&
    paidAmount === current.paidAmount
  )
    return "strong" as const;
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

export function nextSaleForm(
  form: ResettableSaleForm,
  settings: RepeatSettings,
  options: {
    today: string;
    defaultStaffId: string;
    productDefaultPrice: number | null;
  },
): ResettableSaleForm {
  const keepProduct =
    settings.keepProduct &&
    Boolean(form.productId) &&
    options.productDefaultPrice !== null;
  return {
    saleDate: options.today,
    businessUnitId:
      keepProduct || settings.keepBusinessUnit ? form.businessUnitId : "",
    customerId: "",
    dogId: "",
    categoryId: keepProduct ? form.categoryId : "",
    productId: keepProduct ? form.productId : "",
    quantity: 1,
    unitPrice: keepProduct ? (options.productDefaultPrice ?? 0) : 0,
    originalAmount: keepProduct ? (options.productDefaultPrice ?? 0) : 0,
    additionalAmount: 0,
    discountAmount: 0,
    paidAmount: keepProduct ? (options.productDefaultPrice ?? 0) : 0,
    refundAmount: 0,
    outstandingAmount: 0,
    adjustmentNote: "",
    paymentMethod: settings.keepPaymentMethod ? form.paymentMethod : "card",
    customerType: "new",
    staffId: settings.keepStaff ? form.staffId : options.defaultStaffId,
    memo: "",
  };
}
