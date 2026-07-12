import type {
  AppData,
  Category,
  Customer,
  Division,
  Pet,
  Product,
  Sale,
} from "../types";

const categories: Category[] = [
  { id: "c1", division: "유치원", name: "월권", active: true },
  { id: "c2", division: "유치원", name: "횟수권", active: true },
  { id: "c3", division: "유치원", name: "픽드랍", active: true },
  { id: "c4", division: "교육센터", name: "행동교정", active: true },
  { id: "c5", division: "교육센터", name: "그룹레슨", active: true },
  { id: "c6", division: "교육센터", name: "전문가과정", active: false },
  { id: "c7", division: "호텔", name: "호텔링", active: true },
  { id: "c8", division: "호텔", name: "장기호텔", active: true },
];
const products: Product[] = [
  {
    id: "p1",
    division: "유치원",
    categoryId: "c1",
    name: "유치원 월 12회",
    defaultPrice: 480000,
    active: true,
    memo: "",
  },
  {
    id: "p2",
    division: "유치원",
    categoryId: "c2",
    name: "유치원 10회권",
    defaultPrice: 420000,
    active: true,
    memo: "",
  },
  {
    id: "p3",
    division: "유치원",
    categoryId: "c3",
    name: "픽드랍 월 이용권",
    defaultPrice: 180000,
    active: true,
    memo: "왕복 기준",
  },
  {
    id: "p4",
    division: "교육센터",
    categoryId: "c4",
    name: "1:1 행동교정 4회",
    defaultPrice: 600000,
    active: true,
    memo: "",
  },
  {
    id: "p5",
    division: "교육센터",
    categoryId: "c5",
    name: "그룹레슨 8회",
    defaultPrice: 360000,
    active: true,
    memo: "",
  },
  {
    id: "p6",
    division: "교육센터",
    categoryId: "c6",
    name: "전문가 기초과정",
    defaultPrice: 1500000,
    active: false,
    memo: "모집 종료",
  },
  {
    id: "p7",
    division: "호텔",
    categoryId: "c7",
    name: "호텔 1박",
    defaultPrice: 70000,
    active: true,
    memo: "",
  },
  {
    id: "p8",
    division: "호텔",
    categoryId: "c8",
    name: "호텔 10박",
    defaultPrice: 630000,
    active: true,
    memo: "",
  },
];
const names = [
  "김민지",
  "이서준",
  "박지우",
  "최도윤",
  "정하윤",
  "강서연",
  "조예준",
  "윤지민",
  "장시우",
  "임수아",
  "한준호",
  "오채원",
];
const petNames = [
  "몽이",
  "보리",
  "콩이",
  "두부",
  "코코",
  "별이",
  "해피",
  "루루",
  "초코",
  "호두",
  "구름",
  "마루",
];
const customers: Customer[] = names.map((name, i) => ({
  id: `u${i + 1}`,
  name,
  phone: `010-${String(2100 + i * 137).slice(-4)}-${String(4312 + i * 211).slice(-4)}`,
  memo: i === 2 ? "전화보다 문자 선호" : "",
  createdAt: `2025-${String((i % 10) + 1).padStart(2, "0")}-05`,
}));
const pets: Pet[] = petNames.map((name, i) => ({
  id: `d${i + 1}`,
  customerId: `u${i + 1}`,
  name,
  breed: ["푸들", "말티즈", "비숑", "포메라니안", "믹스"][i % 5],
  birthDate: `202${i % 5}-0${(i % 8) + 1}-12`,
  sex: (i % 2 === 0 ? "수컷" : "암컷") as "수컷" | "암컷",
  weight: 3.5 + (i % 6) * 1.2,
  memo: i === 4 ? "낯선 개 주의" : "",
}));

const today = new Date();
const divisions: Division[] = ["유치원", "교육센터", "호텔"];
const methods = ["카드", "계좌이체", "현금", "미수"] as const;
const staff = ["김하늘", "이도현", "박소연", "최민준"];
const sales: Sale[] = [];
for (let offset = 11; offset >= 0; offset--) {
  const base = new Date(today.getFullYear(), today.getMonth() - offset, 1);
  for (let i = 0; i < 14; i++) {
    const division = divisions[(i + offset) % 3];
    const possible = products.filter(
      (p) => p.division === division && p.active,
    );
    const product = possible[i % possible.length];
    const discount = i % 5 === 0 ? Math.round(product.defaultPrice * 0.1) : 0;
    const payment = product.defaultPrice - discount;
    const isFullRefund = i === 11 && offset % 4 === 0;
    const refund = isFullRefund
      ? payment
      : i === 7 && offset % 3 === 0
        ? Math.round(payment * 0.3)
        : 0;
    const receivable =
      i === 9 && offset % 2 === 0 ? Math.round(payment * 0.25) : 0;
    const status = isFullRefund
      ? "전체환불"
      : refund
        ? "부분환불"
        : i === 12 && offset % 5 === 0
          ? "취소"
          : receivable
            ? "미수"
            : "완료";
    const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(2 + ((i * 2) % 26)).padStart(2, "0")}`;
    sales.push({
      id: `s${offset}-${i}`,
      date,
      division,
      customerId: `u${((i + offset) % customers.length) + 1}`,
      petId: `d${((i + offset) % pets.length) + 1}`,
      categoryId: product.categoryId,
      productId: product.id,
      listPrice: product.defaultPrice,
      discount,
      payment,
      refund,
      receivable,
      paymentMethod: receivable ? "미수" : methods[i % 3],
      kind: i % 3 === 0 ? "신규" : "재등록",
      staff: staff[i % staff.length],
      memo: i === 5 ? "현장 할인 적용" : "",
      status,
      createdAt: `${date}T${String(9 + (i % 8)).padStart(2, "0")}:00:00`,
    });
  }
}

const ym = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const sampleData: AppData = {
  categories,
  products,
  customers,
  pets,
  sales,
  goals: Array.from({ length: 12 }, (_, i) => ({
    month: ym(new Date(today.getFullYear(), today.getMonth() - i, 1)),
    amount: 16000000 + i * 150000,
  })),
  settings: { companyName: "P&M", defaultGoal: 16000000, staff },
};
