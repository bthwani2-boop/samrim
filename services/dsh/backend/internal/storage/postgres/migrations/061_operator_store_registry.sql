CREATE INDEX stores_operator_updated_idx
    ON dsh.stores(updated_at DESC, id DESC);
