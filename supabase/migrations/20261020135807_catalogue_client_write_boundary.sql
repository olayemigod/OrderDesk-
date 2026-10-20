begin;

-- Product/category/UOM mutations are governed command authority. Authenticated
-- clients retain tenant-isolated catalogue reads, but may not bypass product
-- validation by writing catalog_items directly.
revoke insert, update, delete on table public.catalog_items from authenticated;
grant select on table public.catalog_items to authenticated;

-- The legacy catalogue command remains compatible because it delegates product
-- mutation to save_sellertray_product(), which now validates the shared Category
-- and Business UOM masters before writing commercial truth.

commit;
