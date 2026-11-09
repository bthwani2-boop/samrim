-- This migration retires an unadmitted parallel direct Order engine.
-- Purchase confirmation must enter dsh.commerce_orders through the one DSH
-- Order owner after the independent relation's own legal/payment gates pass.
-- Migration 174 is historical and cannot be rewritten on adopted databases.
-- Refuse to discard even one historical order, line, attempt, or audit record.
-- Lock writers before testing emptiness. Otherwise a concurrent writer from an
-- older runtime could insert between the emptiness check and DROP TABLE.
LOCK TABLE dsh.independent_direct_orders,
           dsh.independent_direct_order_lines,
           dsh.independent_direct_order_idempotency,
           dsh.independent_direct_order_audit IN ACCESS EXCLUSIVE MODE;

DO $retire_parallel_independent_orders$
BEGIN
    IF EXISTS (SELECT 1 FROM dsh.independent_direct_orders)
       OR EXISTS (SELECT 1 FROM dsh.independent_direct_order_lines)
       OR EXISTS (SELECT 1 FROM dsh.independent_direct_order_idempotency)
       OR EXISTS (SELECT 1 FROM dsh.independent_direct_order_audit) THEN
        RAISE EXCEPTION 'cannot retire independent direct order storage containing records; migrate and reconcile these records to the canonical DSH Order owner first'
            USING ERRCODE = '23514';
    END IF;
END;
$retire_parallel_independent_orders$;

DROP TABLE dsh.independent_direct_order_audit;
DROP TABLE dsh.independent_direct_order_idempotency;
DROP TABLE dsh.independent_direct_order_lines;
DROP TABLE dsh.independent_direct_orders;
DROP FUNCTION dsh.require_independent_direct_order_store();
-- These extra unique indexes existed only to support the retired direct-line
-- composite foreign keys; canonical product and offer keys remain unaffected.
DROP INDEX dsh.independent_direct_order_offer_store_variant_uq;
DROP INDEX dsh.independent_direct_order_variant_product_uq;
