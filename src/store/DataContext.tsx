import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AppData,
  Category,
  Customer,
  Pet,
  Product,
  Sale,
  Settings,
} from "../types";

type NewCategory = Omit<Category, "id">;
type NewProduct = Omit<Product, "id">;
type NewCustomer = Omit<Customer, "id">;
type NewPet = Omit<Pet, "id">;
type NewSale = Omit<Sale, "id" | "createdAt">;
interface DataValue extends AppData {
  addCategory: (v: NewCategory) => Category;
  updateCategory: (v: Category) => void;
  addProduct: (v: NewProduct) => Product;
  updateProduct: (v: Product) => void;
  addCustomer: (v: NewCustomer) => Customer;
  updateCustomer: (v: Customer) => void;
  addPet: (v: NewPet) => Pet;
  updatePet: (v: Pet) => void;
  addSale: (v: NewSale) => Sale;
  updateSale: (v: Sale) => void;
  updateSettings: (v: Settings) => void;
  resetData: () => void;
}
const emptyData = (): AppData => ({
  categories: [],
  products: [],
  customers: [],
  pets: [],
  sales: [],
  goals: [],
  settings: { companyName: "P&M", defaultGoal: 0, staff: [] },
});
const DataContext = createContext<DataValue | null>(null);
export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData);
  const api = useMemo<DataValue>(
    () => ({
      ...data,
      addCategory: (v) => {
        const n = { ...v, id: crypto.randomUUID() };
        setData((d) => ({ ...d, categories: [...d.categories, n] }));
        return n;
      },
      updateCategory: (v) =>
        setData((d) => ({
          ...d,
          categories: d.categories.map((x) => (x.id === v.id ? v : x)),
        })),
      addProduct: (v) => {
        const n = { ...v, id: crypto.randomUUID() };
        setData((d) => ({ ...d, products: [...d.products, n] }));
        return n;
      },
      updateProduct: (v) =>
        setData((d) => ({
          ...d,
          products: d.products.map((x) => (x.id === v.id ? v : x)),
        })),
      addCustomer: (v) => {
        const n = { ...v, id: crypto.randomUUID() };
        setData((d) => ({ ...d, customers: [...d.customers, n] }));
        return n;
      },
      updateCustomer: (v) =>
        setData((d) => ({
          ...d,
          customers: d.customers.map((x) => (x.id === v.id ? v : x)),
        })),
      addPet: (v) => {
        const n = { ...v, id: crypto.randomUUID() };
        setData((d) => ({ ...d, pets: [...d.pets, n] }));
        return n;
      },
      updatePet: (v) =>
        setData((d) => ({
          ...d,
          pets: d.pets.map((x) => (x.id === v.id ? v : x)),
        })),
      addSale: (v) => {
        const n = {
          ...v,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
        setData((d) => ({ ...d, sales: [n, ...d.sales] }));
        return n;
      },
      updateSale: (v) =>
        setData((d) => ({
          ...d,
          sales: d.sales.map((x) => (x.id === v.id ? v : x)),
        })),
      updateSettings: (v) => setData((d) => ({ ...d, settings: v })),
      resetData: () => setData(emptyData()),
    }),
    [data],
  );
  return <DataContext.Provider value={api}>{children}</DataContext.Provider>;
}
export function useData() {
  const v = useContext(DataContext);
  if (!v) throw new Error("DataProvider required");
  return v;
}
