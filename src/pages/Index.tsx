import { useState, useEffect, useMemo, useCallback, useRef } from "react";

import type { DateRange } from "react-day-picker";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  useOrderHistory,
  useProducts,
  useProductGroups,
  useSalesOpportunities,
  type OrderFiltersParams,
} from "@/hooks/useOrdersData";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Eye,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  RefreshCw,
  Truck,
  Undo2,
  CalendarIcon,
} from "lucide-react";
import { OrderFilters, createEmptyFilters, type FilterState, type ToggleableColumn } from "@/components/OrderFilters";
import { getStatusDisplay } from "@/components/StatusFilter";
import { SalesOpportunityCell, type SalesOpportunity } from "@/components/SalesOpportunityCell";
import { ProductDrawer, type ProductDrawerData } from "@/components/ProductDrawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { pl } from "date-fns/locale";
import { toast } from "sonner";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const STORAGE_KEY = "toptech-page-size";
const COL_VIS_KEY = "toptech-hidden-cols";

const getStoredPageSize = (): number => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && PAGE_SIZE_OPTIONS.includes(Number(v) as any)) return Number(v);
  } catch {}
  return 20;
};

const getStoredHiddenCols = (): Set<ToggleableColumn> => {
  try {
    const v = localStorage.getItem(COL_VIS_KEY);
    if (v) return new Set(JSON.parse(v) as ToggleableColumn[]);
  } catch {}
  return new Set();
};

interface OrderRow {
  id?: string;
  product_name: string;
  client_name: string | null;
  price: number | null;
  currency: string | null;
  quantity: number | null;
  order_date: string | null;
  group_name?: string | null;
  product_id?: string | null;
  status?: string | null;
  description: string | null;
  shipped_at?: string | null;
  production_order_id?: string | null;
  order_uuid?: string | null;
  production_order_number?: string | null;
}

interface ResultRow extends OrderRow {
  catalog_price: number | null;
  product_matched: boolean;
  sciezka_z: string | null;
  computed_opportunity_price: number | null;
  computed_opportunities: SalesOpportunity[];
}

type SortKey =
  | "product_name"
  | "group_name"
  | "client_name"
  | "order_date"
  | "quantity"
  | "price"
  | "catalog_price"
  | "diff"
  | "szansa"
  | "prodio"
  | "plik"
  | "status";
type SortDir = "asc" | "desc";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const formatPrice = (val: number, currency?: string | null) => `${val.toFixed(2)} ${currency || "PLN"}`;

const getDiff = (row: ResultRow): number | null => {
  if (row.price == null || row.catalog_price == null || row.catalog_price === 0) return null;
  return ((row.price - row.catalog_price) / row.catalog_price) * 100;
};

