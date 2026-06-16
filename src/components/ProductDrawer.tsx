import { useState, useMemo } from "react";
import { Search, TrendingUp, TrendingDown, Minus, Eye, Paperclip, ChevronDown, User, Hash, CalendarDays } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { levenshtein } from "@/lib/levenshtein";
import { toast } from "sonner";

export interface ProductDrawerData {
  product_name: string;
  description: string | null;
  client_name: string | null;
}

interface OrderRecord {
  product_name: string;
  description: string | null;
  client_name: string | null;
  price: number | null;
  order_date: string | null;
  quantity?: number | null;
  product_id?: string | null;
  sciezka_z?: string | null;
}

interface OpportunityRecord {
  client_name: string;
  opportunity_date: string;
  product_name: string;
  unit_price: number;
  quantity: number;
}

interface ProductDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDrawerData | null;
  allOrders: OrderRecord[];
  allOpportunities: OpportunityRecord[];
  loading?: boolean;
}

/* ── Types for internal use ── */

interface OperationRow {
  date: string;
  type: "Zlecenie" | "Szansa";
  quantity: number | null;
  unit_price: number;
  value: number | null;
  product_id: string | null;
  sciezka_z: string | null;
  product_name: string;
}

interface SimilarProduct {
  product_name: string;
  description: string | null;
  date: string;
  unit_price: number;
  distance: number;
  product_id: string | null;
  sciezka_z: string | null;
}

/* ── Helpers ── */

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const PALETTE_ORDER = [
  "hsl(var(--primary))",
  "hsl(190, 80%, 45%)",
  "hsl(280, 65%, 60%)",
  "hsl(160, 60%, 45%)",
];
const PALETTE_OPP = [
  "hsl(25, 95%, 53%)",
  "hsl(340, 75%, 55%)",
  "hsl(55, 85%, 50%)",
  "hsl(0, 70%, 55%)",
];

