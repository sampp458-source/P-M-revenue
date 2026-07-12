export type Division = "유치원" | "교육센터" | "호텔";
export type SaleKind = "신규" | "재등록";
export type SaleStatus = "완료" | "부분환불" | "전체환불" | "취소" | "미수";
export type PaymentMethod = "카드" | "계좌이체" | "현금" | "미수";

export interface Category {
  id: string;
  division: Division;
  name: string;
  active: boolean;
}
export interface Product {
  id: string;
  division: Division;
  categoryId: string;
  name: string;
  defaultPrice: number;
  active: boolean;
  memo: string;
}
export interface Pet {
  id: string;
  customerId: string;
  name: string;
  breed: string;
  birthDate: string;
  sex?: "수컷" | "암컷" | "";
  weight?: number;
  memo: string;
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
  memo: string;
  createdAt: string;
}
export interface Sale {
  id: string;
  date: string;
  division: Division;
  customerId: string;
  petId: string;
  categoryId: string;
  productId: string;
  listPrice: number;
  discount: number;
  payment: number;
  refund: number;
  receivable: number;
  paymentMethod: PaymentMethod;
  kind: SaleKind;
  staff: string;
  memo: string;
  status: SaleStatus;
  createdAt: string;
}
export interface Goal {
  month: string;
  amount: number;
}
export interface Settings {
  companyName: string;
  defaultGoal: number;
  staff: string[];
}
export interface AppData {
  categories: Category[];
  products: Product[];
  customers: Customer[];
  pets: Pet[];
  sales: Sale[];
  goals: Goal[];
  settings: Settings;
}
