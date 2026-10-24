begin;

-- Legacy purchase receipts predate governed receipt cost snapshots. When a
-- manager supplies verified historical Stock-UOM cost evidence, replay must use
-- it at the receipt's original business time. Governed Purchase Receiving still
-- wins because record_sellertray_inventory_cost_basis rejects receipts that own
-- an authoritative receipt-item cost snapshot.
do $$
declare
  v_definition text;
  v_anchor text := E'      else\n        v_unvalued_delta:=v_m.quantity_delta;\n        v_source_name:=''purchase_receipt_without_cost'';\n      end if;';
  v_replacement text := E'      else\n        select cb.stock_unit_cost,upper(cb.currency)\n        into v_stock_unit_cost,v_cost_currency\n        from public.sellertray_current_inventory_cost_basis(v_m.tenant_id,v_m.id) cb;\n        if found then\n          if v_cost_currency<>v_currency then\n            raise exception ''Historical inventory cost evidence currency differs from business currency'' using errcode=''23514'';\n          end if;\n          v_valued_delta:=v_m.quantity_delta;\n          v_value_delta:=round((v_m.quantity_delta*v_stock_unit_cost)::numeric,6);\n          v_known_unit_cost:=v_stock_unit_cost;\n          v_source_name:=''historical_cost_basis'';\n        else\n          v_unvalued_delta:=v_m.quantity_delta;\n          v_source_name:=''purchase_receipt_without_cost'';\n        end if;\n      end if;';
begin
  select pg_get_functiondef('public.rebuild_sellertray_inventory_valuation(uuid,uuid)'::regprocedure)
  into v_definition;
  if v_definition is null
     or (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'SellerTray purchase-receipt valuation implementation has drifted; legacy cost-basis convergence requires review' using errcode='55000';
  end if;
  execute replace(v_definition,v_anchor,v_replacement);
end;
$$;

commit;
