import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Printer } from "lucide-react";
import { useData } from "../store/DataContext";
import { currentMonth, monthLabel, net, shortWon, won } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
} from "../components/ui";

const COLORS = ["#274c77", "#6f8eae", "#a8b9ca"];
const monthOf = (date: string) => date.slice(0, 7);

function useMetrics(month: string) {
  const d = useData();
  return useMemo(() => {
    const valid = d.sales.filter((s) => s.status !== "취소");
    const current = valid.filter((s) => monthOf(s.date) === month);
    const md = new Date(`${month}-01`);
    md.setMonth(md.getMonth() - 1);
    const prevKey = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, "0")}`;
    const prev = valid.filter((s) => monthOf(s.date) === prevKey);
    const total = (arr: typeof current) =>
      arr.reduce((a, s) => a + s.payment, 0);
    const real = (arr: typeof current) =>
      arr.reduce(
        (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
        0,
      );
    const totalValue = total(current),
      realValue = real(current),
      prevValue = real(prev),
      diff = realValue - prevValue,
      goal =
        d.goals.find((g) => g.month === month)?.amount ||
        d.settings.defaultGoal;
    const divisions = ["유치원", "교육센터", "호텔"].map((name) => ({
      name,
      value: real(current.filter((s) => s.division === name)),
    }));
    const productRank = Object.values(
      current.reduce<
        Record<string, { name: string; value: number; count: number }>
      >((a, s) => {
        const name =
          d.products.find((p) => p.id === s.productId)?.name || "알 수 없음";
        a[s.productId] ??= { name, value: 0, count: 0 };
        a[s.productId].value += net(
          s.payment,
          s.refund,
          s.receivable,
          s.status,
        );
        a[s.productId].count++;
        return a;
      }, {}),
    ).sort((a, b) => b.value - a.value);
    return {
      current,
      totalValue,
      realValue,
      prevValue,
      diff,
      rate: prevValue ? (diff / prevValue) * 100 : 0,
      goal,
      achievement: goal ? (realValue / goal) * 100 : 0,
      divisions,
      productRank,
      discount: current.reduce((a, s) => a + s.discount, 0),
      refund: current.reduce((a, s) => a + s.refund, 0),
      receivable: current.reduce((a, s) => a + s.receivable, 0),
      newSales: real(current.filter((s) => s.kind === "신규")),
      renewSales: real(current.filter((s) => s.kind === "재등록")),
    };
  }, [d, month]);
}

const MoneyTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
}) =>
  active && payload?.length ? (
    <div className="rounded-lg border bg-white p-3 text-xs shadow">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p, i) => (
        <p key={i}>
          {p.name}: {won(p.value)}
        </p>
      ))}
    </div>
  ) : null;
function Kpi({
  label,
  value,
  sub,
  tone,
  progress,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
  progress?: number;
}) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        {value}
      </p>
      {progress !== undefined && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[#274c77]"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {sub && (
        <p
          className={`mt-2 text-xs ${tone === "up" ? "text-blue-700" : tone === "down" ? "text-red-600" : "text-slate-500"}`}
        >
          {sub}
        </p>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const d = useData();
  const [month, setMonth] = useState(currentMonth());
  const m = useMetrics(month);
  const months = Array.from(new Set(d.sales.map((s) => monthOf(s.date))))
    .sort()
    .reverse();
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = d.sales.filter(
    (s) => s.date === today && s.status !== "취소",
  );
  const todaySales = todayRows.reduce(
    (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
    0,
  );
  const trend = months
    .slice(0, 12)
    .reverse()
    .map((key) => {
      const rows = d.sales.filter(
        (s) => monthOf(s.date) === key && s.status !== "취소",
      );
      return {
        month: key.slice(2).replace("-", "."),
        총매출: rows.reduce((a, s) => a + s.payment, 0),
        유치원: rows
          .filter((s) => s.division === "유치원")
          .reduce(
            (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
            0,
          ),
        교육센터: rows
          .filter((s) => s.division === "교육센터")
          .reduce(
            (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
            0,
          ),
        호텔: rows
          .filter((s) => s.division === "호텔")
          .reduce(
            (a, s) => a + net(s.payment, s.refund, s.receivable, s.status),
            0,
          ),
      };
    });
  return (
    <>
      <PageHeader
        title="대시보드"
        description="대표 핵심 매출 현황을 우선 확인합니다."
        action={
          <div className="w-44">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((x) => (
                <option key={x} value={x}>
                  {monthLabel(x)}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="총매출"
          value={won(m.totalValue)}
          sub={`환불 ${won(m.refund)} · 미수 ${won(m.receivable)}`}
        />
        <Kpi
          label="실매출"
          value={won(m.realValue)}
          sub="결제에서 환불·미수 제외"
        />
        <Kpi
          label="목표 달성률"
          value={`${m.achievement.toFixed(1)}%`}
          sub={`목표 ${won(m.goal)}`}
          progress={m.achievement}
        />
        <Kpi
          label="전월 대비 증감"
          value={`${m.diff >= 0 ? "+" : ""}${won(m.diff)}`}
          sub={`${m.rate >= 0 ? "▲" : "▼"} ${Math.abs(m.rate).toFixed(1)}%`}
          tone={m.diff >= 0 ? "up" : "down"}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {m.divisions.map((x) => (
          <Kpi key={x.name} label={x.name} value={won(x.value)} />
        ))}
        <Kpi label="오늘 매출" value={won(todaySales)} />
        <Kpi label="오늘 등록 건수" value={`${todayRows.length}건`} />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ChartCard title="최근 12개월 총매출 추이">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={shortWon} />
              <Tooltip content={<MoneyTooltip />} />
              <Line
                type="monotone"
                dataKey="총매출"
                stroke="#274c77"
                strokeWidth={3}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="사업부별 매출 추이">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={shortWon} />
              <Tooltip content={<MoneyTooltip />} />
              <Legend />
              <Line dataKey="유치원" stroke={COLORS[0]} strokeWidth={2} />
              <Line dataKey="교육센터" stroke={COLORS[1]} strokeWidth={2} />
              <Line dataKey="호텔" stroke={COLORS[2]} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="선택 월 사업부별 매출 비중">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={m.divisions}
                dataKey="value"
                nameKey="name"
                innerRadius={65}
                outerRadius={95}
                label={({ name, percent = 0 }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
              >
                {m.divisions.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
              <Tooltip content={<MoneyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="신규·재등록 매출 비교">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={[
                { name: "신규", 매출: m.newSales },
                { name: "재등록", 매출: m.renewSales },
              ]}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={shortWon} />
              <Tooltip content={<MoneyTooltip />} />
              <Bar dataKey="매출" fill="#274c77" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1.35fr]">
        <Card>
          <h2 className="border-b px-5 py-4 font-bold">상품별 매출 순위</h2>
          <div className="divide-y">
            {m.productRank.slice(0, 6).map((x, i) => (
              <div key={x.name} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-100 text-xs font-bold">
                  {i + 1}
                </span>
                <span className="flex-1 text-sm font-medium">{x.name}</span>
                <span className="text-sm font-bold">{won(x.value)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <h2 className="border-b px-5 py-4 font-bold">최근 등록 매출</h2>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>고객</th>
                  <th>상품</th>
                  <th>구분</th>
                  <th className="text-right">실매출</th>
                </tr>
              </thead>
              <tbody>
                {[...m.current]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 6)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{s.date.slice(5).replace("-", ".")}</td>
                      <td>
                        {d.customers.find((x) => x.id === s.customerId)?.name}
                      </td>
                      <td>
                        {d.products.find((x) => x.id === s.productId)?.name}
                      </td>
                      <td>
                        <Badge tone={s.kind === "신규" ? "blue" : "green"}>
                          {s.kind}
                        </Badge>
                      </td>
                      <td className="text-right font-semibold">
                        {won(net(s.payment, s.refund, s.receivable, s.status))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-5 font-bold">{title}</h2>
      {children}
    </Card>
  );
}

export function ReportsPage() {
  const d = useData();
  const [month, setMonth] = useState(currentMonth());
  const m = useMetrics(month);
  const months = Array.from(new Set(d.sales.map((s) => monthOf(s.date))))
    .sort()
    .reverse();
  const payment = Object.entries(
    m.current.reduce<Record<string, number>>(
      (a, s) => (
        (a[s.paymentMethod] =
          (a[s.paymentMethod] || 0) +
          net(s.payment, s.refund, s.receivable, s.status)),
        a
      ),
      {},
    ),
  ).map(([name, value]) => ({ name, value }));
  const staff = Object.entries(
    m.current.reduce<Record<string, number>>(
      (a, s) => (
        (a[s.staff] =
          (a[s.staff] || 0) + net(s.payment, s.refund, s.receivable, s.status)),
        a
      ),
      {},
    ),
  ).map(([name, value]) => ({ name, value }));
  return (
    <div className="print:p-0">
      <PageHeader
        title="월별 보고서"
        description="월별 성과를 조회하고 인쇄할 수 있습니다."
        action={
          <div className="no-print flex gap-2">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={17} />
              인쇄
            </Button>
          </div>
        }
      />
      <div className="mb-5 hidden print:block">
        <h1 className="text-2xl font-bold">
          P&M {monthLabel(month)} 매출 보고서
        </h1>
        <p className="text-sm text-slate-500">
          출력일 {new Date().toLocaleDateString("ko-KR")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="총매출" value={won(m.totalValue)} />
        <Kpi label="실매출" value={won(m.realValue)} />
        <Kpi label="할인 금액" value={won(m.discount)} />
        <Kpi label="환불 금액" value={won(m.refund)} />
        <Kpi label="미수금" value={won(m.receivable)} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ChartCard title="사업부별 매출">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={m.divisions}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={shortWon} />
              <Tooltip content={<MoneyTooltip />} />
              <Bar
                dataKey="value"
                name="매출"
                fill="#274c77"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="신규·재등록 매출">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={[
                { name: "신규", value: m.newSales },
                { name: "재등록", value: m.renewSales },
              ]}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={shortWon} />
              <Tooltip content={<MoneyTooltip />} />
              <Bar
                dataKey="value"
                name="매출"
                fill="#6f8eae"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <Rank title="상품별 매출 순위" rows={m.productRank} />
        <Rank title="결제 수단별 매출" rows={payment} />
        <Rank title="담당자별 등록 매출" rows={staff} />
        <Card className="p-5">
          <h2 className="font-bold">성과 요약</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt>전월 대비 증감</dt>
              <dd className="font-bold">
                {m.diff >= 0 ? "+" : ""}
                {won(m.diff)} ({m.rate.toFixed(1)}%)
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>목표 매출</dt>
              <dd>{won(m.goal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>목표 달성률</dt>
              <dd className="font-bold">{m.achievement.toFixed(1)}%</dd>
            </div>
          </dl>
        </Card>
      </div>
      {!m.current.length && <EmptyState />}
    </div>
  );
}
function Rank({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; value: number }>;
}) {
  return (
    <Card>
      <h2 className="border-b px-5 py-4 font-bold">{title}</h2>
      <div className="divide-y">
        {rows.slice(0, 6).map((x, i) => (
          <div className="flex justify-between px-5 py-3 text-sm" key={x.name}>
            <span>
              {i + 1}. {x.name}
            </span>
            <b>{won(x.value)}</b>
          </div>
        ))}
      </div>
    </Card>
  );
}
