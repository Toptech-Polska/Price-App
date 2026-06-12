import { useState, useMemo } from "react";
import { format, differenceInDays, isWithinInterval, startOfDay, endOfDay, subMonths, eachMonthOfInterval, startOfMonth, endOfMonth } from "date-fns";
import { pl } from "date-fns/locale";
import {
  ArrowLeft, TrendingUp, TrendingDown, AlertTriangle, ExternalLink,
  DollarSign, Package, BarChart3, Clock, Download, FileText, FileSpreadsheet, CalendarIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import type { DateRange } from "react-day-picker";
import * as XLSX from "xlsx";

const PRODIO_BASE = "https://toptech.getprodio.com/app/product/view/";
const ENDANGERED_DAYS = 45;

const formatCurrency = (v: number) =>
  v.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCompact = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
};

const ProdioLink = ({ name, productId }: { name: string; productId?: string }) => {
  if (!productId) return <span className="text-foreground">{name}</span>;
  return (
    <a href={`${PRODIO_BASE}${productId}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline font-medium" title="Otwórz w Prodio">
      {name}<ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
    </a>
  );
};

interface ClientDrilldownProps {
  clientName: string;
  orders: any[];
  dateRange: DateRange | undefined;
  onBack: () => void;
}

const ClientDrilldown = ({ clientName, orders: rawOrders, dateRange: initialDateRange, onBack }: ClientDrilldownProps) => {
  const orders = rawOrders ?? [];
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
  const productIdMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      const name = (o.product_name ?? "").trim();
      const pid = o.product_id || o.prodio_id;
      if (name && pid && !map.has(name)) map.set(name, pid);
    }
    return map;
  }, [orders]);

  const clientOrders = useMemo(() => {
    return orders.filter((o) => (o.client_name ?? "").trim() === clientName);
  }, [orders, clientName]);

  const filteredOrders = useMemo(() => {
    return clientOrders.filter((o) => {
      if (dateRange?.from && dateRange?.to && o.order_date) {
        const d = new Date(o.order_date);
        if (!isWithinInterval(d, { start: startOfDay(dateRange.from), end: endOfDay(dateRange.to) })) return false;
      }
      return true;
    });
  }, [clientOrders, dateRange]);

  /* ── Monthly Trendline ── */
  const trendData = useMemo(() => {
    // Build month map from filtered orders
    const monthMap = new Map<string, { revenue: number; count: number }>();
    for (const o of filteredOrders) {
      if (!o.order_date) continue;
      const d = new Date(o.order_date);
      const key = format(d, "yyyy-MM");
      const price = Number(o.price) || 0;
      const qty = Number(o.quantity) || 0;
      const existing = monthMap.get(key) || { revenue: 0, count: 0 };
      existing.revenue += price * qty;
      existing.count += 1;
      monthMap.set(key, existing);
    }

    // Determine range for zero-filling
    let rangeFrom: Date;
    let rangeTo: Date;
    if (dateRange?.from && dateRange?.to) {
      rangeFrom = dateRange.from;
      rangeTo = dateRange.to;
    } else if (dateRange?.from) {
      rangeFrom = dateRange.from;
      rangeTo = new Date();
    } else {
      // Use full client history range
      const allDates = filteredOrders
        .filter((o) => o.order_date)
        .map((o) => new Date(o.order_date));
      if (allDates.length === 0) return [];
      rangeFrom = new Date(Math.min(...allDates.map((d) => d.getTime())));
      rangeTo = new Date(Math.max(...allDates.map((d) => d.getTime())));
    }

    // Generate continuous months
    const months = eachMonthOfInterval({ start: startOfMonth(rangeFrom), end: endOfMonth(rangeTo) });
    return months.map((m) => {
      const key = format(m, "yyyy-MM");
      const data = monthMap.get(key) || { revenue: 0, count: 0 };
      return {
        month: format(m, "MMM yy", { locale: pl }),
        revenue: data.revenue,
        orders: data.count,
      };
    });
  }, [filteredOrders, dateRange]);

  /* ── Alert: >20% drop ── */
  const trendAlert = useMemo(() => {
    if (trendData.length < 2) return null;
    const last = trendData[trendData.length - 1];
    const prev = trendData[trendData.length - 2];
    const change = prev.revenue > 0 ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : 0;
    return change < -20 ? change : null;
  }, [trendData]);

  /* ── KPIs ── */
  const kpis = useMemo(() => {
    let revenue = 0, volume = 0;
    for (const o of filteredOrders) {
      const p = Number(o.price) || 0;
      const q = Number(o.quantity) || 0;
      revenue += p * q;
      volume += q;
    }
    return { revenue, volume, count: filteredOrders.length, aov: filteredOrders.length > 0 ? revenue / filteredOrders.length : 0 };
  }, [filteredOrders]);

  /* ── TOP 10 ── */
  const top10 = useMemo(() => {
    const valueMap = new Map<string, number>();
    const volumeMap = new Map<string, number>();
    for (const o of filteredOrders) {
      const name = (o.product_name ?? "").trim();
      if (!name) continue;
      const p = Number(o.price) || 0;
      const q = Number(o.quantity) || 0;
      valueMap.set(name, (valueMap.get(name) || 0) + p * q);
      volumeMap.set(name, (volumeMap.get(name) || 0) + q);
    }
    const topValue = Array.from(valueMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, value]) => ({ name: name.length > 25 ? name.slice(0, 22) + "…" : name, value, fullName: name, productId: productIdMap.get(name) }));
    const topVolume = Array.from(volumeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, volume]) => ({ name: name.length > 25 ? name.slice(0, 22) + "…" : name, volume, fullName: name, productId: productIdMap.get(name) }));
    return { topValue, topVolume };
  }, [filteredOrders, productIdMap]);

  /* ── Product Rotation / Endangered ── */
  const rotationData = useMemo(() => {
    const productOrders = new Map<string, string[]>();
    for (const o of clientOrders) {
      const name = (o.product_name ?? "").trim();
      if (!name || !o.order_date) continue;
      const existing = productOrders.get(name) || [];
      existing.push(o.order_date);
      productOrders.set(name, existing);
    }

    const today = new Date();
    const results: {
      name: string; orderCount: number; avgInterval: number; lastOrder: Date;
      daysSinceLast: number; isEndangered: boolean; productId?: string;
    }[] = [];

    for (const [name, dates] of productOrders) {
      if (dates.length < 2) continue;
      const sorted = dates.sort();
      let totalGap = 0;
      for (let i = 1; i < sorted.length; i++) {
        totalGap += differenceInDays(new Date(sorted[i]), new Date(sorted[i - 1]));
      }
      const avgInterval = Math.round(totalGap / (sorted.length - 1));
      const lastOrder = new Date(sorted[sorted.length - 1]);
      const daysSinceLast = differenceInDays(today, lastOrder);
      const isEndangered = dates.length >= 3 && daysSinceLast > ENDANGERED_DAYS && daysSinceLast > avgInterval;

      results.push({ name, orderCount: dates.length, avgInterval, lastOrder, daysSinceLast, isEndangered, productId: productIdMap.get(name) });
    }

    return results.sort((a, b) => b.isEndangered ? 1 : a.isEndangered ? -1 : b.orderCount - a.orderCount);
  }, [clientOrders, productIdMap]);

  const endangeredProducts = rotationData.filter((p) => p.isEndangered);

  /* ── Export ── */
  const handleExportExcel = () => {
    const rows = filteredOrders.map((o) => ({
      "Data": o.order_date ? format(new Date(o.order_date), "yyyy-MM-dd") : "",
      "Produkt": o.product_name ?? "",
      "Cena": Number(o.price) || 0,
      "Ilość": Number(o.quantity) || 0,
      "Wartość": (Number(o.price) || 0) * (Number(o.quantity) || 0),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, clientName.slice(0, 30));
    XLSX.writeFile(wb, `Toptech_${clientName.replace(/\s+/g, "_")}.xlsx`);
  };

  const barTooltip = (type: "value" | "volume") => (props: any) => {
    const { active, payload } = props;
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    const val = type === "value" ? `${formatCurrency(data.value)} PLN` : `${data.volume?.toLocaleString("pl-PL")} szt.`;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-md text-xs space-y-1">
        <ProdioLink name={data.fullName} productId={data.productId} />
        <p className="text-muted-foreground">{val}</p>
      </div>
    );
  };

  const dateRangeLabel = dateRange?.from && dateRange?.to
    ? `${format(dateRange.from, "dd MMM yyyy", { locale: pl })} – ${format(dateRange.to, "dd MMM yyyy", { locale: pl })}`
    : dateRange?.from
      ? `Od ${format(dateRange.from, "dd MMM yyyy", { locale: pl })}`
      : "Cały okres";

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Powrót
        </Button>
        <h2 className="text-xl font-bold text-foreground">{clientName}</h2>
        <div className="flex-1" />

        {/* DateRangePicker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-10 rounded-md text-sm justify-start min-w-[240px]", !dateRange?.from && "text-muted-foreground")}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {dateRangeLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              locale={pl}
              className="p-3 pointer-events-auto"
            />
            {dateRange?.from && (
              <div className="border-t px-3 py-2">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDateRange(undefined)}>
                  Wyczyść daty
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 rounded-md gap-1.5">
              <Download className="h-4 w-4" /> Eksportuj
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.print()} className="gap-2 cursor-pointer"><FileText className="h-4 w-4" /> PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportExcel} className="gap-2 cursor-pointer"><FileSpreadsheet className="h-4 w-4" /> Excel</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Print header */}
      <div className="hidden print:block print:mb-6">
        <h1 className="text-2xl font-bold">Toptech Polska — {clientName}</h1>
      </div>

      {/* ── Alert ── */}
      {trendAlert !== null && (
        <Alert variant="destructive">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle>Spadek obrotów: {Math.abs(trendAlert).toFixed(1)}%</AlertTitle>
          <AlertDescription>Obroty klienta spadły o ponad 20% w ostatnim miesiącu względem poprzedniego. Zalecany kontakt handlowy.</AlertDescription>
        </Alert>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" /> Obrót</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-foreground">{formatCurrency(kpis.revenue)} PLN</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Package className="h-4 w-4 text-primary" /> Wolumen</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-foreground">{kpis.volume.toLocaleString("pl-PL")} szt.</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> AOV</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-foreground">{formatCurrency(kpis.aov)} PLN</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Zlecenia</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-foreground">{kpis.count}</p></CardContent></Card>
      </div>

      {/* ── Trendline ── */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">📈 Trend Obrotów i Częstotliwości (m/m)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis yAxisId="rev" tickFormatter={formatCompact} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis yAxisId="count" orientation="right" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="rev" type="monotone" dataKey="revenue" name="Obrót (PLN)" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="count" type="monotone" dataKey="orders" name="Zlecenia" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── TOP 10 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">🏆 TOP 10 — Wartość</CardTitle></CardHeader>
          <CardContent>
            {top10.topValue.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Brak danych</p> : (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={top10.topValue} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tickFormatter={formatCompact} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} />
                    <Tooltip content={barTooltip("value")} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1">
                  {top10.topValue.map((p) => (
                    <div key={p.fullName} className="flex items-center justify-between text-sm px-1">
                      <ProdioLink name={p.fullName} productId={p.productId} />
                      <span className="text-muted-foreground tabular-nums">{formatCurrency(p.value)} PLN</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">📦 TOP 10 — Wolumen</CardTitle></CardHeader>
          <CardContent>
            {top10.topVolume.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Brak danych</p> : (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={top10.topVolume} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} />
                    <Tooltip content={barTooltip("volume")} />
                    <Bar dataKey="volume" fill="hsl(var(--success))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1">
                  {top10.topVolume.map((p) => (
                    <div key={p.fullName} className="flex items-center justify-between text-sm px-1">
                      <ProdioLink name={p.fullName} productId={p.productId} />
                      <span className="text-muted-foreground tabular-nums">{p.volume.toLocaleString("pl-PL")} szt.</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Product Rotation Table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> Analiza Rotacji Produktów</CardTitle>
          <CardDescription>Produkty z historią min. 2 zamówień. Zagrożone = brak zamówienia od {ENDANGERED_DAYS}+ dni mimo regularności.</CardDescription>
        </CardHeader>
        <CardContent>
          {rotationData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">Brak danych</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produkt</TableHead>
                  <TableHead className="text-center">Zamówień</TableHead>
                  <TableHead className="text-center">Śr. Interwał</TableHead>
                  <TableHead className="text-center">Dni od ostatniego</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rotationData.slice(0, 30).map((p) => (
                  <TableRow key={p.name} className={p.isEndangered ? "bg-destructive/5" : ""}>
                    <TableCell><ProdioLink name={p.name} productId={p.productId} /></TableCell>
                    <TableCell className="text-center">{p.orderCount}</TableCell>
                    <TableCell className="text-center text-sm">{p.avgInterval} dni</TableCell>
                    <TableCell className="text-center text-sm">{p.daysSinceLast} dni</TableCell>
                    <TableCell className="text-center">
                      {p.isEndangered ? (
                        <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> ZAGROŻONY</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Endangered Products Alert ── */}
      {endangeredProducts.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Produkty Zagrożone — Wymagany kontakt
            </CardTitle>
            <CardDescription>{endangeredProducts.length} produktów przestało być zamawianych mimo regularnej historii</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {endangeredProducts.map((p) => (
                <div key={p.name} className="flex items-center justify-between p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <div className="flex-1 min-w-0">
                    <ProdioLink name={p.name} productId={p.productId} />
                    <p className="text-sm text-muted-foreground">
                      Ostatnie: {format(p.lastOrder, "dd.MM.yyyy")} · Śr. interwał: {p.avgInterval} dni · Zamówień: {p.orderCount}
                    </p>
                  </div>
                  <Badge variant="destructive" className="whitespace-nowrap ml-4">{p.daysSinceLast} dni bez zamówienia</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ClientDrilldown;
