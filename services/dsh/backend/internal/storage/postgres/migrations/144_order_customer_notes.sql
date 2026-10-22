ALTER TABLE dsh.commerce_orders
  ADD COLUMN customer_note text NOT NULL DEFAULT ''
  CONSTRAINT commerce_orders_customer_note_length CHECK (char_length(customer_note) <= 500);