const fuzzyClientMatch = (a: string, b: string): boolean => {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la.includes(lb) || lb.includes(la);
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

const Index = () => {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [allRows, setAllRows] = useState<ResultRow[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(getStoredPageSize);
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    clientName: "",
    productName: "",
    groupName: "",
    statuses: [],
  });
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<ToggleableColumn>>(getStoredHiddenCols);

  const [pendingOpps, setPendingOpps] = useState<SalesOpportunity[] | null>(null);
  const [rawOpps, setRawOpps] = useState<SalesOpportunity[]>([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductDrawerData | null>(null);

  const toggleColumn = useCallback((col: ToggleableColumn) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      try {
        localStorage.setItem(COL_VIS_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);

  const show = useCallback((col: ToggleableColumn) => !hiddenColumns.has(col), [hiddenColumns]);

  // React Query hooks for cached data fetching
  const activeFilters: OrderFiltersParams = {
    statuses: filters.statuses.length > 0 ? filters.statuses : undefined,
    clientName: filters.clientName || undefined,
    productName: filters.productName || undefined,
    groupName: filters.groupName || undefined,
    dateFrom: dateRange?.from ? dateRange.from.toISOString().split("T")[0] : undefined,
    dateTo: dateRange?.to
      ? dateRange.to.toISOString().split("T")[0]
      : dateRange?.from
        ? dateRange.from.toISOString().split("T")[0]
        : undefined,
    search: filters.search || undefined,
  };

  const { data: ordersData, isLoading: loadingOrders, error: ordersError } = useOrderHistory(activeFilters);
  const { data: productsData = [], isLoading: loadingProducts } = useProducts(
    "name, current_price, group_id, sciezka_z",
  );
  const { data: groupsData = [], isLoading: loadingGroups } = useProductGroups();
  const { data: oppsData = [], isLoading: loadingOpps } = useSalesOpportunities();

  const loading = loadingOrders || loadingProducts || loadingGroups || loadingOpps;

  // Process data when queries complete
  useEffect(() => {
    if (loading) return;

    if (ordersError) {
      setError(`Błąd order_history: ${(ordersError as Error).message}`);
      setAllRows([]);
      return;
    }

    if (!ordersData || ordersData.length === 0) {
      setError("BŁĄD: Tabela order_history jest pusta lub zablokowana przez RLS");
      setAllRows([]);
      return;
    }

    setError(null);

    const groupMap = new Map<string, string>();
    for (const g of groupsData) {
      if (g.id && g.name) groupMap.set(g.id, g.name);
    }

    const productMap = new Map<
      string,
      { current_price: number | null; group_name: string | null; sciezka_z: string | null }
    >();
    for (const p of productsData) {
      if (p.name) {
        productMap.set(p.name.trim().toLowerCase(), {
          current_price: p.current_price,
          group_name: p.group_id ? (groupMap.get(p.group_id) ?? null) : null,
          sciezka_z: p.sciezka_z ?? null,
        });
      }
    }

    const joined: ResultRow[] = ordersData.map((o: any) => {
      const key = o.product_name?.trim().toLowerCase() || "";
      const catalog = productMap.get(key);
      return {
        ...o,
        catalog_price: catalog?.current_price ?? null,
        group_name: o.product_group_name || catalog?.group_name || null,
        product_matched: !!catalog,
        sciezka_z: catalog?.sciezka_z ?? null,
        computed_opportunity_price: null,
        computed_opportunities: [] as SalesOpportunity[],
      };
    });

    setAllRows(joined);

    if (oppsData.length > 0) {
      setRawOpps(oppsData as SalesOpportunity[]);
      setPendingOpps(oppsData as SalesOpportunity[]);
    }
  }, [loading, ordersData, productsData, groupsData, oppsData, ordersError]);

  // Async enrichment - identical logic, not modified
  useEffect(() => {
    if (!pendingOpps || pendingOpps.length === 0 || allRows.length === 0) return;

    setEnriching(true);

    const normOpps: { orig: SalesOpportunity; client: string; product: string }[] = [];
    for (const o of pendingOpps) {
      const prodRaw = String(o.product_name ?? "").trim();
      const clientRaw = String(o.client_name ?? "").trim();
      if (prodRaw.length < 2 || clientRaw.length < 1) continue;
      normOpps.push({
        orig: o,
        client: clientRaw.toLowerCase(),
        product: prodRaw.toLowerCase(),
      });
    }

    const normRows = allRows.map((r, idx) => {
      const client = String(r.client_name ?? "")
        .trim()
        .toLowerCase();
      const product = String(r.product_name ?? "")
        .trim()
        .toLowerCase();
      const desc = String(r.description ?? "")
        .trim()
        .toLowerCase();
      return {
        idx,
        client,
        product,
        desc,
        hasKeys: client.length >= 1 && product.length >= 1,
      };
    });

    const CHUNK = 500;
    const results: { idx: number; opps: SalesOpportunity[]; price: number | null }[] = [];
    let offset = 0;

    const processChunk = () => {
      const end = Math.min(offset + CHUNK, normRows.length);
      for (let i = offset; i < end; i++) {
        const nr = normRows[i];
        if (!nr.hasKeys) continue;
        const seenKeys = new Set<string>();
        const unique: SalesOpportunity[] = [];
        for (const no of normOpps) {
          if (!(no.client.includes(nr.client) || nr.client.includes(no.client))) continue;
          const pMatch = nr.product.length >= 2 && (no.product.includes(nr.product) || nr.product.includes(no.product));
          const dMatch = nr.desc.length >= 2 && (no.product.includes(nr.desc) || nr.desc.includes(no.product));
          if (!pMatch && !dMatch) continue;

          const opp = no.orig;
          const uniqueKey = `${String(opp.opportunity_date ?? "")}_${String(opp.unit_price ?? "")}_${String(opp.quantity ?? "")}`;
          if (seenKeys.has(uniqueKey)) continue;
          seenKeys.add(uniqueKey);
          unique.push(opp);
        }
        if (unique.length > 0) {
          const cleanHistory = [...unique].sort((a, b) => {
            const aDate = String(a.opportunity_date ?? "");
            const bDate = String(b.opportunity_date ?? "");
            return bDate.localeCompare(aDate);
          });
          results.push({ idx: nr.idx, opps: cleanHistory, price: cleanHistory[0]?.unit_price ?? null });
        }
      }
      offset = end;

      if (offset < normRows.length) {
        setTimeout(processChunk, 0);
      } else {
        setAllRows((prev) => {
          const updated = [...prev];
          for (const r of results) {
            updated[r.idx] = {
              ...updated[r.idx],
              computed_opportunities: r.opps,
              computed_opportunity_price: r.price,
            };
          }
          return updated;
        });
        setEnriching(false);
        setPendingOpps(null);
      }
    };

    setTimeout(processChunk, 0);
  }, [pendingOpps]);

  // Cross-filtering - identical logic
  const filterOptions = useMemo(() => {
    const s = filters.search.toLowerCase();

    const matchesSearch = (r: ResultRow) => {
      if (!s) return true;
      const haystack = [r.product_name, r.client_name, r.description].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(s);
    };

    const clientSet = new Set<string>();
    for (const r of allRows) {
      if (!r.client_name) continue;
      if (filters.productName && r.product_name !== filters.productName) continue;
      if (filters.groupName && r.group_name !== filters.groupName) continue;
      if (!matchesSearch(r)) continue;
      clientSet.add(r.client_name);
    }

    const productSet = new Set<string>();
    for (const r of allRows) {
      if (!r.product_name) continue;
      if (filters.clientName && r.client_name !== filters.clientName) continue;
      if (filters.groupName && r.group_name !== filters.groupName) continue;
      if (!matchesSearch(r)) continue;
      productSet.add(r.product_name);
    }

    const groupSet = new Set<string>();
    for (const r of allRows) {
      if (!r.group_name) continue;
      if (filters.clientName && r.client_name !== filters.clientName) continue;
      if (filters.productName && r.product_name !== filters.productName) continue;
      if (!matchesSearch(r)) continue;
      groupSet.add(r.group_name);
    }

    return {
      clients: Array.from(clientSet).sort(),
      products: Array.from(productSet).sort(),
      groups: Array.from(groupSet).sort(),
    };
  }, [allRows, filters]);

  // Extract unique statuses from all rows
  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      set.add(r.status || "");
    }
    return Array.from(set).sort();
  }, [allRows]);

  const statusesInitialized = useRef(false);
  useEffect(() => {
    if (!statusesInitialized.current && availableStatuses.length > 0) {
      statusesInitialized.current = true;
      setFilters((prev) => ({ ...prev, statuses: [...availableStatuses] }));
    }
  }, [availableStatuses]);

  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      if (!r.price || r.price === 0) return false;
      return true;
    });
  }, [allRows]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;

    const sorted = [...filteredRows].sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (sortKey) {
        case "product_name":
          valA = a.product_name?.toLowerCase() ?? "";
          valB = b.product_name?.toLowerCase() ?? "";
          break;
        case "group_name":
          valA = a.group_name?.toLowerCase() ?? "";
          valB = b.group_name?.toLowerCase() ?? "";
          break;
        case "client_name":
          valA = a.client_name?.toLowerCase() ?? "";
          valB = b.client_name?.toLowerCase() ?? "";
          break;
        case "order_date":
          valA = a.order_date ?? "";
          valB = b.order_date ?? "";
          break;
        case "quantity":
          valA = a.quantity ?? 0;
          valB = b.quantity ?? 0;
          break;
        case "price":
          valA = a.price ?? 0;
          valB = b.price ?? 0;
          break;
        case "catalog_price":
          valA = a.catalog_price ?? 0;
          valB = b.catalog_price ?? 0;
          break;
        case "diff":
          valA = getDiff(a) ?? -Infinity;
          valB = getDiff(b) ?? -Infinity;
          break;
        case "szansa": {
          const hasA = a.computed_opportunity_price != null;
          const hasB = b.computed_opportunity_price != null;
          if (!hasA && !hasB) return 0;
          if (!hasA) return 1;
          if (!hasB) return -1;
          valA = a.computed_opportunity_price!;
          valB = b.computed_opportunity_price!;
          break;
        }
        case "prodio":
          valA = a.product_id ? 1 : 0;
          valB = b.product_id ? 1 : 0;
          break;
        case "plik":
          valA = a.sciezka_z ? 1 : 0;
          valB = b.sciezka_z ? 1 : 0;
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [filteredRows, sortKey, sortDir]);

  useEffect(() => {
    setPage(0);
  }, [filters, sortKey, sortDir, pageSize]);

  const handlePageSizeChange = useCallback((val: string) => {
    const n = Number(val);
    setPageSize(n);
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch {}
  }, []);

  const totalPages = Math.ceil(sortedRows.length / pageSize);
  const pageRows = useMemo(
    () => sortedRows.slice(page * pageSize, (page + 1) * pageSize),
    [sortedRows, page, pageSize],
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 text-primary" />
    );
  };

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Ścieżka została skopiowana do schowka");
    } catch {
      toast.error("Nie udało się skopiować ścieżki");
    }
  };

  const renderDiff = (row: ResultRow) => {
    const diff = getDiff(row);
    if (diff == null) return "—";

    if (diff > 0) {
      return (
        <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/20">+{diff.toFixed(1)}%</Badge>
      );
    }
    if (diff < 0) {
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          Rabat {Math.abs(diff).toFixed(1)}%
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        0%
      </Badge>
    );
  };

  const hasProdioLink = (row: ResultRow) => !!row.product_id;

  const handleSyncProdio = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync_prodio_orders");
      console.log("[SYNC] Response data:", JSON.stringify(data));
      console.log("[SYNC] Response error:", error);
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const count = data?.upserted ?? data?.count ?? "?";
      toast.success(`Synchronizacja zakończona: pobrano ${data?.fetched ?? "?"} zleceń, zapisano ${count}.`);
      queryClient.invalidateQueries({ queryKey: ["order_history"] });
    } catch (err: any) {
      console.error("[SYNC] Error:", err);
      toast.error(`Błąd synchronizacji: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }, [queryClient]);

  // Dynamic col count for skeleton/empty rows
  const visibleColCount =
    5 +
    (show("group_name") ? 1 : 0) +
    (show("client_name") ? 1 : 0) +
    (show("status") ? 1 : 0) +
    (show("order_date") ? 1 : 0) +
    (show("quantity") ? 1 : 0) +
    (show("price") ? 1 : 0);

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Historia Zleceń</h1>
          <p className="text-muted-foreground mt-1">
            {allRows.length > 0
              ? `${filteredRows.length} z ${allRows.length} zleceń · Strona ${page + 1} z ${Math.max(totalPages, 1)}`
              : "Ładowanie danych…"}
          </p>
        </div>
        <Button onClick={handleSyncProdio} disabled={syncing} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Trwa synchronizacja…" : "Aktualizuj dane z Prodio"}
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border-2 border-destructive rounded-lg p-6 text-center">
          <p className="text-destructive text-xl font-bold">{error}</p>
        </div>
      )}

      <OrderFilters
        filters={filters}
        onChange={setFilters}
        clients={filterOptions.clients}
        products={filterOptions.products}
        groups={filterOptions.groups}
        availableStatuses={availableStatuses}
        pageSize={pageSize}
        onPageSizeChange={(n) => handlePageSizeChange(String(n))}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        hiddenColumns={hiddenColumns}
        onToggleColumn={toggleColumn}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold w-10">#</TableHead>
                <TableHead
                  className="font-semibold min-w-[200px] cursor-pointer select-none"
                  onClick={() => handleSort("product_name")}
                >
                  <span className="inline-flex items-center">
                    Produkt <SortIcon column="product_name" />
                  </span>
                </TableHead>
                {show("group_name") && (
                  <TableHead
                    className="font-semibold min-w-[140px] cursor-pointer select-none"
                    onClick={() => handleSort("group_name")}
                  >
                    <span className="inline-flex items-center">
                      Grupa Produktowa <SortIcon column="group_name" />
                    </span>
                  </TableHead>
                )}
                {show("client_name") && (
                  <TableHead
                    className="font-semibold min-w-[140px] cursor-pointer select-none"
                    onClick={() => handleSort("client_name")}
                  >
                    <span className="inline-flex items-center">
                      Klient <SortIcon column="client_name" />
                    </span>
                  </TableHead>
                )}
                {/* Nowa kolumna Status */}
                {show("status") && (
                  <TableHead
                    className="font-semibold min-w-[120px] cursor-pointer select-none"
                    onClick={() => handleSort("status")}
                  >
                    <span className="inline-flex items-center">
                      Status <SortIcon column="status" />
                    </span>
                  </TableHead>
                )}
                {show("order_date") && (
                  <TableHead
                    className="font-semibold cursor-pointer select-none"
                    onClick={() => handleSort("order_date")}
                  >
                    <span className="inline-flex items-center">
                      Data <SortIcon column="order_date" />
                    </span>
                  </TableHead>
                )}
                {show("quantity") && (
                  <TableHead
                    className="font-semibold text-right cursor-pointer select-none"
                    onClick={() => handleSort("quantity")}
                  >
                    <span className="inline-flex items-center justify-end">
                      Ilość <SortIcon column="quantity" />
                    </span>
                  </TableHead>
                )}
                {show("price") && (
                  <TableHead
                    className="font-semibold text-right cursor-pointer select-none min-w-[130px]"
                    onClick={() => handleSort("price")}
                  >
                    <span className="inline-flex items-center justify-end whitespace-normal">
                      Wycena (Zlec.&nbsp;/&nbsp;Kat.) <SortIcon column="price" />
                    </span>
                  </TableHead>
                )}
                <TableHead
                  className="font-semibold cursor-pointer select-none min-w-[80px] max-w-[100px]"
                  onClick={() => handleSort("szansa")}
                >
                  <span className="inline-flex items-center leading-tight">
                    <span className="break-words">
                      Szansa
                      <br />
                      Sprzedaży
                    </span>
                    <SortIcon column="szansa" />
                  </span>
                </TableHead>
                <TableHead
                  className="font-semibold w-[50px] max-w-[50px] text-center cursor-pointer select-none p-1"
                  onClick={() => handleSort("prodio")}
                >
                  <span className="inline-flex items-center justify-center text-xs">
                    <Eye className="h-3.5 w-3.5" />
                    <SortIcon column="prodio" />
                  </span>
                </TableHead>
                <TableHead
                  className="font-semibold w-[50px] max-w-[50px] text-center cursor-pointer select-none p-1"
                  onClick={() => handleSort("plik")}
                >
                  <span className="inline-flex items-center justify-center text-xs">
                    <Paperclip className="h-3.5 w-3.5" />
                    <SortIcon column="plik" />
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: visibleColCount }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColCount} className="text-center py-12 text-muted-foreground">
                    Brak danych do wyświetlenia
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((row, i) => (
                  <TableRow key={row.id || i} className="hover:bg-muted/50 transition-colors group/row">
                    <TableCell className="text-muted-foreground text-xs">{page * pageSize + i + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setSelectedProduct({
                              product_name: row.product_name,
                              description: row.description,
                              client_name: row.client_name,
                            });
                            setDrawerOpen(true);
                          }}
                          className="font-medium text-foreground hover:text-primary transition-colors text-left"
                        >
                          {row.product_name || "—"}
                        </button>
                        {!row.product_matched && row.product_name && (
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="z-50">
                              Brak dopasowania w katalogu produktów
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {row.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{row.description}</p>
                      )}
                    </TableCell>
                    {show("group_name") && (
                      <TableCell className="text-sm text-muted-foreground">{row.group_name || "—"}</TableCell>
                    )}
                    {show("client_name") && (
                      <TableCell className="text-sm text-foreground">{row.client_name || "—"}</TableCell>
                    )}
                    {/* WAGON ZE STATUSEM */}
                    {show("status") && (
                      <TableCell>
                        {(() => {
                          const display = getStatusDisplay(row.status);
                          return (
                            <Badge variant="outline" className={display.className}>
                              {display.label}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                    )}
                    {show("order_date") && <TableCell>{row.order_date ? formatDate(row.order_date) : "—"}</TableCell>}
                    {show("quantity") && <TableCell className="text-right">{row.quantity ?? "—"}</TableCell>}
                    {show("price") && (
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-sm font-bold text-foreground">
                            {row.price != null ? formatPrice(row.price, row.currency) : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.catalog_price != null
                              ? formatPrice(row.catalog_price, row.currency)
                              : "Brak w katalogu"}
                          </span>
                          {renderDiff(row)}
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      {enriching && row.computed_opportunities.length === 0 ? (
                        <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                      ) : (
                        <SalesOpportunityCell opportunities={row.computed_opportunities} />
                      )}
                    </TableCell>
                    <TableCell className="text-center p-1 w-[50px] max-w-[50px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {hasProdioLink(row) ? (
                            <a
                              href={`https://toptech.getprodio.com/app/product/view/${row.product_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-primary hover:bg-accent transition-colors"
                            >
                              <Eye className="h-4 w-4" />
                            </a>
                          ) : (
                            <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/40 cursor-default">
                              <Eye className="h-4 w-4" />
                            </span>
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="left" className="z-50">
                          {hasProdioLink(row) ? "Otwórz kartę produktu w Prodio" : "Brak powiązania z Prodio"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-center p-1 w-[50px] max-w-[50px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {row.sciezka_z ? (
                            <button
                              onClick={() => handleCopyPath(row.sciezka_z!)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md text-primary hover:bg-accent transition-colors"
                            >
                              <Paperclip className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/40 cursor-default">
                              <Paperclip className="h-4 w-4" />
                            </span>
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="left" className="z-50">
                          {row.sciezka_z ? "Kopiuj ścieżkę do schowka" : "Brak ścieżki pliku"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sortedRows.length)} z {sortedRows.length}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Poprzednia
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Następna <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ProductDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        product={selectedProduct}
        allOrders={allRows}
        allOpportunities={rawOpps}
        loading={loading}
      />
    </div>
  );
};

export default Index;
