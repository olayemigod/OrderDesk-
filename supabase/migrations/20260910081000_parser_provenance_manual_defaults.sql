alter table public.orders
  alter column parser_source set default 'manual';

alter table public.order_items
  alter column match_source set default 'manual';
