import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const STALE_TIME = 5 * 60 * 1000; // 5 minutes

export interface OrderFiltersParams {
    statuses?: string[];
    clientName?: string;
    productName?: string;
    groupName?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

// v_order_history: widok kompatybilnosci nad nowym schematem (orders + production_orders)
export function useOrderHistory(filters?: OrderFiltersParams) {
    return useQuery({
          queryKey: ["order_history", filters],
          queryFn: async () => {
                  let query = supabase
                    .from("v_order_history_v2")
                    .select("product_id, client_id, client_name, product_name, product_group, product_group_name, currency, price, quantity, prodio_order_id, order_date, description, status, shipped_at, production_order_id, order_uuid, production_order_number")
                    .gt("price", 0)
                    .not("client_name", "ilike", "%toptech%")
                    .not("client_name", "ilike", "%fly4u%")
                    .not("client_name", "ilike", "%sky rocket%")
                    .not("client_name", "ilike", "%test%")
                    .order("order_date", { ascending: false });

            if (filters?.statuses && filters.statuses.length > 0) {
                      const withNull = filters.statuses.includes("");
                      const nonNull = filters.statuses.filter(s => s !== "");
                      if (withNull && nonNull.length > 0) {
                                  query = query.or(`status.in.(${nonNull.map(s => `"${s}"`).join(",")}),status.is.null`);
                      } else if (withNull) {
                                  query = query.is("status", null);
                      } else {
                                  query = query.in("status", nonNull);
                      }
            }

            if (filters?.clientName) {
                      query = query.eq("client_name", filters.clientName);
            }

            if (filters?.productName) {
                      query = query.eq("product_name", filters.productName);
            }

            if (filters?.groupName) {
                      query = query.eq("product_group_name", filters.groupName);
            }

            if (filters?.dateFrom) {
                      query = query.gte("order_date", filters.dateFrom);
            }

            if (filters?.dateTo) {
                      query = query.lte("order_date", filters.dateTo + "T23:59:59");
            }

            if (filters?.search) {
                      query = query.or(
                                  `product_name.ilike.%${filters.search}%,client_name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`
                                );
            }

            const { data, error } = await query;
                  if (error) throw error;
                  return data ?? [];
          },
          staleTime: STALE_TIME,
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
          refetchOnMount: false,
    });
}

// v_products: widok kompatybilnosci nad products_v2
export function useProducts(fields = "name, current_price, group_id") {
    return useQuery<any[]>({
          queryKey: ["products", fields],
          queryFn: async () => {
                  const { data, error } = await supabase
                    .from("v_products")
                    .select(fields);
                  if (error) throw error;
                  return (data as any[]) ?? [];
          },
          staleTime: STALE_TIME,
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
    });
}

// v_product_groups: widok kompatybilnosci nad product_groups_v2
export function useProductGroups() {
    return useQuery({
          queryKey: ["product_groups"],
          queryFn: async () => {
                  const { data, error } = await supabase
                    .from("v_product_groups")
                    .select("id, name");
                  if (error) throw error;
                  return data ?? [];
          },
          staleTime: STALE_TIME,
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
    });
}

// v_sales_opportunities: widok kompatybilnosci nad quotes
export function useSalesOpportunities() {
    return useQuery({
          queryKey: ["sales_opportunities"],
          queryFn: async () => {
                  const cutoff = new Date();
                  cutoff.setMonth(cutoff.getMonth() - 18);
                  const { data, error } = await supabase
                    .from("v_sales_opportunities")
                    .select("client_name, opportunity_date, product_name, unit_price, quantity")
                    .not("product_name", "is", null)
                    .neq("product_name", "")
                    .not("unit_price", "is", null)
                    .gt("unit_price", 0)
                    .not("quantity", "is", null)
                    .gt("quantity", 0)
                    .gte("opportunity_date", cutoff.toISOString().split("T")[0])
                    .order("opportunity_date", { ascending: false });
                  if (error) throw error;
                  return data ?? [];
          },
          staleTime: STALE_TIME,
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
    });
}

// v_customers_crm: widok oparty na customers_staging_v2
export function useCustomers(search?: string) {
    return useQuery({
          queryKey: ["customers", search],
          queryFn: async () => {
                  let query = supabase
                    .from("v_customers_crm")
                    .select("id, subiekt_id, name, symbol, nip, city, phone, email, contact_person, contact_phone, contact_email, credit_limit, payment_days, discount, status, notes, total_orders, last_order_date, total_revenue, segment_abc")
                    .eq("status", "aktywny")
                    .order("total_orders", { ascending: false });

            if (search && search.length > 1) {
                      query = query.or(
                                  `name.ilike.%${search}%,symbol.ilike.%${search}%,nip.ilike.%${search}%,city.ilike.%${search}%`
                                );
            }

            const { data, error } = await query;
                  if (error) throw error;
                  return data ?? [];
          },
          staleTime: STALE_TIME,
          gcTime: 10 * 60 * 1000,
          refetchOnWindowFocus: false,
    });
}