/** Strict match: exact product_name + description */
function getStrictOperations(
  productName: string,
  description: string | null,
  allOrders: OrderRecord[],
  allOpportunities: OpportunityRecord[],
): OperationRow[] {
  const pName = norm(productName);
  const pDesc = norm(description);
  const rows: OperationRow[] = [];

  for (const o of allOrders) {
    if (norm(o.product_name) !== pName) continue;
    if (norm(o.description) !== pDesc) continue;
    if (o.price == null || !o.order_date) continue;
    rows.push({
      date: o.order_date.slice(0, 10),
      type: "Zlecenie",
      quantity: o.quantity ?? null,
      unit_price: o.price,
      value: o.quantity != null ? o.price * o.quantity : null,
      product_id: (o.product_id as string) ?? null,
      sciezka_z: o.sciezka_z ?? null,
      product_name: o.product_name,
    });
  }

  for (const s of allOpportunities) {
    const sName = norm(s.product_name);
    if (!sName.includes(pName) && !pName.includes(sName)) continue;
    if (s.unit_price <= 0 || !s.opportunity_date) continue;
    rows.push({
      date: s.opportunity_date.slice(0, 10),
      type: "Szansa",
      quantity: s.quantity,
      unit_price: s.unit_price,
      value: s.unit_price * s.quantity,
      product_id: null,
      sciezka_z: null,
      product_name: s.product_name,
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

function computeTrend(ops: OperationRow[]): "up" | "down" | "flat" | null {
  const prices = ops.map((o) => ({ date: o.date, price: o.unit_price }));
  prices.sort((a, b) => a.date.localeCompare(b.date));
  if (prices.length < 2) return null;
  const last = prices[prices.length - 1].price;
  const prev = prices[prices.length - 2].price;
  if (last > prev) return "up";
  if (last < prev) return "down";
  return "flat";
}

/* ── Component ── */

export function ProductDrawer({
  open,
  onOpenChange,
  product,
  allOrders,
  allOpportunities,
  loading,
}: ProductDrawerProps) {
  const [sensitivity, setSensitivity] = useState(3);
  const [showSimilar, setShowSimilar] = useState(false);
  const [checkedProducts, setCheckedProducts] = useState<Set<string>>(new Set());
  const [chartOpen, setChartOpen] = useState(false);

  // 1. Strict operations for main product
  const mainOps = useMemo<OperationRow[]>(
    () => (product ? getStrictOperations(product.product_name, product.description, allOrders, allOpportunities) : []),
    [product, allOrders, allOpportunities],
  );

  const mainTrend = useMemo(() => computeTrend(mainOps), [mainOps]);

  // Product info computed from mainOps
  const productInfo = useMemo(() => {
    const orderOps = mainOps.filter((o) => o.type === "Zlecenie");
    const totalQty = orderOps.reduce((sum, o) => sum + (o.quantity ?? 0), 0);
    const allDates = mainOps.map((o) => o.date).filter(Boolean).sort();
    const firstDate = allDates.length > 0 ? allDates[0] : null;
    return {
      totalHistoricalQty: totalQty,
      historicalOrderCount: orderOps.length,
      firstOperationDate: firstDate,
    };
  }, [mainOps]);

  // Similar products (Levenshtein)
  const similarProducts = useMemo<SimilarProduct[]>(() => {
    if (!product || !showSimilar) return [];
    const clientNorm = norm(product.client_name);
    if (!clientNorm) return [];
    const pNameNorm = norm(product.product_name);

    const seen = new Map<string, SimilarProduct>();

    for (const o of allOrders) {
      const oClient = norm(o.client_name);
      if (!oClient.includes(clientNorm) && !clientNorm.includes(oClient)) continue;
      const oName = norm(o.product_name);
      if (oName === pNameNorm) continue;
      const dist = levenshtein(pNameNorm, oName);
      if (dist > sensitivity) continue;

      const key = oName;
      const existing = seen.get(key);
      if (!existing || (o.order_date && o.order_date > (existing.date ?? ""))) {
        seen.set(key, {
          product_name: o.product_name,
          description: o.description,
          date: o.order_date?.slice(0, 10) ?? "—",
          unit_price: o.price ?? 0,
          distance: dist,
          product_id: (o.product_id as string) ?? null,
          sciezka_z: o.sciezka_z ?? null,
        });
      }
    }

    return Array.from(seen.values()).sort((a, b) => a.distance - b.distance);
  }, [product, allOrders, sensitivity, showSimilar]);

  const toggleProduct = (name: string) => {
    setCheckedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Operations for checked similar products
  const checkedOpsMap = useMemo(() => {
    const map = new Map<string, OperationRow[]>();
    for (const sp of similarProducts) {
      if (!checkedProducts.has(sp.product_name)) continue;
      map.set(sp.product_name, getStrictOperations(sp.product_name, sp.description, allOrders, allOpportunities));
    }
    return map;
  }, [similarProducts, checkedProducts, allOrders, allOpportunities]);

  // Combined operations for detail table
  const allOps = useMemo<OperationRow[]>(() => {
    const combined = [...mainOps];
    for (const ops of checkedOpsMap.values()) combined.push(...ops);
    combined.sort((a, b) => b.date.localeCompare(a.date));
    return combined;
  }, [mainOps, checkedOpsMap]);

  // Aggregate trend
  const aggregateTrend = useMemo(() => {
    if (checkedProducts.size === 0) return mainTrend;
    return computeTrend(allOps);
  }, [mainTrend, allOps, checkedProducts.size]);

  // Aggregate stats
  const stats = useMemo(() => {
    const prices = allOps.map((o) => o.unit_price);
    if (prices.length === 0) return null;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { avg, min: Math.min(...prices), max: Math.max(...prices), count: prices.length };
  }, [allOps]);

  // Chart data
  const { chartData, chartConfig, lineKeys } = useMemo(() => {
    if (!product) return { chartData: [], chartConfig: {} as ChartConfig, lineKeys: [] as { key: string; color: string; dash?: string }[] };

    const productNames = [product.product_name, ...Array.from(checkedProducts)];
    const allSeries: { key: string; label: string; ops: OperationRow[] }[] = [];
    const keys: { key: string; color: string; dash?: string }[] = [];

    productNames.forEach((pn, idx) => {
      const ops = pn === product.product_name ? mainOps : (checkedOpsMap.get(pn) ?? []);
      const orderOps = ops.filter((o) => o.type === "Zlecenie");
      const oppOps = ops.filter((o) => o.type === "Szansa");
      const shortLabel = pn.slice(0, 25);

      const orderKey = `order_${idx}`;
      const oppKey = `opp_${idx}`;

      if (orderOps.length > 0) {
        allSeries.push({ key: orderKey, label: `${shortLabel} (Zlecenia)`, ops: orderOps });
        keys.push({ key: orderKey, color: PALETTE_ORDER[idx % PALETTE_ORDER.length] });
      }
      if (oppOps.length > 0) {
        allSeries.push({ key: oppKey, label: `${shortLabel} (Szanse)`, ops: oppOps });
        keys.push({ key: oppKey, color: PALETTE_OPP[idx % PALETTE_OPP.length], dash: "5 5" });
      }
    });

    const dateMap = new Map<string, Record<string, any>>();
    for (const s of allSeries) {
      for (const o of s.ops) {
        const row = dateMap.get(o.date) ?? { date: o.date };
        row[s.key] = o.unit_price;
        dateMap.set(o.date, row);
      }
    }

    const data = Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const config: ChartConfig = {};
    for (const s of allSeries) {
      const matchingKey = keys.find((k) => k.key === s.key);
      config[s.key] = { label: s.label, color: matchingKey?.color ?? "hsl(var(--primary))" };
    }

    return { chartData: data, chartConfig: config, lineKeys: keys };
  }, [product, mainOps, checkedOpsMap, checkedProducts]);

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Ścieżka skopiowana do schowka");
    } catch {
      toast.error("Nie udało się skopiować ścieżki");
    }
  };

  if (!product) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[60vw] sm:max-w-[900px] overflow-y-auto p-0"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="text-xl font-bold text-foreground leading-tight">
            {product.product_name}
          </SheetTitle>
          {product.description && (
            <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
          )}
        </SheetHeader>

        <div className="p-6 space-y-6">
          {/* 1. Statystyki */}
          {stats && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Statystyki {checkedProducts.size > 0 ? `(${checkedProducts.size + 1} produktów)` : ""}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Średnia cena</p>
                    <p className="text-lg font-bold text-foreground">{stats.avg.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Min</p>
                    <p className="text-lg font-bold text-success">{stats.min.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Max</p>
                    <p className="text-lg font-bold text-destructive">{stats.max.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Trend</p>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {aggregateTrend === "up" && <TrendingUp className="h-4 w-4 text-success" />}
                      {aggregateTrend === "down" && <TrendingDown className="h-4 w-4 text-destructive" />}
                      {aggregateTrend === "flat" && <Minus className="h-4 w-4 text-muted-foreground" />}
                      {aggregateTrend === null && <span className="text-muted-foreground">—</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 2. NEW: Product Info Box */}
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Klient</p>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {product.client_name || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0">
                    <Hash className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Zlecono historycznie</p>
                    <p className="text-sm font-semibold text-foreground">
                      {productInfo.historicalOrderCount > 0
                        ? `${productInfo.totalHistoricalQty} szt. (${productInfo.historicalOrderCount} zleceń)`
                        : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0">
                    <CalendarDays className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pierwsza operacja</p>
                    <p className="text-sm font-semibold text-foreground">
                      {productInfo.firstOperationDate ? formatDate(productInfo.firstOperationDate) : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 3. Smart Match / Podobne wyceny (MOVED UP) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Podobne wyceny u tego samego klienta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-muted-foreground whitespace-nowrap">
                    Czułość (max. różnica znaków):
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={sensitivity}
                    onChange={(e) => setSensitivity(Number(e.target.value) || 3)}
                    className="w-20 h-9"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setShowSimilar(true);
                    setCheckedProducts(new Set());
                  }}
                  className="gap-1.5"
                >
                  <Search className="h-3.5 w-3.5" />
                  Szukaj podobnych
                </Button>
              </div>

              {showSimilar && (
                <div className="mt-3">
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : similarProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nie znaleziono podobnych produktów (próg: {sensitivity} znaków)
                    </p>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="w-8 px-2 py-2" />
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nazwa</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Data</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cena</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Δ</th>
                            <th className="w-8 px-1 py-2 text-center">
                              <Eye className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
                            </th>
                            <th className="w-8 px-1 py-2 text-center">
                              <Paperclip className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {similarProducts.map((sp, i) => (
                            <tr key={i} className="border-t border-border hover:bg-muted/30 transition-colors">
                              <td className="px-2 py-2">
                                <Checkbox
                                  checked={checkedProducts.has(sp.product_name)}
                                  onCheckedChange={() => toggleProduct(sp.product_name)}
                                />
                              </td>
                              <td className="px-3 py-2 font-medium text-foreground">{sp.product_name}</td>
                              <td className="px-3 py-2 text-muted-foreground">{sp.date}</td>
                              <td className="px-3 py-2 text-right font-medium text-foreground">
                                {sp.unit_price.toFixed(2)} PLN
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Badge variant="outline" className="text-xs">{sp.distance}</Badge>
                              </td>
                              <td className="px-1 py-2 text-center">
                                {sp.product_id ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        href={`https://toptech.getprodio.com/app/product/view/${sp.product_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-accent transition-colors"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="z-50">Otwórz w Prodio</TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </td>
                              <td className="px-1 py-2 text-center">
                                {sp.sciezka_z ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={() => handleCopyPath(sp.sciezka_z!)}
                                        className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-accent transition-colors"
                                      >
                                        <Paperclip className="h-3.5 w-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="z-50">Kopiuj ścieżkę pliku</TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4. Historia Operacji */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Historia Operacji ({allOps.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : allOps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Brak operacji</p>
              ) : (
                <div className="border rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Data</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Typ</th>
                        {checkedProducts.size > 0 && (
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Produkt</th>
                        )}
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Ilość</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cena jdn.</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Wartość</th>
                        <th className="w-8 px-1 py-2 text-center">
                          <Eye className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
                        </th>
                        <th className="w-8 px-1 py-2 text-center">
                          <Paperclip className="h-3.5 w-3.5 mx-auto text-muted-foreground" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {allOps.map((op, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 text-muted-foreground">{formatDate(op.date)}</td>
                          <td className="px-3 py-2">
                            <Badge variant={op.type === "Zlecenie" ? "default" : "outline"} className="text-xs">
                              {op.type}
                            </Badge>
                          </td>
                          {checkedProducts.size > 0 && (
                            <td className="px-3 py-2 text-foreground text-xs max-w-[140px] truncate">
                              {op.product_name}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right text-foreground">{op.quantity ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-medium text-foreground">{op.unit_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {op.value != null ? op.value.toFixed(2) : "—"}
                          </td>
                          <td className="px-1 py-2 text-center">
                            {op.type === "Zlecenie" && op.product_id ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a
                                    href={`https://toptech.getprodio.com/app/product/view/${op.product_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-accent transition-colors"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="z-50">
                                  Otwórz w Prodio
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </td>
                          <td className="px-1 py-2 text-center">
                            {op.type === "Zlecenie" && op.sciezka_z ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleCopyPath(op.sciezka_z!)}
                                    className="inline-flex items-center justify-center h-6 w-6 rounded text-primary hover:bg-accent transition-colors"
                                  >
                                    <Paperclip className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="z-50">
                                  Kopiuj ścieżkę pliku
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 5. Collapsible Chart */}
          <Collapsible open={chartOpen} onOpenChange={setChartOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors rounded-t-lg">
                  <span className="text-base font-semibold text-foreground">
                    {checkedProducts.size > 0 ? "Porównanie cenowe" : "Trend cenowy"}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-block w-4 h-0.5 bg-primary rounded" /> Zlecenia
                      <span className="inline-block w-4 h-0.5 rounded" style={{ background: "hsl(25, 95%, 53%)", borderTop: "1px dashed hsl(25, 95%, 53%)" }} /> Szanse
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                        chartOpen ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  {loading ? (
                    <Skeleton className="h-[220px] w-full" />
                  ) : chartData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Brak danych cenowych dla tego produktu
                    </p>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-[250px] w-full">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(v) => {
                            const d = new Date(v);
                            return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
                          }}
                          fontSize={11}
                        />
                        <YAxis fontSize={11} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(v) => formatDate(String(v))}
                            />
                          }
                        />
                        {lineKeys.length > 1 && (
                          <ChartLegend content={<ChartLegendContent />} />
                        )}
                        {lineKeys.map((lk) => (
                          <Line
                            key={lk.key}
                            type="monotone"
                            dataKey={lk.key}
                            stroke={lk.color}
                            strokeWidth={lk.key.startsWith("order_0") ? 2.5 : 1.5}
                            strokeDasharray={lk.dash}
                            dot={{ r: 3 }}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </SheetContent>
    </Sheet>
  );
}
