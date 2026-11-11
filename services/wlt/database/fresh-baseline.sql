-- GENERATED WLT clean fresh-install schema from the canonical versioned migrations.
-- Fresh EMPTY databases only. Existing upgrade history remains unchanged.
-- The migration rows below signify equivalent baseline state, not individual executions.
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: wlt; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA wlt;


--
-- Name: guard_payout_store_allocation(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.guard_payout_store_allocation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'committed payout allocations are immutable' USING ERRCODE = 'WLT03';
    END IF;
    IF EXISTS (
        SELECT 1 FROM wlt.store_payout_recipient_assignments a
        JOIN wlt.payout_requests p ON p.actor_id=a.partner_actor_id AND p.actor_type='partner'
        WHERE p.id=NEW.payout_id AND a.store_id=NEW.store_id AND a.state='RECIPIENT_REVIEW_REQUIRED'
    ) THEN
        RAISE EXCEPTION 'payout recipient review required for included store' USING ERRCODE = 'WLT01';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: guard_store_commercial_agreement_mutation(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.guard_store_commercial_agreement_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.store_id <> NEW.store_id OR OLD.partner_actor_id <> NEW.partner_actor_id OR
       OLD.agreement_version <> NEW.agreement_version OR OLD.proposed_by_actor_id <> NEW.proposed_by_actor_id OR
       OLD.proposed_at <> NEW.proposed_at OR OLD.reason <> NEW.reason OR
       OLD.idempotency_key <> NEW.idempotency_key OR OLD.request_hash <> NEW.request_hash OR
       OLD.correlation_id <> NEW.correlation_id THEN
        RAISE EXCEPTION 'store commercial agreement proposal facts are immutable';
    END IF;
    IF OLD.finance_decision_by_actor_id IS NOT NULL AND
       (OLD.finance_decision_by_actor_id IS DISTINCT FROM NEW.finance_decision_by_actor_id OR
        OLD.finance_decision_at IS DISTINCT FROM NEW.finance_decision_at OR
        OLD.finance_decision_reason IS DISTINCT FROM NEW.finance_decision_reason) THEN
        RAISE EXCEPTION 'store commercial agreement Finance decision facts are immutable';
    END IF;
    IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' AND
       OLD.partner_accepted_by_actor_id = NEW.partner_accepted_by_actor_id AND
       OLD.partner_accepted_at = NEW.partner_accepted_at AND
       OLD.finance_approved_by_actor_id = NEW.finance_approved_by_actor_id AND
       OLD.finance_approved_at = NEW.finance_approved_at AND OLD.effective_at = NEW.effective_at AND
       OLD.finance_decision_by_actor_id = NEW.finance_decision_by_actor_id AND
       OLD.finance_decision_at = NEW.finance_decision_at AND
       OLD.finance_decision_reason = NEW.finance_decision_reason AND NEW.superseded_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'PROPOSED' AND NEW.status = 'PARTNER_ACCEPTED' AND
       NEW.partner_accepted_by_actor_id IS NOT NULL AND NEW.partner_accepted_at IS NOT NULL AND
       NEW.finance_approved_at IS NULL AND NEW.effective_at IS NULL AND NEW.superseded_at IS NULL AND
       NEW.finance_decision_by_actor_id IS NULL AND NEW.finance_decision_at IS NULL AND NEW.finance_decision_reason IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'PARTNER_ACCEPTED' AND NEW.status IN ('ACTIVE','FINANCE_REJECTED') AND
       OLD.partner_accepted_by_actor_id = NEW.partner_accepted_by_actor_id AND
       OLD.partner_accepted_at = NEW.partner_accepted_at AND OLD.superseded_at IS NULL AND
       OLD.finance_decision_by_actor_id IS NULL AND OLD.finance_decision_at IS NULL AND OLD.finance_decision_reason IS NULL AND
       NEW.finance_decision_by_actor_id IS NOT NULL AND NEW.finance_decision_at IS NOT NULL AND
       NEW.finance_decision_reason IS NOT NULL AND
       ((NEW.status = 'ACTIVE' AND NEW.finance_approved_by_actor_id = NEW.finance_decision_by_actor_id AND
         NEW.finance_approved_at = NEW.finance_decision_at AND NEW.effective_at IS NOT NULL) OR
        (NEW.status = 'FINANCE_REJECTED' AND NEW.finance_approved_by_actor_id IS NULL AND
         NEW.finance_approved_at IS NULL AND NEW.effective_at IS NULL)) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid store commercial agreement lifecycle transition';
END;
$$;


--
-- Name: guard_store_commercial_model_immutability(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.guard_store_commercial_model_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (OLD.commercial_model, OLD.recurring_amount_minor, OLD.billing_period, OLD.billing_timezone,
      OLD.invoice_due_days, OLD.grace_days, OLD.renewal_policy, OLD.termination_terms, OLD.adjustment_terms)
     IS DISTINCT FROM
     (NEW.commercial_model, NEW.recurring_amount_minor, NEW.billing_period, NEW.billing_timezone,
      NEW.invoice_due_days, NEW.grace_days, NEW.renewal_policy, NEW.termination_terms, NEW.adjustment_terms)
  THEN RAISE EXCEPTION 'store commercial agreement model and terms are immutable'; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reject_retired_hybrid_store_agreement(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.reject_retired_hybrid_store_agreement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.commercial_model = 'HYBRID' THEN
      RAISE EXCEPTION 'retired HYBRID Store commercial agreement'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.commercial_model = 'HYBRID'
      AND OLD.status = 'PROPOSED'
      AND NEW.status = 'PARTNER_ACCEPTED'
    THEN
      RAISE EXCEPTION 'retired HYBRID Store commercial agreement cannot be accepted'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: reject_store_commercial_agreement_event_mutation(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.reject_store_commercial_agreement_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'store commercial agreement events are immutable';
END;
$$;


--
-- Name: reject_store_commercial_agreement_rate_mutation(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.reject_store_commercial_agreement_rate_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'store commercial agreement rates are immutable';
END;
$$;


--
-- Name: reject_store_payout_recipient_event_mutation(); Type: FUNCTION; Schema: wlt; Owner: -
--

CREATE FUNCTION wlt.reject_store_payout_recipient_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'store payout recipient events are immutable';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: approved_payout_snapshots; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.approved_payout_snapshots (
    payout_id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    beneficiary_name text NOT NULL,
    provider_key text NOT NULL,
    masked_destination text NOT NULL,
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    amount_mode text NOT NULL,
    resolved_amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    policy_version text NOT NULL,
    snapshot_hash text NOT NULL,
    prepared_by text NOT NULL,
    prepared_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    beneficiary_identity_version integer,
    identity_actor_version_snapshot integer,
    identity_role_version_snapshot integer,
    role_enabled_snapshot boolean,
    security_enabled_snapshot boolean,
    official_name_status_snapshot text,
    CONSTRAINT approved_payout_snapshots_actor_chk CHECK ((actor_type = ANY (ARRAY['customer'::text, 'partner'::text, 'captain'::text, 'field'::text]))),
    CONSTRAINT approved_payout_snapshots_amount_mode_chk CHECK (((amount_mode = ANY (ARRAY['FULL_AVAILABLE'::text, 'SPECIFIED'::text])) AND (resolved_amount_minor > 0))),
    CONSTRAINT approved_payout_snapshots_approval_chk CHECK ((((approved_by IS NULL) AND (approved_at IS NULL)) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
    CONSTRAINT approved_payout_snapshots_beneficiary_chk CHECK (((length(btrim(beneficiary_name)) >= 1) AND (length(btrim(beneficiary_name)) <= 320))),
    CONSTRAINT approved_payout_snapshots_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT approved_payout_snapshots_destination_chk CHECK ((((length(btrim(masked_destination)) >= 4) AND (length(btrim(masked_destination)) <= 128)) AND (destination_version > 0))),
    CONSTRAINT approved_payout_snapshots_hash_chk CHECK ((length(btrim(snapshot_hash)) > 0)),
    CONSTRAINT approved_payout_snapshots_identity_facts_chk CHECK ((((identity_actor_version_snapshot IS NULL) AND (identity_role_version_snapshot IS NULL) AND (role_enabled_snapshot IS NULL) AND (security_enabled_snapshot IS NULL) AND (official_name_status_snapshot IS NULL)) OR ((identity_actor_version_snapshot > 0) AND (identity_role_version_snapshot > 0) AND (role_enabled_snapshot IS TRUE) AND (security_enabled_snapshot IS TRUE) AND (official_name_status_snapshot = 'VERIFIED'::text)))),
    CONSTRAINT approved_payout_snapshots_identity_version_chk CHECK (((beneficiary_identity_version IS NULL) OR (beneficiary_identity_version > 0))),
    CONSTRAINT approved_payout_snapshots_prepare_approve_sod_chk CHECK (((approved_by IS NULL) OR (prepared_by <> approved_by))),
    CONSTRAINT approved_payout_snapshots_prepared_by_chk CHECK (((length(btrim(prepared_by)) >= 1) AND (length(btrim(prepared_by)) <= 128))),
    CONSTRAINT approved_payout_snapshots_provider_chk CHECK (((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64)))
);


--
-- Name: beneficiary_settlement_intakes; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.beneficiary_settlement_intakes (
    id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    requested_by text NOT NULL,
    amount_mode text NOT NULL,
    requested_amount_minor bigint,
    resolved_amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    store_allocations jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    payout_reference text,
    cancelled_by text,
    cancellation_reason text,
    cancelled_at timestamp with time zone,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT beneficiary_settlement_intakes_actor_id_check CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT beneficiary_settlement_intakes_actor_type_check CHECK ((actor_type = ANY (ARRAY['field'::text, 'captain'::text, 'partner'::text]))),
    CONSTRAINT beneficiary_settlement_intakes_amount_mode_check CHECK ((amount_mode = ANY (ARRAY['FULL_AVAILABLE'::text, 'SPECIFIED'::text]))),
    CONSTRAINT beneficiary_settlement_intakes_check CHECK ((((amount_mode = 'FULL_AVAILABLE'::text) AND (requested_amount_minor IS NULL)) OR ((amount_mode = 'SPECIFIED'::text) AND (requested_amount_minor > 0)))),
    CONSTRAINT beneficiary_settlement_intakes_check1 CHECK ((((status = 'CONVERTED'::text) AND (payout_reference IS NOT NULL) AND (length(btrim(payout_reference)) > 0) AND (cancelled_at IS NULL)) OR ((status = 'REQUESTED'::text) AND (payout_reference IS NULL) AND (cancelled_at IS NULL)) OR ((status = 'CANCELLED'::text) AND (payout_reference IS NULL) AND (cancelled_at IS NOT NULL) AND (length(btrim(cancelled_by)) > 0) AND (length(btrim(cancellation_reason)) > 0)))),
    CONSTRAINT beneficiary_settlement_intakes_correlation_id_check CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT beneficiary_settlement_intakes_currency_check CHECK ((currency = 'YER'::text)),
    CONSTRAINT beneficiary_settlement_intakes_idempotency_key_check CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT beneficiary_settlement_intakes_requested_by_check CHECK (((length(btrim(requested_by)) >= 1) AND (length(btrim(requested_by)) <= 128))),
    CONSTRAINT beneficiary_settlement_intakes_resolved_amount_minor_check CHECK ((resolved_amount_minor > 0)),
    CONSTRAINT beneficiary_settlement_intakes_status_check CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'CANCELLED'::text, 'CONVERTED'::text]))),
    CONSTRAINT beneficiary_settlement_intakes_store_allocations_check CHECK ((jsonb_typeof(store_allocations) = 'array'::text))
);


--
-- Name: captain_cod_legacy_recovery_reviews; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.captain_cod_legacy_recovery_reviews (
    id text NOT NULL,
    payment_intent_id text NOT NULL,
    order_id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    evidence_document_id text CONSTRAINT captain_cod_legacy_recovery_revie_evidence_document_id_not_null NOT NULL,
    submitted_by text NOT NULL,
    submitted_idempotency_key text CONSTRAINT captain_cod_legacy_recovery__submitted_idempotency_key_not_null NOT NULL,
    submitted_request_hash text CONSTRAINT captain_cod_legacy_recovery_rev_submitted_request_hash_not_null NOT NULL,
    submitted_correlation_id text CONSTRAINT captain_cod_legacy_recovery_r_submitted_correlation_id_not_null NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    approval_idempotency_key text,
    approval_correlation_id text,
    reservation_id text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT captain_cod_legacy_recovery_actor_chk CHECK ((((length(btrim(order_id)) >= 1) AND (length(btrim(order_id)) <= 128)) AND ((length(btrim(captain_actor_id)) >= 1) AND (length(btrim(captain_actor_id)) <= 128)) AND ((length(btrim(submitted_by)) >= 1) AND (length(btrim(submitted_by)) <= 128)) AND (amount_minor > 0))),
    CONSTRAINT captain_cod_legacy_recovery_mutation_chk CHECK ((((length(btrim(submitted_idempotency_key)) >= 8) AND (length(btrim(submitted_idempotency_key)) <= 128)) AND ((length(btrim(submitted_correlation_id)) >= 8) AND (length(btrim(submitted_correlation_id)) <= 128)) AND (length(btrim(submitted_request_hash)) > 0))),
    CONSTRAINT captain_cod_legacy_recovery_status_chk CHECK ((((status = 'PENDING'::text) AND (approved_by IS NULL) AND (approved_at IS NULL) AND (approval_idempotency_key IS NULL) AND (approval_correlation_id IS NULL) AND (reservation_id IS NULL)) OR ((status = 'APPROVED'::text) AND (approved_by IS NOT NULL) AND (approved_at IS NOT NULL) AND (approval_idempotency_key IS NOT NULL) AND (approval_correlation_id IS NOT NULL) AND (reservation_id IS NOT NULL) AND (approved_by <> submitted_by))))
);


--
-- Name: captain_cod_reservation_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.captain_cod_reservation_events (
    id text NOT NULL,
    reservation_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT captain_cod_reservation_events_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT captain_cod_reservation_events_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT captain_cod_reservation_events_type_chk CHECK ((event_type = ANY (ARRAY['CAPTAIN_COD_RESERVED'::text, 'CAPTAIN_COD_RELEASED'::text, 'CAPTAIN_COD_FINALIZED'::text, 'CAPTAIN_COD_REMITTED'::text, 'CAPTAIN_COD_REMITTANCE_REOPENED'::text, 'CAPTAIN_COD_DEBITED'::text, 'CAPTAIN_COD_LEGACY_RECOVERED'::text])))
);


--
-- Name: captain_cod_reservations; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.captain_cod_reservations (
    id text NOT NULL,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    reserve_idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    released_at timestamp with time zone,
    finalized_at timestamp with time zone,
    remitted_at timestamp with time zone,
    CONSTRAINT captain_cod_reservations_actor_chk CHECK (((length(btrim(captain_actor_id)) >= 1) AND (length(btrim(captain_actor_id)) <= 128))),
    CONSTRAINT captain_cod_reservations_amount_chk CHECK (((amount_minor > 0) AND (currency = 'YER'::text))),
    CONSTRAINT captain_cod_reservations_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT captain_cod_reservations_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT captain_cod_reservations_state_chk CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'RELEASED'::text, 'FINALIZED'::text, 'REMITTED'::text, 'DEBITED'::text]))),
    CONSTRAINT captain_cod_reservations_terminal_time_chk CHECK ((((state = 'ACTIVE'::text) AND (released_at IS NULL) AND (finalized_at IS NULL) AND (remitted_at IS NULL)) OR ((state = 'RELEASED'::text) AND (released_at IS NOT NULL) AND (finalized_at IS NULL) AND (remitted_at IS NULL)) OR ((state = 'FINALIZED'::text) AND (released_at IS NULL) AND (finalized_at IS NOT NULL) AND (remitted_at IS NULL)) OR ((state = 'REMITTED'::text) AND (released_at IS NULL) AND (finalized_at IS NOT NULL) AND (remitted_at IS NOT NULL)) OR ((state = 'DEBITED'::text) AND (released_at IS NULL) AND (finalized_at IS NOT NULL) AND (remitted_at IS NULL))))
);


--
-- Name: captain_minimum_balance_policies; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.captain_minimum_balance_policies (
    id text NOT NULL,
    version integer NOT NULL,
    minimum_available_minor bigint CONSTRAINT captain_minimum_balance_polici_minimum_available_minor_not_null NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    state text NOT NULL,
    created_by text NOT NULL,
    change_reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT captain_minimum_balance_policies_change_reason_check CHECK (((length(btrim(change_reason)) >= 5) AND (length(btrim(change_reason)) <= 500))),
    CONSTRAINT captain_minimum_balance_policies_created_by_check CHECK (((length(btrim(created_by)) >= 1) AND (length(btrim(created_by)) <= 128))),
    CONSTRAINT captain_minimum_balance_policies_currency_check CHECK ((currency = 'YER'::text)),
    CONSTRAINT captain_minimum_balance_policies_minimum_available_minor_check CHECK ((minimum_available_minor >= 0)),
    CONSTRAINT captain_minimum_balance_policies_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))),
    CONSTRAINT captain_minimum_balance_policies_version_check CHECK ((version > 0))
);


--
-- Name: captain_wallet_funding; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.captain_wallet_funding (
    id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    funding_reason text NOT NULL,
    evidence_reference text NOT NULL,
    created_by text NOT NULL,
    ledger_transaction_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT captain_wallet_funding_actor_chk CHECK (((length(btrim(captain_actor_id)) >= 1) AND (length(btrim(captain_actor_id)) <= 128))),
    CONSTRAINT captain_wallet_funding_amount_chk CHECK (((amount_minor > 0) AND (currency = 'YER'::text))),
    CONSTRAINT captain_wallet_funding_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT captain_wallet_funding_created_by_chk CHECK (((length(btrim(created_by)) >= 1) AND (length(btrim(created_by)) <= 128))),
    CONSTRAINT captain_wallet_funding_evidence_chk CHECK (((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 512))),
    CONSTRAINT captain_wallet_funding_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT captain_wallet_funding_reason_chk CHECK (((length(btrim(funding_reason)) >= 1) AND (length(btrim(funding_reason)) <= 512)))
);


--
-- Name: cash_in_funding_intent_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.cash_in_funding_intent_events (
    id text NOT NULL,
    funding_intent_id text NOT NULL,
    event_type text NOT NULL,
    provider_transaction_reference text,
    resulting_state text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT cash_in_funding_intent_events_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT cash_in_funding_intent_events_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT cash_in_funding_intent_events_state_chk CHECK ((resulting_state = ANY (ARRAY['PENDING_PROVIDER'::text, 'UNKNOWN'::text, 'FAILED'::text, 'SETTLED'::text]))),
    CONSTRAINT cash_in_funding_intent_events_type_chk CHECK ((event_type = ANY (ARRAY['FUNDING_INTENT_CREATED'::text, 'PROVIDER_RESULT_DELAYED'::text, 'PROVIDER_RESULT_UNKNOWN'::text, 'PROVIDER_RESULT_FAILED'::text, 'PROVIDER_RESULT_CONFIRMED'::text])))
);


--
-- Name: cash_in_funding_intents; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.cash_in_funding_intents (
    id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    funding_purpose text NOT NULL,
    provider_key text NOT NULL,
    external_reference text NOT NULL,
    requested_amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    state text DEFAULT 'PENDING_PROVIDER'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    provider_reference text,
    provider_transaction_reference text,
    ledger_transaction_id text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    provider_fee_minor bigint DEFAULT 0 NOT NULL,
    CONSTRAINT cash_in_funding_intents_actor_chk CHECK ((((actor_type = 'customer'::text) AND (funding_purpose = 'CUSTOMER_TOPUP'::text)) OR ((actor_type = 'captain'::text) AND (funding_purpose = 'CAPTAIN_TOPUP'::text)))),
    CONSTRAINT cash_in_funding_intents_actor_id_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT cash_in_funding_intents_amount_chk CHECK (((requested_amount_minor > 0) AND (currency = 'YER'::text))),
    CONSTRAINT cash_in_funding_intents_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT cash_in_funding_intents_provider_chk CHECK (((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64))),
    CONSTRAINT cash_in_funding_intents_provider_fee_chk CHECK (((provider_fee_minor >= 0) AND (provider_fee_minor < requested_amount_minor) AND ((state = 'SETTLED'::text) OR (provider_fee_minor = 0)))),
    CONSTRAINT cash_in_funding_intents_reference_chk CHECK (((length(btrim(external_reference)) >= 1) AND (length(btrim(external_reference)) <= 128))),
    CONSTRAINT cash_in_funding_intents_request_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT cash_in_funding_intents_settlement_chk CHECK ((((state = 'SETTLED'::text) AND (provider_transaction_reference IS NOT NULL) AND (ledger_transaction_id IS NOT NULL)) OR ((state <> 'SETTLED'::text) AND (ledger_transaction_id IS NULL)))),
    CONSTRAINT cash_in_funding_intents_state_chk CHECK ((state = ANY (ARRAY['PENDING_PROVIDER'::text, 'UNKNOWN'::text, 'FAILED'::text, 'SETTLED'::text]))),
    CONSTRAINT cash_in_funding_intents_version_chk CHECK ((version > 0)),
    CONSTRAINT cash_in_funding_provider_reference_chk CHECK (((provider_reference IS NULL) OR ((length(btrim(provider_reference)) >= 1) AND (length(btrim(provider_reference)) <= 160))))
);


--
-- Name: cash_remittance_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.cash_remittance_events (
    id bigint NOT NULL,
    remittance_id text NOT NULL,
    payment_intent_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    remittance_reference text NOT NULL,
    finance_actor_id text,
    evidence_document_id text,
    CONSTRAINT cash_remittance_events_amount_chk CHECK ((amount_minor > 0)),
    CONSTRAINT cash_remittance_events_finance_actor_chk CHECK (((finance_actor_id IS NULL) OR ((length(btrim(finance_actor_id)) >= 1) AND (length(btrim(finance_actor_id)) <= 128)))),
    CONSTRAINT cash_remittance_events_reconciliation_chk CHECK ((((event_type = 'CASH_REMITTANCE_RECONCILED'::text) AND (finance_actor_id IS NOT NULL) AND (finance_actor_id <> captain_actor_id) AND (evidence_document_id IS NOT NULL)) OR ((event_type <> 'CASH_REMITTANCE_RECONCILED'::text) AND (finance_actor_id IS NULL) AND (evidence_document_id IS NULL)))),
    CONSTRAINT cash_remittance_events_reference_chk CHECK (((char_length(remittance_reference) >= 1) AND (char_length(remittance_reference) <= 128))),
    CONSTRAINT cash_remittance_events_type_chk CHECK ((event_type = ANY (ARRAY['CASH_REMITTED'::text, 'CASH_REMITTANCE_SUBMITTED'::text, 'CASH_REMITTANCE_REFERENCE_UPDATED'::text, 'CASH_REMITTANCE_REOPENED'::text, 'CASH_REMITTANCE_RECONCILED'::text])))
);


--
-- Name: cash_remittance_events_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

ALTER TABLE wlt.cash_remittance_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME wlt.cash_remittance_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cash_remittances; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.cash_remittances (
    id text NOT NULL,
    payment_intent_id text NOT NULL,
    captain_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    remittance_reference text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    state text DEFAULT 'SUBMITTED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    reconciled_by text,
    reconciled_at timestamp with time zone,
    receipt_document_id text,
    CONSTRAINT cash_remittances_amount_chk CHECK ((amount_minor > 0)),
    CONSTRAINT cash_remittances_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT cash_remittances_reconciliation_chk CHECK ((((state = 'SUBMITTED'::text) AND (reconciled_by IS NULL) AND (reconciled_at IS NULL) AND (receipt_document_id IS NULL)) OR ((state = 'REMITTED'::text) AND (reconciled_by IS NOT NULL) AND ((length(btrim(reconciled_by)) >= 1) AND (length(btrim(reconciled_by)) <= 128)) AND (reconciled_at IS NOT NULL) AND (receipt_document_id IS NOT NULL)))),
    CONSTRAINT cash_remittances_reference_chk CHECK (((char_length(remittance_reference) >= 1) AND (char_length(remittance_reference) <= 128))),
    CONSTRAINT cash_remittances_state_chk CHECK ((state = ANY (ARRAY['SUBMITTED'::text, 'REMITTED'::text])))
);


--
-- Name: commercial_store_type_commission_default_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.commercial_store_type_commission_default_events (
    idempotency_key text CONSTRAINT commercial_store_type_commission_polic_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT commercial_store_type_commission_policy_e_request_hash_not_null NOT NULL,
    commercial_store_type_id text CONSTRAINT commercial_store_type_commis_commercial_store_type_id_not_null1 NOT NULL,
    fulfillment_mode text CONSTRAINT commercial_store_type_commission_pol_fulfillment_mode_not_null1 NOT NULL,
    previous_rate_bps integer,
    new_rate_bps integer CONSTRAINT commercial_store_type_commission_policy_e_new_rate_bps_not_null NOT NULL,
    previous_policy_version integer,
    new_policy_version integer CONSTRAINT commercial_store_type_commission_po_new_policy_version_not_null NOT NULL,
    changed_by_actor_id text CONSTRAINT commercial_store_type_commission_p_changed_by_actor_id_not_null NOT NULL,
    reason text CONSTRAINT commercial_store_type_commission_policy_events_reason_not_null NOT NULL,
    correlation_id text CONSTRAINT commercial_store_type_commission_policy_correlation_id_not_null NOT NULL,
    changed_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT commercial_store_type_commission_policy_eve_changed_at_not_null NOT NULL,
    CONSTRAINT commercial_store_type_commission_default_event_values_chk CHECK ((((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128)) AND (length(btrim(request_hash)) = 64) AND ((length(btrim(commercial_store_type_id)) >= 1) AND (length(btrim(commercial_store_type_id)) <= 128)) AND (fulfillment_mode = ANY (ARRAY['BTHWANI_CAPTAIN'::text, 'PARTNER_CAPTAIN'::text, 'CUSTOMER_PICKUP'::text])) AND ((previous_rate_bps IS NULL) OR ((previous_rate_bps >= 0) AND (previous_rate_bps <= 10000))) AND ((new_rate_bps >= 0) AND (new_rate_bps <= 10000)) AND (((previous_policy_version IS NULL) AND (new_policy_version = 1)) OR ((previous_policy_version > 0) AND (new_policy_version = (previous_policy_version + 1)))) AND ((length(btrim(changed_by_actor_id)) >= 1) AND (length(btrim(changed_by_actor_id)) <= 128)) AND ((length(btrim(reason)) >= 8) AND (length(btrim(reason)) <= 500)) AND ((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))))
);


--
-- Name: commercial_store_type_commission_defaults; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.commercial_store_type_commission_defaults (
    commercial_store_type_id text CONSTRAINT commercial_store_type_commiss_commercial_store_type_id_not_null NOT NULL,
    fulfillment_mode text CONSTRAINT commercial_store_type_commission_poli_fulfillment_mode_not_null NOT NULL,
    commission_rate_bps integer CONSTRAINT commercial_store_type_commission_p_commission_rate_bps_not_null NOT NULL,
    policy_version integer DEFAULT 1 CONSTRAINT commercial_store_type_commission_polici_policy_version_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT commercial_store_type_commission_policies_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT commercial_store_type_commission_policies_updated_at_not_null NOT NULL,
    last_changed_by_actor_id text,
    last_change_reason text,
    CONSTRAINT commercial_store_type_commission_defaults_change_chk CHECK ((((last_changed_by_actor_id IS NULL) AND (last_change_reason IS NULL)) OR ((last_changed_by_actor_id IS NOT NULL) AND (last_change_reason IS NOT NULL) AND ((length(btrim(last_changed_by_actor_id)) >= 1) AND (length(btrim(last_changed_by_actor_id)) <= 128)) AND ((length(btrim(last_change_reason)) >= 8) AND (length(btrim(last_change_reason)) <= 500))))),
    CONSTRAINT commercial_store_type_commission_defaults_mode_chk CHECK ((fulfillment_mode = ANY (ARRAY['BTHWANI_CAPTAIN'::text, 'PARTNER_CAPTAIN'::text, 'CUSTOMER_PICKUP'::text]))),
    CONSTRAINT commercial_store_type_commission_defaults_rate_chk CHECK (((commission_rate_bps >= 0) AND (commission_rate_bps <= 10000))),
    CONSTRAINT commercial_store_type_commission_defaults_type_chk CHECK (((length(btrim(commercial_store_type_id)) >= 1) AND (length(btrim(commercial_store_type_id)) <= 128))),
    CONSTRAINT commercial_store_type_commission_defaults_version_chk CHECK ((policy_version > 0))
);


--
-- Name: customer_manual_withdrawal_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.customer_manual_withdrawal_events (
    id text NOT NULL,
    intake_id text NOT NULL,
    event_type text NOT NULL,
    acting_actor_id text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    evidence_document_id text,
    payout_id text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT customer_withdrawal_events_actor_chk CHECK (((length(btrim(acting_actor_id)) >= 1) AND (length(btrim(acting_actor_id)) <= 128))),
    CONSTRAINT customer_withdrawal_events_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT customer_withdrawal_events_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT customer_withdrawal_events_reason_chk CHECK ((length(reason) <= 512)),
    CONSTRAINT customer_withdrawal_events_type_chk CHECK ((event_type = ANY (ARRAY['OPS_REQUESTED'::text, 'DESTINATION_PREPARED'::text, 'DESTINATION_VERIFIED'::text, 'DESTINATION_ACTIVATED'::text, 'FINANCE_ACCEPTED'::text, 'FINANCE_REJECTED'::text, 'PAYOUT_COMPLETED'::text])))
);


--
-- Name: customer_manual_withdrawal_intakes; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.customer_manual_withdrawal_intakes (
    id text NOT NULL,
    customer_actor_id text NOT NULL,
    provider_key text NOT NULL,
    wallet_identifier_ciphertext text CONSTRAINT customer_manual_withdrawal__wallet_identifier_cipherte_not_null NOT NULL,
    wallet_identifier_masked text CONSTRAINT customer_manual_withdrawal_in_wallet_identifier_masked_not_null NOT NULL,
    beneficiary_name text NOT NULL,
    beneficiary_identity_version integer CONSTRAINT customer_manual_withdrawal__beneficiary_identity_versi_not_null NOT NULL,
    request_reason text NOT NULL,
    request_evidence_document_id text CONSTRAINT customer_manual_withdrawal__request_evidence_document__not_null NOT NULL,
    status text DEFAULT 'REQUESTED'::text NOT NULL,
    destination_id text,
    payout_id text,
    requested_by text NOT NULL,
    requested_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finance_actor_id text,
    resolved_at timestamp with time zone,
    resolution_reason text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    identity_actor_version integer,
    identity_role_version integer,
    role_enabled boolean,
    security_enabled boolean,
    official_name_status text,
    CONSTRAINT customer_withdrawal_intakes_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT customer_withdrawal_intakes_customer_chk CHECK (((length(btrim(customer_actor_id)) >= 1) AND (length(btrim(customer_actor_id)) <= 128))),
    CONSTRAINT customer_withdrawal_intakes_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT customer_withdrawal_intakes_identity_facts_chk CHECK ((((identity_actor_version IS NULL) AND (identity_role_version IS NULL) AND (role_enabled IS NULL) AND (security_enabled IS NULL) AND (official_name_status IS NULL)) OR ((identity_actor_version > 0) AND (identity_role_version > 0) AND (role_enabled IS TRUE) AND (security_enabled IS TRUE) AND (official_name_status = 'VERIFIED'::text)))),
    CONSTRAINT customer_withdrawal_intakes_name_chk CHECK ((((length(btrim(beneficiary_name)) >= 1) AND (length(btrim(beneficiary_name)) <= 320)) AND (beneficiary_identity_version > 0))),
    CONSTRAINT customer_withdrawal_intakes_operator_chk CHECK ((((length(btrim(requested_by)) >= 1) AND (length(btrim(requested_by)) <= 128)) AND ((finance_actor_id IS NULL) OR ((length(btrim(finance_actor_id)) >= 1) AND (length(btrim(finance_actor_id)) <= 128))))),
    CONSTRAINT customer_withdrawal_intakes_provider_chk CHECK (((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64))),
    CONSTRAINT customer_withdrawal_intakes_reason_chk CHECK (((length(btrim(request_reason)) >= 1) AND (length(btrim(request_reason)) <= 512))),
    CONSTRAINT customer_withdrawal_intakes_resolution_chk CHECK (((resolution_reason IS NULL) OR ((length(btrim(resolution_reason)) >= 1) AND (length(btrim(resolution_reason)) <= 512)))),
    CONSTRAINT customer_withdrawal_intakes_state_chk CHECK ((((status = 'REQUESTED'::text) AND (destination_id IS NULL) AND (payout_id IS NULL) AND (finance_actor_id IS NULL) AND (resolved_at IS NULL)) OR ((status = 'DESTINATION_PENDING'::text) AND (destination_id IS NOT NULL) AND (payout_id IS NULL) AND (finance_actor_id IS NOT NULL) AND (resolved_at IS NOT NULL)) OR ((status = ANY (ARRAY['PAYOUT_HELD'::text, 'COMPLETED'::text])) AND (destination_id IS NOT NULL) AND (payout_id IS NOT NULL) AND (finance_actor_id IS NOT NULL) AND (resolved_at IS NOT NULL)) OR ((status = 'REJECTED'::text) AND (finance_actor_id IS NOT NULL) AND (resolved_at IS NOT NULL) AND ((length(btrim(resolution_reason)) >= 1) AND (length(btrim(resolution_reason)) <= 512))))),
    CONSTRAINT customer_withdrawal_intakes_status_chk CHECK ((status = ANY (ARRAY['REQUESTED'::text, 'DESTINATION_PENDING'::text, 'PAYOUT_HELD'::text, 'REJECTED'::text, 'COMPLETED'::text]))),
    CONSTRAINT customer_withdrawal_intakes_wallet_chk CHECK (((length(btrim(wallet_identifier_ciphertext)) > 0) AND ((length(btrim(wallet_identifier_masked)) >= 4) AND (length(btrim(wallet_identifier_masked)) <= 128))))
);


--
-- Name: customer_payment_allocation_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.customer_payment_allocation_events (
    id bigint CONSTRAINT payment_allocation_events_id_not_null NOT NULL,
    allocation_id text CONSTRAINT payment_allocation_events_allocation_id_not_null NOT NULL,
    event_type text CONSTRAINT payment_allocation_events_event_type_not_null NOT NULL,
    order_id text CONSTRAINT payment_allocation_events_order_id_not_null NOT NULL,
    payment_intent_id text CONSTRAINT payment_allocation_events_payment_intent_id_not_null NOT NULL,
    request_hash text CONSTRAINT payment_allocation_events_request_hash_not_null NOT NULL,
    idempotency_key text CONSTRAINT payment_allocation_events_idempotency_key_not_null NOT NULL,
    correlation_id text CONSTRAINT payment_allocation_events_correlation_id_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT payment_allocation_events_created_at_not_null NOT NULL,
    CONSTRAINT customer_payment_allocation_events_type_chk CHECK ((event_type = 'CUSTOMER_PAYMENT_ALLOCATION_CREATED'::text))
);


--
-- Name: customer_payment_allocations; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.customer_payment_allocations (
    id text CONSTRAINT payment_allocations_id_not_null NOT NULL,
    order_id text CONSTRAINT payment_allocations_order_id_not_null NOT NULL,
    payment_intent_id text CONSTRAINT payment_allocations_payment_intent_id_not_null NOT NULL,
    currency text DEFAULT 'YER'::text CONSTRAINT payment_allocations_currency_not_null NOT NULL,
    subtotal_minor bigint CONSTRAINT payment_allocations_subtotal_minor_not_null NOT NULL,
    delivery_fee_minor bigint DEFAULT 0 CONSTRAINT payment_allocations_delivery_fee_minor_not_null NOT NULL,
    discount_minor bigint DEFAULT 0 CONSTRAINT payment_allocations_discount_minor_not_null NOT NULL,
    internal_balance_amount_minor bigint DEFAULT 0 CONSTRAINT payment_allocations_internal_wallet_amount_minor_not_null NOT NULL,
    cash_amount_minor bigint DEFAULT 0 CONSTRAINT payment_allocations_cash_amount_minor_not_null NOT NULL,
    customer_payable_minor bigint CONSTRAINT payment_allocations_total_minor_not_null NOT NULL,
    policy_version text CONSTRAINT payment_allocations_policy_version_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT payment_allocations_created_at_not_null NOT NULL,
    store_id text,
    partner_actor_id_snapshot text,
    fulfillment_mode text,
    commission_rate_bps_snapshot integer,
    commission_policy_version_snapshot integer,
    commission_profile_id_snapshot text,
    commission_profile_version_snapshot integer,
    commission_rounding_unit_minor_snapshot bigint,
    commission_settlement_period_snapshot text,
    commercial_store_type_id text,
    commission_snapshot_source text DEFAULT 'LEGACY_PRE_AGREEMENT'::text CONSTRAINT customer_payment_allocation_commission_snapshot_source_not_null NOT NULL,
    commission_agreement_id_snapshot text,
    commission_agreement_version_snapshot integer,
    commission_calculation_basis_snapshot text,
    delivery_margin_minor bigint DEFAULT 0 NOT NULL,
    CONSTRAINT customer_payment_allocations_agreement_snapshot_chk CHECK (((commission_snapshot_source = ANY (ARRAY['LEGACY_PRE_AGREEMENT'::text, 'STORE_AGREEMENT'::text])) AND (((commission_snapshot_source = 'LEGACY_PRE_AGREEMENT'::text) AND (commission_agreement_id_snapshot IS NULL) AND (commission_agreement_version_snapshot IS NULL) AND (commission_calculation_basis_snapshot IS NULL)) OR ((commission_snapshot_source = 'STORE_AGREEMENT'::text) AND (store_id IS NOT NULL) AND (partner_actor_id_snapshot IS NOT NULL) AND (fulfillment_mode IS NOT NULL) AND (commission_rate_bps_snapshot IS NOT NULL) AND (commission_policy_version_snapshot IS NOT NULL) AND (commission_profile_id_snapshot IS NOT NULL) AND (commission_profile_version_snapshot IS NOT NULL) AND (commission_rounding_unit_minor_snapshot IS NOT NULL) AND (commission_settlement_period_snapshot IS NOT NULL) AND (commission_agreement_id_snapshot IS NOT NULL) AND (commission_agreement_version_snapshot > 0) AND (commission_calculation_basis_snapshot = 'SUBTOTAL_MINUS_DISCOUNT'::text))))),
    CONSTRAINT customer_payment_allocations_commission_snapshot_chk CHECK ((((store_id IS NULL) AND (partner_actor_id_snapshot IS NULL) AND (fulfillment_mode IS NULL) AND (commission_rate_bps_snapshot IS NULL) AND (commission_policy_version_snapshot IS NULL) AND (commission_profile_id_snapshot IS NULL) AND (commission_profile_version_snapshot IS NULL) AND (commission_rounding_unit_minor_snapshot IS NULL) AND (commission_settlement_period_snapshot IS NULL) AND (commercial_store_type_id IS NULL)) OR ((store_id IS NOT NULL) AND (partner_actor_id_snapshot IS NOT NULL) AND (fulfillment_mode IS NOT NULL) AND (commission_rate_bps_snapshot IS NOT NULL) AND (commission_policy_version_snapshot IS NOT NULL) AND (commission_profile_id_snapshot IS NOT NULL) AND (commission_profile_version_snapshot IS NOT NULL) AND (commission_rounding_unit_minor_snapshot IS NOT NULL) AND (commission_settlement_period_snapshot IS NOT NULL) AND ((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128)) AND ((length(btrim(partner_actor_id_snapshot)) >= 1) AND (length(btrim(partner_actor_id_snapshot)) <= 128)) AND (fulfillment_mode = ANY (ARRAY['BTHWANI_CAPTAIN'::text, 'PARTNER_CAPTAIN'::text, 'CUSTOMER_PICKUP'::text])) AND ((commission_rate_bps_snapshot >= 0) AND (commission_rate_bps_snapshot <= 10000)) AND (((commission_snapshot_source = 'LEGACY_PRE_AGREEMENT'::text) AND (commission_policy_version_snapshot > 0)) OR ((commission_snapshot_source = 'STORE_AGREEMENT'::text) AND (commission_policy_version_snapshot = 0))) AND ((length(btrim(commission_profile_id_snapshot)) >= 1) AND (length(btrim(commission_profile_id_snapshot)) <= 128)) AND (commission_profile_version_snapshot > 0) AND (commission_rounding_unit_minor_snapshot = 50) AND (commission_settlement_period_snapshot = ANY (ARRAY['DAILY'::text, 'WEEKLY'::text, 'MONTHLY'::text])) AND ((commercial_store_type_id IS NULL) OR ((length(btrim(commercial_store_type_id)) >= 1) AND (length(btrim(commercial_store_type_id)) <= 128)))))),
    CONSTRAINT customer_payment_allocations_funding_chk CHECK (((internal_balance_amount_minor + cash_amount_minor) = customer_payable_minor)),
    CONSTRAINT customer_payment_allocations_margin_chk CHECK (((delivery_margin_minor >= 0) AND (delivery_margin_minor <= delivery_fee_minor) AND ((delivery_margin_minor = 0) OR (fulfillment_mode = 'BTHWANI_CAPTAIN'::text)))),
    CONSTRAINT customer_payment_allocations_nonnegative_chk CHECK (((subtotal_minor >= 0) AND (delivery_fee_minor >= 0) AND (discount_minor >= 0) AND (internal_balance_amount_minor >= 0) AND (cash_amount_minor >= 0) AND (customer_payable_minor > 0))),
    CONSTRAINT customer_payment_allocations_payable_chk CHECK ((customer_payable_minor = ((subtotal_minor + delivery_fee_minor) - discount_minor))),
    CONSTRAINT payment_allocations_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT payment_allocations_policy_chk CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 512)))
);


--
-- Name: customer_wallet_compensations; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.customer_wallet_compensations (
    case_id text NOT NULL,
    order_id text NOT NULL,
    customer_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    approved_by_actor_id text NOT NULL,
    evidence_reference text NOT NULL,
    ledger_transaction_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT customer_wallet_compensation_approver_chk CHECK (((length(btrim(approved_by_actor_id)) >= 1) AND (length(btrim(approved_by_actor_id)) <= 128))),
    CONSTRAINT customer_wallet_compensation_evidence_chk CHECK (((length(btrim(evidence_reference)) >= 8) AND (length(btrim(evidence_reference)) <= 128))),
    CONSTRAINT customer_wallet_compensations_amount_minor_check CHECK ((amount_minor > 0))
);


--
-- Name: delivery_fee_policies; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.delivery_fee_policies (
    id text NOT NULL,
    service_city_id text DEFAULT ''::text NOT NULL,
    policy_version text NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    base_fee_minor bigint DEFAULT 0 NOT NULL,
    distance_unit_meters bigint NOT NULL,
    distance_rate_minor bigint DEFAULT 0 NOT NULL,
    order_size_unit_base_units bigint NOT NULL,
    order_size_rate_minor bigint DEFAULT 0 NOT NULL,
    zone_surcharge_minor bigint DEFAULT 0 NOT NULL,
    rounding_unit_minor bigint DEFAULT 50 NOT NULL,
    version integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    retired_at timestamp with time zone,
    distance_bands jsonb,
    CONSTRAINT delivery_fee_band_structure_chk CHECK (((distance_bands IS NULL) OR ((jsonb_typeof(distance_bands) = 'array'::text) AND ((jsonb_array_length(distance_bands) >= 1) AND (jsonb_array_length(distance_bands) <= 30))))),
    CONSTRAINT delivery_fee_policies_base_chk CHECK ((base_fee_minor >= 0)),
    CONSTRAINT delivery_fee_policies_creator_chk CHECK (((length(btrim(created_by)) >= 1) AND (length(btrim(created_by)) <= 128))),
    CONSTRAINT delivery_fee_policies_distance_rate_chk CHECK ((distance_rate_minor >= 0)),
    CONSTRAINT delivery_fee_policies_distance_unit_chk CHECK ((distance_unit_meters > 0)),
    CONSTRAINT delivery_fee_policies_retired_chk CHECK ((((state = 'ACTIVE'::text) AND (retired_at IS NULL)) OR ((state = 'RETIRED'::text) AND (retired_at IS NOT NULL)))),
    CONSTRAINT delivery_fee_policies_rounding_chk CHECK ((rounding_unit_minor = 50)),
    CONSTRAINT delivery_fee_policies_size_rate_chk CHECK ((order_size_rate_minor >= 0)),
    CONSTRAINT delivery_fee_policies_size_unit_chk CHECK ((order_size_unit_base_units > 0)),
    CONSTRAINT delivery_fee_policies_state_chk CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))),
    CONSTRAINT delivery_fee_policies_version_chk CHECK ((version > 0)),
    CONSTRAINT delivery_fee_policies_zone_chk CHECK ((zone_surcharge_minor >= 0))
);


--
-- Name: delivery_fee_policy_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.delivery_fee_policy_events (
    id bigint NOT NULL,
    policy_id text NOT NULL,
    event_type text NOT NULL,
    service_city_id text NOT NULL,
    policy_version text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expected_version integer DEFAULT 0 NOT NULL,
    change_reason text DEFAULT 'legacy policy activation'::text NOT NULL,
    CONSTRAINT delivery_fee_policy_events_change_reason_chk CHECK (((length(btrim(change_reason)) >= 5) AND (length(btrim(change_reason)) <= 500))),
    CONSTRAINT delivery_fee_policy_events_expected_version_chk CHECK ((expected_version >= 0)),
    CONSTRAINT delivery_fee_policy_events_text_chk CHECK (((length(btrim(service_city_id)) <= 128) AND ((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 128)) AND ((length(btrim(request_hash)) >= 1) AND (length(btrim(request_hash)) <= 128)) AND ((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128)) AND ((length(btrim(acting_actor_id)) >= 1) AND (length(btrim(acting_actor_id)) <= 128)))),
    CONSTRAINT delivery_fee_policy_events_type_chk CHECK ((event_type = 'DELIVERY_FEE_POLICY_ACTIVATED'::text))
);


--
-- Name: delivery_fee_policy_events_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

ALTER TABLE wlt.delivery_fee_policy_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME wlt.delivery_fee_policy_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: field_acquisition_entitlements; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.field_acquisition_entitlements (
    store_id text CONSTRAINT field_commission_earnings_store_id_not_null NOT NULL,
    field_actor_id text CONSTRAINT field_commission_earnings_field_actor_id_not_null NOT NULL,
    vertical_id text CONSTRAINT field_commission_earnings_vertical_id_not_null NOT NULL,
    policy_id text CONSTRAINT field_commission_earnings_policy_id_not_null NOT NULL,
    policy_version integer CONSTRAINT field_commission_earnings_policy_version_not_null NOT NULL,
    reward_minor bigint CONSTRAINT field_commission_earnings_reward_minor_not_null NOT NULL,
    currency text DEFAULT 'YER'::text CONSTRAINT field_commission_earnings_currency_not_null NOT NULL,
    ledger_transaction_id text CONSTRAINT field_commission_earnings_ledger_transaction_id_not_null NOT NULL,
    idempotency_key text CONSTRAINT field_commission_earnings_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT field_commission_earnings_request_hash_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT field_commission_earnings_created_at_not_null NOT NULL,
    joining_case_id text,
    partner_actor_id text,
    commercial_store_type_id text,
    CONSTRAINT field_acquisition_entitlements_acquisition_pair_chk CHECK ((((joining_case_id IS NULL) AND (partner_actor_id IS NULL)) OR (((length(btrim(joining_case_id)) >= 1) AND (length(btrim(joining_case_id)) <= 128)) AND ((length(btrim(partner_actor_id)) >= 1) AND (length(btrim(partner_actor_id)) <= 128))))),
    CONSTRAINT field_acquisition_entitlements_commercial_type_chk CHECK (((commercial_store_type_id IS NULL) OR ((length(btrim(commercial_store_type_id)) >= 1) AND (length(btrim(commercial_store_type_id)) <= 128)))),
    CONSTRAINT field_acquisition_entitlements_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT field_acquisition_entitlements_field_actor_chk CHECK (((length(btrim(field_actor_id)) >= 1) AND (length(btrim(field_actor_id)) <= 128))),
    CONSTRAINT field_acquisition_entitlements_policy_version_chk CHECK ((policy_version > 0)),
    CONSTRAINT field_acquisition_entitlements_reward_chk CHECK ((reward_minor > 0)),
    CONSTRAINT field_acquisition_entitlements_vertical_chk CHECK (((length(btrim(vertical_id)) >= 1) AND (length(btrim(vertical_id)) <= 128)))
);


--
-- Name: field_acquisition_reward_policies; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.field_acquisition_reward_policies (
    id text CONSTRAINT field_commission_policies_id_not_null NOT NULL,
    scope_type text CONSTRAINT field_commission_policies_scope_type_not_null NOT NULL,
    scope_id text,
    reward_minor bigint CONSTRAINT field_commission_policies_reward_minor_not_null NOT NULL,
    rounding_unit_minor bigint DEFAULT 50 CONSTRAINT field_commission_policies_rounding_unit_minor_not_null NOT NULL,
    state text DEFAULT 'ACTIVE'::text CONSTRAINT field_commission_policies_state_not_null NOT NULL,
    version integer DEFAULT 1 CONSTRAINT field_commission_policies_version_not_null NOT NULL,
    created_by text CONSTRAINT field_commission_policies_created_by_not_null NOT NULL,
    idempotency_key text CONSTRAINT field_commission_policies_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT field_commission_policies_request_hash_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT field_commission_policies_created_at_not_null NOT NULL,
    retired_at timestamp with time zone,
    correlation_id text DEFAULT 'legacy-policy-event'::text CONSTRAINT field_commission_policies_correlation_id_not_null NOT NULL,
    expected_version integer DEFAULT 0 CONSTRAINT field_commission_policies_expected_version_not_null NOT NULL,
    change_reason text DEFAULT 'legacy policy activation'::text CONSTRAINT field_commission_policies_change_reason_not_null NOT NULL,
    CONSTRAINT field_acquisition_reward_policies_active_store_type_chk CHECK (((state <> 'ACTIVE'::text) OR ((scope_type = 'STORE_TYPE'::text) AND ((length(btrim(scope_id)) >= 1) AND (length(btrim(scope_id)) <= 128))))),
    CONSTRAINT field_acquisition_reward_policies_creator_chk CHECK (((length(btrim(created_by)) >= 1) AND (length(btrim(created_by)) <= 128))),
    CONSTRAINT field_acquisition_reward_policies_reward_chk CHECK ((reward_minor > 0)),
    CONSTRAINT field_acquisition_reward_policies_rounding_chk CHECK ((rounding_unit_minor = 50)),
    CONSTRAINT field_acquisition_reward_policies_scope_chk CHECK ((((scope_type = 'DEFAULT'::text) AND (scope_id IS NULL)) OR ((scope_type = ANY (ARRAY['VERTICAL'::text, 'STORE'::text, 'STORE_TYPE'::text])) AND ((length(btrim(scope_id)) >= 1) AND (length(btrim(scope_id)) <= 128))))),
    CONSTRAINT field_acquisition_reward_policies_state_chk CHECK ((((state = 'ACTIVE'::text) AND (retired_at IS NULL)) OR ((state = 'RETIRED'::text) AND (retired_at IS NOT NULL)))),
    CONSTRAINT field_acquisition_reward_policies_version_chk CHECK ((version > 0)),
    CONSTRAINT field_commission_policies_change_reason_chk CHECK (((length(btrim(change_reason)) >= 5) AND (length(btrim(change_reason)) <= 500))),
    CONSTRAINT field_commission_policies_correlation_id_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT field_commission_policies_expected_version_chk CHECK ((expected_version >= 0))
);


--
-- Name: finance_evidence_documents; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.finance_evidence_documents (
    id text NOT NULL,
    purpose text NOT NULL,
    original_filename text NOT NULL,
    content_type text NOT NULL,
    content_sha256 text NOT NULL,
    content_ciphertext bytea NOT NULL,
    content_size_bytes bigint NOT NULL,
    uploaded_by text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT finance_evidence_documents_actor_chk CHECK (((length(btrim(uploaded_by)) >= 1) AND (length(btrim(uploaded_by)) <= 128))),
    CONSTRAINT finance_evidence_documents_content_chk CHECK (((octet_length(content_ciphertext) > 28) AND ((content_size_bytes >= 1) AND (content_size_bytes <= 10485760)))),
    CONSTRAINT finance_evidence_documents_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT finance_evidence_documents_digest_chk CHECK ((content_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT finance_evidence_documents_name_chk CHECK (((length(btrim(original_filename)) >= 1) AND (length(btrim(original_filename)) <= 255))),
    CONSTRAINT finance_evidence_documents_purpose_chk CHECK ((purpose = ANY (ARRAY['TRANSFER_RECEIPT'::text, 'SETTLEMENT_STATEMENT'::text, 'CUSTOMER_WITHDRAWAL_REQUEST'::text, 'SETTLEMENT_BATCH_EXPORT'::text, 'CAPTAIN_COD_LEGACY_RECOVERY'::text]))),
    CONSTRAINT finance_evidence_documents_request_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT finance_evidence_documents_type_chk CHECK ((content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'text/csv'::text, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text])))
);


--
-- Name: finance_transfer_receipt_claims; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.finance_transfer_receipt_claims (
    evidence_document_id text NOT NULL,
    transfer_type text NOT NULL,
    transfer_id text NOT NULL,
    claimed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT finance_transfer_receipt_claims_transfer_chk CHECK (((length(btrim(transfer_id)) >= 1) AND (length(btrim(transfer_id)) <= 128))),
    CONSTRAINT finance_transfer_receipt_claims_type_chk CHECK ((transfer_type = ANY (ARRAY['CAPTAIN_CASH_REMITTANCE'::text, 'PARTNER_COMMISSION_REMITTANCE'::text, 'BENEFICIARY_PAYOUT_TRANSFER'::text])))
);


--
-- Name: ledger_entries; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.ledger_entries (
    id bigint NOT NULL,
    transaction_id text NOT NULL,
    line_sequence integer NOT NULL,
    account_class text NOT NULL,
    account_code text NOT NULL,
    actor_type text,
    actor_id text,
    direction text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT ledger_entries_actor_chk CHECK ((((account_code = ANY (ARRAY['PARTNER_WALLET'::text, 'CAPTAIN_WALLET'::text, 'FIELD_WALLET'::text])) AND (actor_type = ANY (ARRAY['partner'::text, 'captain'::text, 'field'::text])) AND (actor_id IS NOT NULL)) OR ((account_code = 'CUSTOMER_WALLET'::text) AND (actor_type = 'customer'::text) AND (actor_id IS NOT NULL)) OR ((account_code = 'PARTNER_COMMISSION_RECEIVABLE'::text) AND (actor_type = 'partner'::text) AND (actor_id IS NOT NULL)) OR ((account_code <> ALL (ARRAY['PARTNER_WALLET'::text, 'CAPTAIN_WALLET'::text, 'FIELD_WALLET'::text, 'CUSTOMER_WALLET'::text, 'PARTNER_COMMISSION_RECEIVABLE'::text])) AND (actor_type IS NULL) AND (actor_id IS NULL)))),
    CONSTRAINT ledger_entries_amount_chk CHECK ((amount_minor > 0)),
    CONSTRAINT ledger_entries_class_chk CHECK ((account_class = ANY (ARRAY['asset'::text, 'liability'::text, 'income'::text, 'expense'::text]))),
    CONSTRAINT ledger_entries_code_chk CHECK ((account_code = ANY (ARRAY['CAPTAIN_CASH_RECEIVABLE'::text, 'CUSTOMER_PAYMENT_CLEARING'::text, 'PARTNER_WALLET'::text, 'CAPTAIN_WALLET'::text, 'FIELD_WALLET'::text, 'PLATFORM_COMMISSION_INCOME'::text, 'FIELD_ACQUISITION_REWARD_EXPENSE'::text, 'EXTERNAL_SETTLEMENT_CASH'::text, 'PARTNER_COMMISSION_RECEIVABLE'::text, 'CUSTOMER_WALLET'::text, 'BTHWANI_PROMOTION_EXPENSE'::text, 'CUSTOMER_COMPENSATION_EXPENSE'::text, 'PLATFORM_DELIVERY_MARGIN_INCOME'::text, 'PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE'::text]))),
    CONSTRAINT ledger_entries_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT ledger_entries_direction_chk CHECK ((direction = ANY (ARRAY['DEBIT'::text, 'CREDIT'::text])))
);


--
-- Name: ledger_entries_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

ALTER TABLE wlt.ledger_entries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME wlt.ledger_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ledger_transactions; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.ledger_transactions (
    id text NOT NULL,
    transaction_type text NOT NULL,
    source_type text NOT NULL,
    source_id text NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT ledger_transactions_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT ledger_transactions_source_chk CHECK ((((length(btrim(source_type)) >= 1) AND (length(btrim(source_type)) <= 64)) AND ((length(btrim(source_id)) >= 1) AND (length(btrim(source_id)) <= 128))))
);


--
-- Name: manual_transfer_executions; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.manual_transfer_executions (
    id text NOT NULL,
    batch_id text NOT NULL,
    payout_id text NOT NULL,
    approved_snapshot_hash text NOT NULL,
    executed_by text NOT NULL,
    executed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    provider_key text NOT NULL,
    external_transfer_reference text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    legacy_evidence_reference text,
    execution_status text DEFAULT 'EXECUTED'::text NOT NULL,
    verified_by text,
    verified_at timestamp with time zone,
    legacy_statement_reference text,
    reconciled_by text,
    reconciled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    receipt_document_id text,
    statement_row_id text,
    CONSTRAINT manual_transfer_executions_execute_verify_sod_chk CHECK (((verified_by IS NULL) OR (executed_by <> verified_by))),
    CONSTRAINT manual_transfer_executions_status_chk CHECK ((execution_status = ANY (ARRAY['EXECUTED'::text, 'VERIFIED'::text, 'RECONCILED'::text]))),
    CONSTRAINT manual_transfer_executions_values_chk CHECK (((length(btrim(approved_snapshot_hash)) > 0) AND ((length(btrim(executed_by)) >= 1) AND (length(btrim(executed_by)) <= 128)) AND ((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64)) AND ((length(btrim(external_transfer_reference)) >= 1) AND (length(btrim(external_transfer_reference)) <= 160)) AND (amount_minor > 0) AND (currency = 'YER'::text) AND (destination_version > 0) AND ((length(btrim(legacy_evidence_reference)) >= 0) AND (length(btrim(legacy_evidence_reference)) <= 512)))),
    CONSTRAINT manual_transfer_executions_verification_chk CHECK ((((verified_by IS NULL) AND (verified_at IS NULL)) OR ((verified_by IS NOT NULL) AND (verified_at IS NOT NULL))))
);


--
-- Name: official_wallet_destination_transitions; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.official_wallet_destination_transitions (
    id text NOT NULL,
    destination_id text NOT NULL,
    operation text NOT NULL,
    idempotency_key text CONSTRAINT official_wallet_destination_transition_idempotency_key_not_null NOT NULL,
    request_hash text NOT NULL,
    actor_id text NOT NULL,
    correlation_id text NOT NULL,
    evidence_reference text DEFAULT ''::text CONSTRAINT official_wallet_destination_transit_evidence_reference_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT official_wallet_destination_transitions_actor_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT official_wallet_destination_transitions_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT official_wallet_destination_transitions_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT official_wallet_destination_transitions_operation_chk CHECK ((operation = ANY (ARRAY['VERIFY'::text, 'ACTIVATE'::text, 'IDENTITY_STALE'::text])))
);


--
-- Name: official_wallet_destinations; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.official_wallet_destinations (
    id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    provider_key text NOT NULL,
    wallet_identifier_ciphertext text CONSTRAINT official_wallet_destination_wallet_identifier_cipherte_not_null NOT NULL,
    wallet_identifier_masked text NOT NULL,
    beneficiary_name text NOT NULL,
    verification_status text DEFAULT 'PENDING_VERIFICATION'::text NOT NULL,
    status text DEFAULT 'CANDIDATE'::text NOT NULL,
    version integer NOT NULL,
    change_reason text NOT NULL,
    submitted_by text NOT NULL,
    submitted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    verified_by text,
    verified_at timestamp with time zone,
    approved_by text,
    approved_at timestamp with time zone,
    verification_evidence_reference text CONSTRAINT official_wallet_destination_verification_evidence_refe_not_null NOT NULL,
    change_evidence_reference text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    beneficiary_identity_version integer,
    identity_actor_version integer,
    identity_role_version integer,
    role_enabled boolean,
    security_enabled boolean,
    official_name_status text,
    CONSTRAINT official_wallet_destinations_active_state_chk CHECK ((((status = 'ACTIVE_FOR_PAYOUT'::text) AND (verification_status = 'VERIFIED'::text)) OR (status <> 'ACTIVE_FOR_PAYOUT'::text))),
    CONSTRAINT official_wallet_destinations_actor_chk CHECK ((actor_type = ANY (ARRAY['customer'::text, 'partner'::text, 'captain'::text, 'field'::text]))),
    CONSTRAINT official_wallet_destinations_actor_id_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT official_wallet_destinations_beneficiary_chk CHECK (((length(btrim(beneficiary_name)) >= 1) AND (length(btrim(beneficiary_name)) <= 320))),
    CONSTRAINT official_wallet_destinations_evidence_chk CHECK ((((length(btrim(verification_evidence_reference)) >= 1) AND (length(btrim(verification_evidence_reference)) <= 512)) AND ((length(btrim(change_evidence_reference)) >= 1) AND (length(btrim(change_evidence_reference)) <= 512)))),
    CONSTRAINT official_wallet_destinations_identifier_chk CHECK (((length(btrim(wallet_identifier_ciphertext)) > 0) AND ((length(btrim(wallet_identifier_masked)) >= 4) AND (length(btrim(wallet_identifier_masked)) <= 128)))),
    CONSTRAINT official_wallet_destinations_identity_facts_chk CHECK ((((verification_status = 'STALE'::text) AND (status = 'SUSPENDED'::text)) OR ((verification_status <> 'STALE'::text) AND (identity_actor_version > 0) AND (identity_role_version > 0) AND (role_enabled IS TRUE) AND (security_enabled IS TRUE) AND (official_name_status = 'VERIFIED'::text) AND (beneficiary_identity_version > 0)))),
    CONSTRAINT official_wallet_destinations_identity_version_chk CHECK (((beneficiary_identity_version IS NULL) OR (beneficiary_identity_version > 0))),
    CONSTRAINT official_wallet_destinations_provider_chk CHECK (((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64))),
    CONSTRAINT official_wallet_destinations_reason_chk CHECK (((length(btrim(change_reason)) >= 1) AND (length(btrim(change_reason)) <= 512))),
    CONSTRAINT official_wallet_destinations_status_chk CHECK ((status = ANY (ARRAY['CANDIDATE'::text, 'PENDING_APPROVAL'::text, 'ACTIVE_FOR_PAYOUT'::text, 'SUSPENDED'::text, 'RETIRED'::text]))),
    CONSTRAINT official_wallet_destinations_submitted_by_chk CHECK (((length(btrim(submitted_by)) >= 1) AND (length(btrim(submitted_by)) <= 128))),
    CONSTRAINT official_wallet_destinations_verification_chk CHECK ((verification_status = ANY (ARRAY['PENDING_VERIFICATION'::text, 'VERIFIED'::text, 'REJECTED'::text, 'STALE'::text]))),
    CONSTRAINT official_wallet_destinations_version_chk CHECK ((version > 0))
);


--
-- Name: order_adjustment_reconciliation_cases; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.order_adjustment_reconciliation_cases (
    id text NOT NULL,
    order_id text NOT NULL,
    adjustment_id text NOT NULL,
    payment_intent_id text CONSTRAINT order_adjustment_reconciliation_case_payment_intent_id_not_null NOT NULL,
    adjustment_kind text NOT NULL,
    requested_by_actor_id text CONSTRAINT order_adjustment_reconciliation__requested_by_actor_id_not_null NOT NULL,
    customer_actor_id text CONSTRAINT order_adjustment_reconciliation_case_customer_actor_id_not_null NOT NULL,
    state text DEFAULT 'RECONCILIATION_REQUIRED'::text NOT NULL,
    reason_code text DEFAULT 'ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED'::text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT order_adjustment_reconciliation_case_adjustment_chk CHECK (((length(btrim(adjustment_id)) >= 1) AND (length(btrim(adjustment_id)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_customer_chk CHECK (((length(btrim(customer_actor_id)) >= 1) AND (length(btrim(customer_actor_id)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_hash_chk CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT order_adjustment_reconciliation_case_id_chk CHECK (((length(btrim(id)) >= 1) AND (length(btrim(id)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_idempotency_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_kind_chk CHECK ((adjustment_kind = ANY (ARRAY['REMOVE_ITEM'::text, 'SUBSTITUTE_ITEM'::text, 'SET_ACTUAL_QUANTITY'::text]))),
    CONSTRAINT order_adjustment_reconciliation_case_order_chk CHECK (((length(btrim(order_id)) >= 1) AND (length(btrim(order_id)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_reason_chk CHECK ((reason_code = 'ORDER_ADJUSTMENT_FINANCIAL_POLICY_REQUIRED'::text)),
    CONSTRAINT order_adjustment_reconciliation_case_requester_chk CHECK (((length(btrim(requested_by_actor_id)) >= 1) AND (length(btrim(requested_by_actor_id)) <= 128))),
    CONSTRAINT order_adjustment_reconciliation_case_state_chk CHECK ((state = ANY (ARRAY['RECONCILIATION_REQUIRED'::text, 'COMPENSATED'::text])))
);


--
-- Name: order_promotion_funding; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.order_promotion_funding (
    id text NOT NULL,
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    promotion_id text NOT NULL,
    promotion_version integer NOT NULL,
    promotion_code text NOT NULL,
    store_id text DEFAULT ''::text NOT NULL,
    discount_minor bigint NOT NULL,
    funding_source text NOT NULL,
    partner_share_percent integer,
    partner_funded_minor bigint NOT NULL,
    bthwani_funded_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    kind text DEFAULT 'ORDER'::text NOT NULL,
    reversal_of text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT order_promotion_funding_amount_chk CHECK ((discount_minor > 0)),
    CONSTRAINT order_promotion_funding_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT order_promotion_funding_funding_chk CHECK ((funding_source = ANY (ARRAY['PARTNER'::text, 'BTHWANI'::text, 'SHARED'::text]))),
    CONSTRAINT order_promotion_funding_id_chk CHECK (((length(btrim(id)) >= 8) AND (length(btrim(id)) <= 128))),
    CONSTRAINT order_promotion_funding_intent_chk CHECK ((btrim(payment_intent_id) <> ''::text)),
    CONSTRAINT order_promotion_funding_kind_chk CHECK (((kind = ANY (ARRAY['ORDER'::text, 'REVERSAL'::text])) AND ((kind = 'ORDER'::text) = (reversal_of IS NULL)))),
    CONSTRAINT order_promotion_funding_order_chk CHECK (((btrim(order_id) <> ''::text) AND (length(order_id) <= 128))),
    CONSTRAINT order_promotion_funding_promotion_chk CHECK (((btrim(promotion_id) <> ''::text) AND (promotion_version >= 1))),
    CONSTRAINT order_promotion_funding_share_chk CHECK (((partner_share_percent IS NULL) OR ((partner_share_percent >= 1) AND (partner_share_percent <= 99)))),
    CONSTRAINT order_promotion_funding_split_chk CHECK ((((funding_source = 'PARTNER'::text) AND (partner_share_percent IS NULL) AND (partner_funded_minor = discount_minor) AND (bthwani_funded_minor = 0)) OR ((funding_source = 'BTHWANI'::text) AND (partner_share_percent IS NULL) AND (partner_funded_minor = 0) AND (bthwani_funded_minor = discount_minor)) OR ((funding_source = 'SHARED'::text) AND (partner_share_percent IS NOT NULL) AND (partner_funded_minor >= 0) AND (bthwani_funded_minor >= 0) AND ((partner_funded_minor + bthwani_funded_minor) = discount_minor))))
);


--
-- Name: partner_commission_credit_policies; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_commission_credit_policies (
    partner_actor_id text NOT NULL,
    maximum_receivable_minor bigint CONSTRAINT partner_commission_credit_pol_maximum_receivable_minor_not_null NOT NULL,
    maximum_age_days integer NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by_actor_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT partner_commission_credit_polici_maximum_receivable_minor_check CHECK ((maximum_receivable_minor >= 0)),
    CONSTRAINT partner_commission_credit_policies_maximum_age_days_check CHECK (((maximum_age_days >= 1) AND (maximum_age_days <= 365))),
    CONSTRAINT partner_commission_credit_policies_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'DISABLED'::text]))),
    CONSTRAINT partner_commission_credit_policies_version_check CHECK ((version > 0))
);


--
-- Name: partner_commission_rate_history; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_commission_rate_history (
    source_relation text NOT NULL,
    source_id text NOT NULL,
    related_id text,
    policy_version text,
    record_state text,
    commission_rate_bps integer NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT partner_commission_rate_history_id_chk CHECK (((length(btrim(source_id)) >= 1) AND (length(btrim(source_id)) <= 128))),
    CONSTRAINT partner_commission_rate_history_rate_chk CHECK (((commission_rate_bps >= 0) AND (commission_rate_bps <= 10000))),
    CONSTRAINT partner_commission_rate_history_source_chk CHECK ((source_relation = ANY (ARRAY['partner_financial_profiles'::text, 'partner_financial_profile_events'::text, 'partner_financial_terms_policies'::text])))
);


--
-- Name: partner_commission_remittances; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_commission_remittances (
    id text NOT NULL,
    partner_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    remittance_reference text NOT NULL,
    evidence_reference text,
    verified_by text NOT NULL,
    verified_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    ledger_transaction_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    receipt_document_id text,
    CONSTRAINT partner_commission_remittances_amount_chk CHECK ((amount_minor > 0)),
    CONSTRAINT partner_commission_remittances_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT partner_commission_remittances_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT partner_commission_remittances_idempotency_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT partner_commission_remittances_reference_chk CHECK ((((length(btrim(remittance_reference)) >= 1) AND (length(btrim(remittance_reference)) <= 128)) AND (((receipt_document_id IS NOT NULL) AND ((evidence_reference IS NULL) OR ((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 512)))) OR ((receipt_document_id IS NULL) AND (evidence_reference IS NOT NULL) AND ((length(btrim(evidence_reference)) >= 1) AND (length(btrim(evidence_reference)) <= 512)))))),
    CONSTRAINT partner_commission_remittances_verifier_chk CHECK (((length(btrim(verified_by)) >= 1) AND (length(btrim(verified_by)) <= 128)))
);


--
-- Name: partner_financial_profile_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_financial_profile_events (
    id bigint NOT NULL,
    profile_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    actor_id text,
    from_state text,
    to_state text NOT NULL,
    version integer NOT NULL,
    settlement_period text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    terms_policy_version text,
    CONSTRAINT partner_financial_profile_events_settlement_chk CHECK ((settlement_period = ANY (ARRAY['DAILY'::text, 'WEEKLY'::text, 'MONTHLY'::text]))),
    CONSTRAINT partner_financial_profile_events_state_chk CHECK ((to_state = ANY (ARRAY['PENDING_BINDING'::text, 'ACTIVE'::text]))),
    CONSTRAINT partner_financial_profile_events_type_chk CHECK ((event_type = ANY (ARRAY['PROFILE_PREPARED'::text, 'PROFILE_ACTIVATED'::text]))),
    CONSTRAINT partner_financial_profile_events_version_chk CHECK ((version > 0))
);


--
-- Name: partner_financial_profile_events_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

ALTER TABLE wlt.partner_financial_profile_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME wlt.partner_financial_profile_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: partner_financial_profiles; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_financial_profiles (
    id text NOT NULL,
    joining_case_id text NOT NULL,
    partner_actor_id text NOT NULL,
    origin text NOT NULL,
    settlement_period text NOT NULL,
    rounding_unit_minor bigint DEFAULT 50 NOT NULL,
    state text DEFAULT 'PENDING_BINDING'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    activated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    terms_policy_version text,
    CONSTRAINT partner_financial_profiles_activation_chk CHECK ((((state = 'ACTIVE'::text) AND (activated_at IS NOT NULL)) OR ((state = 'PENDING_BINDING'::text) AND (activated_at IS NULL)))),
    CONSTRAINT partner_financial_profiles_origin_chk CHECK ((origin = ANY (ARRAY['field'::text, 'control_panel'::text, 'self_service'::text]))),
    CONSTRAINT partner_financial_profiles_rounding_chk CHECK ((rounding_unit_minor = 50)),
    CONSTRAINT partner_financial_profiles_settlement_chk CHECK ((settlement_period = ANY (ARRAY['DAILY'::text, 'WEEKLY'::text, 'MONTHLY'::text]))),
    CONSTRAINT partner_financial_profiles_state_chk CHECK ((state = ANY (ARRAY['PENDING_BINDING'::text, 'ACTIVE'::text]))),
    CONSTRAINT partner_financial_profiles_version_chk CHECK ((version > 0))
);


--
-- Name: partner_financial_terms_policies; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_financial_terms_policies (
    id text NOT NULL,
    policy_version text NOT NULL,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    settlement_period text NOT NULL,
    version integer NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT partner_financial_terms_policy_retired_chk CHECK ((((state = 'ACTIVE'::text) AND (retired_at IS NULL)) OR ((state = 'RETIRED'::text) AND (retired_at IS NOT NULL)))),
    CONSTRAINT partner_financial_terms_policy_settlement_chk CHECK ((settlement_period = ANY (ARRAY['DAILY'::text, 'WEEKLY'::text, 'MONTHLY'::text]))),
    CONSTRAINT partner_financial_terms_policy_state_chk CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))),
    CONSTRAINT partner_financial_terms_policy_version_chk CHECK ((version > 0))
);


--
-- Name: partner_financial_terms_policy_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_financial_terms_policy_events (
    id bigint NOT NULL,
    policy_id text NOT NULL,
    event_type text NOT NULL,
    policy_version text NOT NULL,
    request_hash text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    expected_version integer NOT NULL,
    change_reason text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT partner_financial_terms_policy_event_expected_version_chk CHECK ((expected_version >= 0)),
    CONSTRAINT partner_financial_terms_policy_event_reason_chk CHECK (((length(btrim(change_reason)) >= 5) AND (length(btrim(change_reason)) <= 500))),
    CONSTRAINT partner_financial_terms_policy_event_type_chk CHECK ((event_type = 'PARTNER_FINANCIAL_TERMS_POLICY_ACTIVATED'::text))
);


--
-- Name: partner_financial_terms_policy_events_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

CREATE SEQUENCE wlt.partner_financial_terms_policy_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_financial_terms_policy_events_id_seq; Type: SEQUENCE OWNED BY; Schema: wlt; Owner: -
--

ALTER SEQUENCE wlt.partner_financial_terms_policy_events_id_seq OWNED BY wlt.partner_financial_terms_policy_events.id;


--
-- Name: partner_order_earnings; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_order_earnings (
    order_id text NOT NULL,
    payment_intent_id text NOT NULL,
    partner_actor_id text NOT NULL,
    captain_actor_id text NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    gross_product_minor bigint NOT NULL,
    delivery_fee_minor bigint NOT NULL,
    commission_minor bigint NOT NULL,
    partner_net_minor bigint NOT NULL,
    profile_id text NOT NULL,
    profile_version integer NOT NULL,
    policy_version text NOT NULL,
    ledger_transaction_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    commission_receivable_offset_minor bigint DEFAULT 0 CONSTRAINT partner_order_earnings_commission_receivable_offset_mi_not_null NOT NULL,
    store_id text DEFAULT ''::text NOT NULL,
    delivery_margin_minor bigint DEFAULT 0 NOT NULL,
    CONSTRAINT partner_order_earnings_amounts_chk CHECK (((gross_product_minor >= 0) AND (delivery_fee_minor >= 0) AND (commission_minor >= 0) AND (partner_net_minor >= 0))),
    CONSTRAINT partner_order_earnings_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT partner_order_earnings_margin_chk CHECK ((delivery_margin_minor >= 0)),
    CONSTRAINT partner_order_earnings_policy_chk CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 512))),
    CONSTRAINT partner_order_earnings_profile_version_chk CHECK ((profile_version > 0)),
    CONSTRAINT partner_order_earnings_receivable_offset_chk CHECK (((commission_receivable_offset_minor >= 0) AND (commission_receivable_offset_minor <= partner_net_minor))),
    CONSTRAINT partner_order_earnings_store_chk CHECK ((length(btrim(store_id)) <= 128))
);


--
-- Name: partner_payout_request_payouts; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_payout_request_payouts (
    request_id text NOT NULL,
    payout_id text NOT NULL,
    group_index integer NOT NULL,
    CONSTRAINT partner_payout_request_payouts_group_chk CHECK ((group_index >= 1))
);


--
-- Name: partner_payout_requests; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_payout_requests (
    id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    partner_actor_id text NOT NULL,
    scope_mode text NOT NULL,
    status text NOT NULL,
    total_amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT partner_payout_requests_amount_chk CHECK ((total_amount_minor > 0)),
    CONSTRAINT partner_payout_requests_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT partner_payout_requests_hash_chk CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT partner_payout_requests_id_chk CHECK (((length(btrim(id)) >= 8) AND (length(btrim(id)) <= 128))),
    CONSTRAINT partner_payout_requests_idem_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT partner_payout_requests_partner_chk CHECK (((btrim(partner_actor_id) <> ''::text) AND (length(partner_actor_id) <= 128))),
    CONSTRAINT partner_payout_requests_scope_chk CHECK ((scope_mode = ANY (ARRAY['FULL_AVAILABLE'::text, 'SPECIFIED'::text]))),
    CONSTRAINT partner_payout_requests_status_chk CHECK ((status = 'PARTITIONED'::text))
);


--
-- Name: partner_store_cash_commissions; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_store_cash_commissions (
    order_id text CONSTRAINT partner_store_pickup_commissions_order_id_not_null NOT NULL,
    payment_intent_id text CONSTRAINT partner_store_pickup_commissions_payment_intent_id_not_null NOT NULL,
    partner_actor_id text CONSTRAINT partner_store_pickup_commissions_partner_actor_id_not_null NOT NULL,
    currency text DEFAULT 'YER'::text CONSTRAINT partner_store_pickup_commissions_currency_not_null NOT NULL,
    gross_product_minor bigint CONSTRAINT partner_store_pickup_commissions_gross_product_minor_not_null NOT NULL,
    commission_minor bigint CONSTRAINT partner_store_pickup_commissions_commission_minor_not_null NOT NULL,
    profile_id text CONSTRAINT partner_store_pickup_commissions_profile_id_not_null NOT NULL,
    profile_version integer CONSTRAINT partner_store_pickup_commissions_profile_version_not_null NOT NULL,
    policy_version text CONSTRAINT partner_store_pickup_commissions_policy_version_not_null NOT NULL,
    ledger_transaction_id text,
    idempotency_key text CONSTRAINT partner_store_pickup_commissions_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT partner_store_pickup_commissions_request_hash_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT partner_store_pickup_commissions_created_at_not_null NOT NULL,
    fulfillment_mode text NOT NULL,
    CONSTRAINT partner_store_cash_commissions_amounts_chk CHECK (((gross_product_minor >= 0) AND (commission_minor >= 0) AND (commission_minor <= gross_product_minor))),
    CONSTRAINT partner_store_cash_commissions_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT partner_store_cash_commissions_fulfillment_mode_chk CHECK ((fulfillment_mode = ANY (ARRAY['CUSTOMER_PICKUP'::text, 'PARTNER_CAPTAIN'::text]))),
    CONSTRAINT partner_store_cash_commissions_idempotency_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT partner_store_cash_commissions_policy_chk CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 512))),
    CONSTRAINT partner_store_cash_commissions_profile_version_chk CHECK ((profile_version > 0))
);


--
-- Name: partner_store_commission_policies_legacy; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_store_commission_policies_legacy (
    store_id text CONSTRAINT partner_store_commission_policies_store_id_not_null NOT NULL,
    partner_actor_id text CONSTRAINT partner_store_commission_policies_partner_actor_id_not_null NOT NULL,
    fulfillment_mode text CONSTRAINT partner_store_commission_policies_fulfillment_mode_not_null NOT NULL,
    commission_rate_bps integer CONSTRAINT partner_store_commission_policies_commission_rate_bps_not_null NOT NULL,
    policy_version integer DEFAULT 1 CONSTRAINT partner_store_commission_policies_policy_version_not_null NOT NULL,
    profile_id text CONSTRAINT partner_store_commission_policies_profile_id_not_null NOT NULL,
    profile_version integer CONSTRAINT partner_store_commission_policies_profile_version_not_null NOT NULL,
    rounding_unit_minor bigint DEFAULT 50 CONSTRAINT partner_store_commission_policies_rounding_unit_minor_not_null NOT NULL,
    settlement_period text CONSTRAINT partner_store_commission_policies_settlement_period_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT partner_store_commission_policies_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT partner_store_commission_policies_updated_at_not_null NOT NULL,
    last_changed_by_actor_id text,
    last_change_reason text,
    CONSTRAINT partner_store_commission_policies_actor_chk CHECK ((((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128)) AND ((length(btrim(partner_actor_id)) >= 1) AND (length(btrim(partner_actor_id)) <= 128)))),
    CONSTRAINT partner_store_commission_policies_change_chk CHECK ((((last_changed_by_actor_id IS NULL) AND (last_change_reason IS NULL)) OR ((last_changed_by_actor_id IS NOT NULL) AND (last_change_reason IS NOT NULL) AND ((length(btrim(last_changed_by_actor_id)) >= 1) AND (length(btrim(last_changed_by_actor_id)) <= 128)) AND ((length(btrim(last_change_reason)) >= 8) AND (length(btrim(last_change_reason)) <= 500))))),
    CONSTRAINT partner_store_commission_policies_mode_chk CHECK ((fulfillment_mode = ANY (ARRAY['BTHWANI_CAPTAIN'::text, 'PARTNER_CAPTAIN'::text, 'CUSTOMER_PICKUP'::text]))),
    CONSTRAINT partner_store_commission_policies_period_chk CHECK ((settlement_period = ANY (ARRAY['DAILY'::text, 'WEEKLY'::text, 'MONTHLY'::text]))),
    CONSTRAINT partner_store_commission_policies_rate_chk CHECK (((commission_rate_bps >= 0) AND (commission_rate_bps <= 10000))),
    CONSTRAINT partner_store_commission_policies_rounding_chk CHECK ((rounding_unit_minor = 50)),
    CONSTRAINT partner_store_commission_policies_version_chk CHECK (((policy_version > 0) AND (profile_version > 0)))
);


--
-- Name: partner_store_commission_policy_events_legacy; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_store_commission_policy_events_legacy (
    idempotency_key text CONSTRAINT partner_store_commission_policy_events_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT partner_store_commission_policy_events_request_hash_not_null NOT NULL,
    store_id text CONSTRAINT partner_store_commission_policy_events_store_id_not_null NOT NULL,
    partner_actor_id text CONSTRAINT partner_store_commission_policy_event_partner_actor_id_not_null NOT NULL,
    fulfillment_mode text CONSTRAINT partner_store_commission_policy_event_fulfillment_mode_not_null NOT NULL,
    previous_rate_bps integer CONSTRAINT partner_store_commission_policy_even_previous_rate_bps_not_null NOT NULL,
    new_rate_bps integer CONSTRAINT partner_store_commission_policy_events_new_rate_bps_not_null NOT NULL,
    previous_policy_version integer CONSTRAINT partner_store_commission_polic_previous_policy_version_not_null NOT NULL,
    new_policy_version integer CONSTRAINT partner_store_commission_policy_eve_new_policy_version_not_null NOT NULL,
    changed_by_actor_id text CONSTRAINT partner_store_commission_policy_ev_changed_by_actor_id_not_null NOT NULL,
    reason text CONSTRAINT partner_store_commission_policy_events_reason_not_null NOT NULL,
    correlation_id text CONSTRAINT partner_store_commission_policy_events_correlation_id_not_null NOT NULL,
    changed_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT partner_store_commission_policy_events_changed_at_not_null NOT NULL,
    CONSTRAINT partner_store_commission_policy_events_values_chk CHECK ((((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128)) AND (length(btrim(request_hash)) = 64) AND ((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128)) AND ((length(btrim(partner_actor_id)) >= 1) AND (length(btrim(partner_actor_id)) <= 128)) AND (fulfillment_mode = ANY (ARRAY['BTHWANI_CAPTAIN'::text, 'PARTNER_CAPTAIN'::text, 'CUSTOMER_PICKUP'::text])) AND ((previous_rate_bps >= 0) AND (previous_rate_bps <= 10000)) AND ((new_rate_bps >= 0) AND (new_rate_bps <= 10000)) AND (previous_policy_version > 0) AND (new_policy_version = (previous_policy_version + 1)) AND ((length(btrim(changed_by_actor_id)) >= 1) AND (length(btrim(changed_by_actor_id)) <= 128)) AND ((length(btrim(reason)) >= 8) AND (length(btrim(reason)) <= 500)) AND ((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))))
);


--
-- Name: partner_store_commission_policy_initializations_legacy; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.partner_store_commission_policy_initializations_legacy (
    idempotency_key text CONSTRAINT partner_store_commission_policy_initia_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT partner_store_commission_policy_initializ_request_hash_not_null NOT NULL,
    store_id text CONSTRAINT partner_store_commission_policy_initializatio_store_id_not_null NOT NULL,
    partner_actor_id text CONSTRAINT partner_store_commission_policy_initi_partner_actor_id_not_null NOT NULL,
    profile_id text CONSTRAINT partner_store_commission_policy_initializat_profile_id_not_null NOT NULL,
    correlation_id text CONSTRAINT partner_store_commission_policy_initial_correlation_id_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT partner_store_commission_policy_initializat_created_at_not_null NOT NULL,
    CONSTRAINT partner_store_commission_policy_initializations_values_chk CHECK ((((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128)) AND (length(btrim(request_hash)) = 64) AND ((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128)) AND ((length(btrim(partner_actor_id)) >= 1) AND (length(btrim(partner_actor_id)) <= 128)) AND ((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))))
);


--
-- Name: partner_store_earning_attribution; Type: VIEW; Schema: wlt; Owner: -
--

CREATE VIEW wlt.partner_store_earning_attribution AS
 SELECT partner_actor_id,
    store_id,
    count(*) AS order_count,
    COALESCE(sum(partner_net_minor), (0)::numeric) AS partner_net_minor,
    COALESCE(sum(commission_minor), (0)::numeric) AS commission_minor,
    max(created_at) AS last_earning_at
   FROM wlt.partner_order_earnings e
  GROUP BY partner_actor_id, store_id;


--
-- Name: payment_allocation_events_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

ALTER TABLE wlt.customer_payment_allocation_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME wlt.payment_allocation_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payment_intent_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.payment_intent_events (
    id text NOT NULL,
    intent_id text NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    actor_id text,
    correlation_id text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    amount_minor bigint,
    reason text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT payment_intent_events_amount_chk CHECK (((amount_minor IS NULL) OR (amount_minor > 0) OR ((amount_minor = 0) AND (event_type = ANY (ARRAY['PAYMENT_INTENT_CREATED'::text, 'PAYMENT_INTENT_BALANCE_SETTLED'::text]))))),
    CONSTRAINT payment_intent_events_to_state_chk CHECK ((to_state = ANY (ARRAY['REQUIRES_COLLECTION'::text, 'COLLECTED'::text, 'CANCELLED'::text]))),
    CONSTRAINT payment_intent_events_type_chk CHECK ((event_type = ANY (ARRAY['PAYMENT_INTENT_CREATED'::text, 'PAYMENT_INTENT_COLLECTED'::text, 'PAYMENT_INTENT_BALANCE_SETTLED'::text, 'PAYMENT_INTENT_CANCELLED'::text])))
);


--
-- Name: payment_intents; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.payment_intents (
    id text NOT NULL,
    external_reference text NOT NULL,
    payer_actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    method text DEFAULT 'CASH_ON_DELIVERY'::text NOT NULL,
    state text DEFAULT 'REQUIRES_COLLECTION'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    collected_amount_minor bigint,
    collected_by_actor_id text,
    collection_reference text,
    collected_at timestamp with time zone,
    cancellation_reason text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT payment_intents_amount_chk CHECK ((amount_minor >= 0)),
    CONSTRAINT payment_intents_collection_chk CHECK ((((state = 'COLLECTED'::text) AND (collected_amount_minor = amount_minor) AND (collected_at IS NOT NULL) AND (((amount_minor = 0) AND (collected_by_actor_id IS NULL)) OR ((amount_minor > 0) AND (collected_by_actor_id IS NOT NULL)))) OR ((state <> 'COLLECTED'::text) AND (collected_amount_minor IS NULL) AND (collected_by_actor_id IS NULL) AND (collected_at IS NULL)))),
    CONSTRAINT payment_intents_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT payment_intents_method_chk CHECK ((method = ANY (ARRAY['CASH_ON_DELIVERY'::text, 'CASH_AT_STORE'::text]))),
    CONSTRAINT payment_intents_state_chk CHECK ((state = ANY (ARRAY['REQUIRES_COLLECTION'::text, 'COLLECTED'::text, 'CANCELLED'::text]))),
    CONSTRAINT payment_intents_version_chk CHECK ((version > 0))
);


--
-- Name: payout_audit_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.payout_audit_events (
    id text NOT NULL,
    event_type text NOT NULL,
    payout_id text,
    batch_id text,
    actor_id text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    evidence_reference text DEFAULT ''::text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT payout_audit_events_actor_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT payout_audit_events_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT payout_audit_events_event_chk CHECK ((event_type = ANY (ARRAY['PAYOUT_PREPARED'::text, 'PAYOUT_APPROVED'::text, 'PAYOUT_CANCELLED'::text, 'BATCH_CREATED'::text, 'BATCH_APPROVED'::text, 'BATCH_FROZEN'::text, 'TRANSFER_EXECUTED'::text, 'TRANSFER_VERIFIED'::text, 'TRANSFER_RECONCILED'::text, 'PAYOUT_COMPLETED'::text, 'FINANCE_EVIDENCE_UPLOADED'::text, 'SETTLEMENT_STATEMENT_REGISTERED'::text, 'SETTLEMENT_STATEMENT_ROW_RECORDED'::text, 'SETTLEMENT_BATCH_EXPORTED'::text, 'FINANCE_EVIDENCE_DOWNLOADED'::text]))),
    CONSTRAINT payout_audit_events_hash_chk CHECK ((length(btrim(request_hash)) > 0))
);


--
-- Name: payout_holds; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.payout_holds (
    id text NOT NULL,
    payout_id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    released_at timestamp with time zone,
    CONSTRAINT payout_holds_actor_chk CHECK ((actor_type = ANY (ARRAY['customer'::text, 'partner'::text, 'captain'::text, 'field'::text]))),
    CONSTRAINT payout_holds_actor_id_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT payout_holds_amount_chk CHECK ((amount_minor > 0)),
    CONSTRAINT payout_holds_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT payout_holds_release_chk CHECK ((((status = 'ACTIVE'::text) AND (released_at IS NULL)) OR (status <> 'ACTIVE'::text))),
    CONSTRAINT payout_holds_status_chk CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'RELEASED'::text, 'FINALIZED'::text])))
);


--
-- Name: payout_requests; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.payout_requests (
    id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    amount_mode text NOT NULL,
    requested_amount_minor bigint,
    resolved_amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    status text DEFAULT 'HELD'::text NOT NULL,
    policy_version text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    ledger_transaction_id text,
    CONSTRAINT payout_requests_actor_chk CHECK ((actor_type = ANY (ARRAY['customer'::text, 'partner'::text, 'captain'::text, 'field'::text]))),
    CONSTRAINT payout_requests_actor_id_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT payout_requests_amount_chk CHECK (((resolved_amount_minor > 0) AND (((amount_mode = 'FULL_AVAILABLE'::text) AND (requested_amount_minor IS NULL)) OR ((amount_mode = 'SPECIFIED'::text) AND (requested_amount_minor IS NOT NULL) AND (requested_amount_minor > 0))))),
    CONSTRAINT payout_requests_amount_mode_chk CHECK ((amount_mode = ANY (ARRAY['FULL_AVAILABLE'::text, 'SPECIFIED'::text]))),
    CONSTRAINT payout_requests_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT payout_requests_destination_version_chk CHECK ((destination_version > 0)),
    CONSTRAINT payout_requests_policy_chk CHECK (((length(btrim(policy_version)) >= 1) AND (length(btrim(policy_version)) <= 128))),
    CONSTRAINT payout_requests_status_chk CHECK ((status = ANY (ARRAY['HELD'::text, 'CANCELLED'::text, 'PREPARED'::text, 'APPROVED'::text, 'FROZEN'::text, 'EXECUTED'::text, 'COMPLETED'::text, 'EXCEPTION'::text])))
);


--
-- Name: payout_store_allocations; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.payout_store_allocations (
    payout_id text NOT NULL,
    store_id text NOT NULL,
    beneficiary_actor_id text NOT NULL,
    recipient_assignment_version bigint DEFAULT 0 NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT payout_store_allocations_amount_chk CHECK ((amount_minor > 0)),
    CONSTRAINT payout_store_allocations_assignment_version_chk CHECK ((recipient_assignment_version >= 0)),
    CONSTRAINT payout_store_allocations_beneficiary_chk CHECK (((btrim(beneficiary_actor_id) <> ''::text) AND (length(beneficiary_actor_id) <= 128))),
    CONSTRAINT payout_store_allocations_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT payout_store_allocations_store_chk CHECK (((btrim(store_id) <> ''::text) AND (length(store_id) <= 128)))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.schema_migrations (
    version integer NOT NULL,
    name text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: settlement_batch_exports; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.settlement_batch_exports (
    id text NOT NULL,
    batch_id text NOT NULL,
    evidence_document_id text NOT NULL,
    generated_by text NOT NULL,
    row_count integer NOT NULL,
    total_amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    file_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT settlement_batch_exports_actor_chk CHECK (((length(btrim(generated_by)) >= 1) AND (length(btrim(generated_by)) <= 128))),
    CONSTRAINT settlement_batch_exports_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT settlement_batch_exports_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT settlement_batch_exports_sha_chk CHECK ((file_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT settlement_batch_exports_totals_chk CHECK (((row_count > 0) AND (total_amount_minor > 0) AND (currency = 'YER'::text)))
);


--
-- Name: settlement_batch_items; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.settlement_batch_items (
    batch_id text NOT NULL,
    payout_id text NOT NULL,
    row_sequence integer NOT NULL,
    snapshot_hash text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    destination_id text NOT NULL,
    destination_version integer NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT settlement_batch_items_amount_chk CHECK (((row_sequence > 0) AND (amount_minor > 0) AND (currency = 'YER'::text) AND (destination_version > 0) AND (length(btrim(snapshot_hash)) > 0)))
);


--
-- Name: settlement_batches; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.settlement_batches (
    id text NOT NULL,
    provider_key text NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    status text DEFAULT 'PREPARED'::text NOT NULL,
    row_count integer NOT NULL,
    total_amount_minor bigint NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    frozen_by text,
    frozen_at timestamp with time zone,
    batch_hash text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT settlement_batches_approval_chk CHECK ((((approved_by IS NULL) AND (approved_at IS NULL)) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL)))),
    CONSTRAINT settlement_batches_approve_freeze_sod_chk CHECK (((frozen_by IS NULL) OR (approved_by IS NULL) OR (approved_by <> frozen_by))),
    CONSTRAINT settlement_batches_create_approve_sod_chk CHECK (((approved_by IS NULL) OR (created_by <> approved_by))),
    CONSTRAINT settlement_batches_created_by_chk CHECK (((length(btrim(created_by)) >= 1) AND (length(btrim(created_by)) <= 128))),
    CONSTRAINT settlement_batches_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT settlement_batches_freeze_chk CHECK ((((frozen_by IS NULL) AND (frozen_at IS NULL)) OR ((frozen_by IS NOT NULL) AND (frozen_at IS NOT NULL)))),
    CONSTRAINT settlement_batches_hash_chk CHECK (((batch_hash IS NULL) OR (length(btrim(batch_hash)) > 0))),
    CONSTRAINT settlement_batches_provider_chk CHECK (((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64))),
    CONSTRAINT settlement_batches_status_chk CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PREPARED'::text, 'APPROVED'::text, 'FROZEN'::text, 'EXECUTION_IN_PROGRESS'::text, 'AWAITING_VERIFICATION'::text, 'AWAITING_RECONCILIATION'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'EXCEPTION'::text]))),
    CONSTRAINT settlement_batches_totals_chk CHECK (((row_count > 0) AND (total_amount_minor > 0)))
);


--
-- Name: settlement_statement_rows; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.settlement_statement_rows (
    id text NOT NULL,
    statement_id text NOT NULL,
    row_sequence integer NOT NULL,
    external_transfer_reference text NOT NULL,
    destination_identifier_ciphertext text CONSTRAINT settlement_statement_rows_destination_identifier_ciphe_not_null NOT NULL,
    amount_minor bigint NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    transaction_at timestamp with time zone NOT NULL,
    row_hash text NOT NULL,
    recorded_by text NOT NULL,
    matched_transfer_id text,
    matched_by text,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT settlement_statement_rows_amount_chk CHECK (((amount_minor > 0) AND (currency = 'YER'::text))),
    CONSTRAINT settlement_statement_rows_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT settlement_statement_rows_destination_chk CHECK ((length(btrim(destination_identifier_ciphertext)) > 0)),
    CONSTRAINT settlement_statement_rows_hash_chk CHECK ((length(btrim(row_hash)) = 64)),
    CONSTRAINT settlement_statement_rows_match_chk CHECK ((((matched_transfer_id IS NULL) AND (matched_by IS NULL) AND (matched_at IS NULL)) OR ((matched_transfer_id IS NOT NULL) AND (matched_by IS NOT NULL) AND (matched_at IS NOT NULL)))),
    CONSTRAINT settlement_statement_rows_recorded_by_chk CHECK (((length(btrim(recorded_by)) >= 1) AND (length(btrim(recorded_by)) <= 128))),
    CONSTRAINT settlement_statement_rows_reference_chk CHECK (((length(btrim(external_transfer_reference)) >= 1) AND (length(btrim(external_transfer_reference)) <= 160))),
    CONSTRAINT settlement_statement_rows_request_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT settlement_statement_rows_sequence_chk CHECK ((row_sequence > 0))
);


--
-- Name: settlement_statements; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.settlement_statements (
    id text NOT NULL,
    batch_id text,
    provider_key text NOT NULL,
    currency text DEFAULT 'YER'::text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    evidence_document_id text NOT NULL,
    uploaded_by text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    CONSTRAINT settlement_statements_actor_chk CHECK (((length(btrim(uploaded_by)) >= 1) AND (length(btrim(uploaded_by)) <= 128))),
    CONSTRAINT settlement_statements_correlation_chk CHECK (((length(btrim(correlation_id)) >= 1) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT settlement_statements_currency_chk CHECK ((currency = 'YER'::text)),
    CONSTRAINT settlement_statements_hash_chk CHECK ((length(btrim(request_hash)) > 0)),
    CONSTRAINT settlement_statements_period_chk CHECK ((period_end >= period_start)),
    CONSTRAINT settlement_statements_provider_chk CHECK (((length(btrim(provider_key)) >= 1) AND (length(btrim(provider_key)) <= 64)))
);


--
-- Name: store_commercial_agreement_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_commercial_agreement_events (
    id text NOT NULL,
    agreement_id text NOT NULL,
    event_type text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT store_commercial_agreement_events_actor_chk CHECK (((length(btrim(actor_id)) >= 1) AND (length(btrim(actor_id)) <= 128))),
    CONSTRAINT store_commercial_agreement_events_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT store_commercial_agreement_events_hash_chk CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT store_commercial_agreement_events_idempotency_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT store_commercial_agreement_events_reason_chk CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500))),
    CONSTRAINT store_commercial_agreement_events_status_chk CHECK (((to_status = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text, 'ACTIVE'::text, 'FINANCE_REJECTED'::text, 'SUPERSEDED'::text])) AND ((from_status IS NULL) OR (from_status = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text, 'ACTIVE'::text, 'FINANCE_REJECTED'::text, 'SUPERSEDED'::text]))))),
    CONSTRAINT store_commercial_agreement_events_type_chk CHECK ((event_type = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text, 'FINANCE_APPROVED'::text, 'FINANCE_REJECTED'::text, 'SUPERSEDED'::text])))
);


--
-- Name: store_commercial_agreement_rates; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_commercial_agreement_rates (
    agreement_id text NOT NULL,
    fulfillment_mode text NOT NULL,
    commission_rate_bps integer NOT NULL,
    delivery_markup_minor bigint DEFAULT 0 NOT NULL,
    delivery_pricing_mode text DEFAULT 'DISTANCE'::text NOT NULL,
    delivery_fixed_fee_minor bigint DEFAULT 0 CONSTRAINT store_commercial_agreement_ra_delivery_fixed_fee_minor_not_null NOT NULL,
    CONSTRAINT store_agreement_partner_delivery_pricing_chk CHECK (((delivery_pricing_mode = ANY (ARRAY['DISTANCE'::text, 'FIXED'::text, 'FREE'::text])) AND ((delivery_fixed_fee_minor >= 0) AND (delivery_fixed_fee_minor <= 20000)) AND (((fulfillment_mode <> 'PARTNER_CAPTAIN'::text) AND (delivery_pricing_mode = 'DISTANCE'::text) AND (delivery_fixed_fee_minor = 0)) OR ((fulfillment_mode = 'PARTNER_CAPTAIN'::text) AND (((delivery_pricing_mode = 'DISTANCE'::text) AND (delivery_fixed_fee_minor = 0)) OR ((delivery_pricing_mode = 'FREE'::text) AND (delivery_fixed_fee_minor = 0)) OR ((delivery_pricing_mode = 'FIXED'::text) AND (delivery_fixed_fee_minor > 0))))))),
    CONSTRAINT store_commercial_agreement_rates_markup_chk CHECK ((((delivery_markup_minor >= 0) AND (delivery_markup_minor <= 10000)) AND ((delivery_markup_minor = 0) OR ((fulfillment_mode = 'BTHWANI_CAPTAIN'::text) AND (commission_rate_bps = 0))))),
    CONSTRAINT store_commercial_agreement_rates_mode_chk CHECK ((fulfillment_mode = ANY (ARRAY['BTHWANI_CAPTAIN'::text, 'PARTNER_CAPTAIN'::text, 'CUSTOMER_PICKUP'::text]))),
    CONSTRAINT store_commercial_agreement_rates_rate_chk CHECK (((commission_rate_bps >= 0) AND (commission_rate_bps <= 10000)))
);


--
-- Name: store_commercial_agreements; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_commercial_agreements (
    agreement_id text NOT NULL,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    agreement_version integer NOT NULL,
    status text NOT NULL,
    proposed_by_actor_id text NOT NULL,
    proposed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    partner_accepted_by_actor_id text,
    partner_accepted_at timestamp with time zone,
    finance_approved_by_actor_id text,
    finance_approved_at timestamp with time zone,
    effective_at timestamp with time zone,
    superseded_at timestamp with time zone,
    reason text NOT NULL,
    finance_decision_reason text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finance_decision_by_actor_id text,
    finance_decision_at timestamp with time zone,
    commercial_model text DEFAULT 'COMMISSION'::text NOT NULL,
    recurring_amount_minor bigint DEFAULT 0 NOT NULL,
    billing_period text DEFAULT 'NONE'::text NOT NULL,
    billing_timezone text DEFAULT 'Asia/Aden'::text NOT NULL,
    invoice_due_days integer DEFAULT 0 NOT NULL,
    grace_days integer DEFAULT 0 NOT NULL,
    renewal_policy text DEFAULT 'NONE'::text NOT NULL,
    termination_terms text DEFAULT ''::text NOT NULL,
    adjustment_terms text DEFAULT ''::text NOT NULL,
    CONSTRAINT store_agreement_model_fields_chk CHECK ((((commercial_model = 'COMMISSION'::text) AND (recurring_amount_minor = 0) AND (billing_period = 'NONE'::text) AND (billing_timezone = 'Asia/Aden'::text) AND (invoice_due_days = 0) AND (grace_days = 0) AND (renewal_policy = 'NONE'::text) AND (termination_terms = ''::text) AND (adjustment_terms = ''::text)) OR ((commercial_model = ANY (ARRAY['SUBSCRIPTION'::text, 'HYBRID'::text])) AND ((recurring_amount_minor >= 1) AND (recurring_amount_minor <= 100000000)) AND (billing_period = ANY (ARRAY['MONTHLY'::text, 'ANNUAL'::text])) AND (billing_timezone = 'Asia/Aden'::text) AND ((invoice_due_days >= 0) AND (invoice_due_days <= 30)) AND ((grace_days >= 0) AND (grace_days <= 30)) AND (renewal_policy = ANY (ARRAY['MANUAL'::text, 'AUTOMATIC'::text])) AND ((char_length(termination_terms) >= 8) AND (char_length(termination_terms) <= 500)) AND ((char_length(adjustment_terms) >= 8) AND (char_length(adjustment_terms) <= 500))))),
    CONSTRAINT store_agreement_recurring_not_active_chk CHECK (((commercial_model = 'COMMISSION'::text) OR (status = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text, 'FINANCE_REJECTED'::text])))),
    CONSTRAINT store_commercial_agreements_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT store_commercial_agreements_finance_approval_chk CHECK ((((finance_approved_by_actor_id IS NULL) AND (finance_approved_at IS NULL)) OR (((length(btrim(finance_approved_by_actor_id)) >= 1) AND (length(btrim(finance_approved_by_actor_id)) <= 128)) AND (finance_approved_at IS NOT NULL)))),
    CONSTRAINT store_commercial_agreements_finance_decision_chk CHECK ((((status = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text])) AND (finance_decision_by_actor_id IS NULL) AND (finance_decision_at IS NULL) AND (finance_decision_reason IS NULL)) OR ((status = ANY (ARRAY['ACTIVE'::text, 'SUPERSEDED'::text, 'FINANCE_REJECTED'::text])) AND ((length(btrim(finance_decision_by_actor_id)) >= 1) AND (length(btrim(finance_decision_by_actor_id)) <= 128)) AND (finance_decision_at IS NOT NULL) AND ((length(btrim(finance_decision_reason)) >= 1) AND (length(btrim(finance_decision_reason)) <= 500))))),
    CONSTRAINT store_commercial_agreements_hash_chk CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT store_commercial_agreements_idempotency_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT store_commercial_agreements_lifecycle_chk CHECK ((((status = 'PROPOSED'::text) AND (partner_accepted_at IS NULL) AND (finance_approved_at IS NULL) AND (effective_at IS NULL) AND (superseded_at IS NULL)) OR ((status = 'PARTNER_ACCEPTED'::text) AND (partner_accepted_at IS NOT NULL) AND (finance_approved_at IS NULL) AND (effective_at IS NULL) AND (superseded_at IS NULL)) OR ((status = 'ACTIVE'::text) AND (partner_accepted_at IS NOT NULL) AND (finance_approved_at IS NOT NULL) AND (effective_at IS NOT NULL) AND (superseded_at IS NULL)) OR ((status = 'FINANCE_REJECTED'::text) AND (partner_accepted_at IS NOT NULL) AND (finance_approved_at IS NULL) AND (effective_at IS NULL) AND (superseded_at IS NULL)) OR ((status = 'SUPERSEDED'::text) AND (partner_accepted_at IS NOT NULL) AND (finance_approved_at IS NOT NULL) AND (effective_at IS NOT NULL) AND (superseded_at IS NOT NULL)))),
    CONSTRAINT store_commercial_agreements_partner_acceptance_chk CHECK ((((partner_accepted_by_actor_id IS NULL) AND (partner_accepted_at IS NULL)) OR (((length(btrim(partner_accepted_by_actor_id)) >= 1) AND (length(btrim(partner_accepted_by_actor_id)) <= 128)) AND (partner_accepted_at IS NOT NULL)))),
    CONSTRAINT store_commercial_agreements_partner_chk CHECK (((length(btrim(partner_actor_id)) >= 1) AND (length(btrim(partner_actor_id)) <= 128))),
    CONSTRAINT store_commercial_agreements_proposer_chk CHECK (((length(btrim(proposed_by_actor_id)) >= 1) AND (length(btrim(proposed_by_actor_id)) <= 128))),
    CONSTRAINT store_commercial_agreements_reason_chk CHECK ((((length(btrim(reason)) >= 8) AND (length(btrim(reason)) <= 500)) AND ((finance_decision_reason IS NULL) OR ((length(btrim(finance_decision_reason)) >= 1) AND (length(btrim(finance_decision_reason)) <= 500))))),
    CONSTRAINT store_commercial_agreements_status_chk CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text, 'ACTIVE'::text, 'FINANCE_REJECTED'::text, 'SUPERSEDED'::text]))),
    CONSTRAINT store_commercial_agreements_store_chk CHECK (((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128))),
    CONSTRAINT store_commercial_agreements_version_chk CHECK ((agreement_version > 0))
);


--
-- Name: store_payout_recipient_assignments; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_payout_recipient_assignments (
    id text NOT NULL,
    store_id text NOT NULL,
    partner_actor_id text NOT NULL,
    beneficiary_actor_type text DEFAULT 'partner'::text CONSTRAINT store_payout_recipient_assignme_beneficiary_actor_type_not_null NOT NULL,
    beneficiary_actor_id text CONSTRAINT store_payout_recipient_assignment_beneficiary_actor_id_not_null NOT NULL,
    state text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    effective_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    assigned_by_actor_id text CONSTRAINT store_payout_recipient_assignment_assigned_by_actor_id_not_null NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT store_payout_recipient_assignments_assigned_by_chk CHECK ((assigned_by_actor_id = partner_actor_id)),
    CONSTRAINT store_payout_recipient_assignments_beneficiary_chk CHECK ((((length(btrim(beneficiary_actor_id)) >= 1) AND (length(btrim(beneficiary_actor_id)) <= 128)) AND (beneficiary_actor_id <> partner_actor_id))),
    CONSTRAINT store_payout_recipient_assignments_beneficiary_type_chk CHECK ((beneficiary_actor_type = 'partner'::text)),
    CONSTRAINT store_payout_recipient_assignments_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT store_payout_recipient_assignments_hash_chk CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT store_payout_recipient_assignments_idempotency_chk CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT store_payout_recipient_assignments_partner_chk CHECK (((length(btrim(partner_actor_id)) >= 1) AND (length(btrim(partner_actor_id)) <= 128))),
    CONSTRAINT store_payout_recipient_assignments_reason_chk CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500))),
    CONSTRAINT store_payout_recipient_assignments_review_assignment_chk CHECK (((state <> 'RECIPIENT_REVIEW_REQUIRED'::text) OR ((idempotency_key = 'WLT_SYSTEM_FAIL_CLOSED'::text) AND (request_hash = '0000000000000000000000000000000000000000000000000000000000000000'::text)))),
    CONSTRAINT store_payout_recipient_assignments_state_chk CHECK ((state = ANY (ARRAY['SELECTED_VERIFIED_STAFF'::text, 'RECIPIENT_REVIEW_REQUIRED'::text]))),
    CONSTRAINT store_payout_recipient_assignments_store_chk CHECK (((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128))),
    CONSTRAINT store_payout_recipient_assignments_version_chk CHECK ((version >= 1))
);


--
-- Name: store_payout_recipient_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_payout_recipient_events (
    id bigint NOT NULL,
    store_id text NOT NULL,
    assignment_id text NOT NULL,
    event_type text NOT NULL,
    from_state text,
    to_state text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    acting_actor_id text NOT NULL,
    beneficiary_actor_id text NOT NULL,
    reason text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    correlation_id text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT store_payout_recipient_events_actor_chk CHECK (((length(btrim(acting_actor_id)) >= 1) AND (length(btrim(acting_actor_id)) <= 128))),
    CONSTRAINT store_payout_recipient_events_assignment_chk CHECK (((length(btrim(assignment_id)) >= 1) AND (length(btrim(assignment_id)) <= 128))),
    CONSTRAINT store_payout_recipient_events_beneficiary_chk CHECK (((length(btrim(beneficiary_actor_id)) >= 1) AND (length(btrim(beneficiary_actor_id)) <= 128))),
    CONSTRAINT store_payout_recipient_events_correlation_chk CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT store_payout_recipient_events_hash_chk CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT store_payout_recipient_events_reason_chk CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 500))),
    CONSTRAINT store_payout_recipient_events_state_chk CHECK (((to_state = ANY (ARRAY['SELECTED_VERIFIED_STAFF'::text, 'RECIPIENT_REVIEW_REQUIRED'::text, 'DEFAULT_OWNER'::text])) AND ((from_state IS NULL) OR (from_state = ANY (ARRAY['SELECTED_VERIFIED_STAFF'::text, 'RECIPIENT_REVIEW_REQUIRED'::text, 'DEFAULT_OWNER'::text]))))),
    CONSTRAINT store_payout_recipient_events_store_chk CHECK (((length(btrim(store_id)) >= 1) AND (length(btrim(store_id)) <= 128))),
    CONSTRAINT store_payout_recipient_events_type_chk CHECK ((event_type = ANY (ARRAY['STAFF_SELECTED'::text, 'REVERTED_TO_OWNER'::text, 'MARKED_REVIEW_REQUIRED'::text, 'REASSIGNED_STAFF'::text])))
);


--
-- Name: store_payout_recipient_events_id_seq; Type: SEQUENCE; Schema: wlt; Owner: -
--

ALTER TABLE wlt.store_payout_recipient_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME wlt.store_payout_recipient_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: store_relation_commercial_model_default_events; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_relation_commercial_model_default_events (
    idempotency_key text CONSTRAINT store_relation_commercial_model_defaul_idempotency_key_not_null NOT NULL,
    request_hash text CONSTRAINT store_relation_commercial_model_default_e_request_hash_not_null NOT NULL,
    relation_model text CONSTRAINT store_relation_commercial_model_defaul_relation_model_not_null1 NOT NULL,
    previous_model text,
    new_model text CONSTRAINT store_relation_commercial_model_default_even_new_model_not_null NOT NULL,
    previous_policy_version integer,
    new_policy_version integer CONSTRAINT store_relation_commercial_model_def_new_policy_version_not_null NOT NULL,
    changed_by_actor_id text CONSTRAINT store_relation_commercial_model_de_changed_by_actor_id_not_null NOT NULL,
    reason text NOT NULL,
    correlation_id text CONSTRAINT store_relation_commercial_model_default_correlation_id_not_null NOT NULL,
    changed_at timestamp with time zone DEFAULT clock_timestamp() CONSTRAINT store_relation_commercial_model_default_eve_changed_at_not_null NOT NULL,
    CONSTRAINT store_relation_commercial_model_d_previous_policy_version_check CHECK (((previous_policy_version IS NULL) OR (previous_policy_version > 0))),
    CONSTRAINT store_relation_commercial_model_defau_changed_by_actor_id_check CHECK (((length(btrim(changed_by_actor_id)) >= 1) AND (length(btrim(changed_by_actor_id)) <= 128))),
    CONSTRAINT store_relation_commercial_model_defaul_new_policy_version_check CHECK ((new_policy_version > 0)),
    CONSTRAINT store_relation_commercial_model_default_e_idempotency_key_check CHECK (((length(btrim(idempotency_key)) >= 8) AND (length(btrim(idempotency_key)) <= 128))),
    CONSTRAINT store_relation_commercial_model_default_ev_correlation_id_check CHECK (((length(btrim(correlation_id)) >= 8) AND (length(btrim(correlation_id)) <= 128))),
    CONSTRAINT store_relation_commercial_model_default_ev_previous_model_check CHECK (((previous_model IS NULL) OR (previous_model = ANY (ARRAY['COMMISSION'::text, 'SUBSCRIPTION'::text])))),
    CONSTRAINT store_relation_commercial_model_default_events_new_model_check CHECK ((new_model = ANY (ARRAY['COMMISSION'::text, 'SUBSCRIPTION'::text]))),
    CONSTRAINT store_relation_commercial_model_default_events_reason_check CHECK (((length(btrim(reason)) >= 8) AND (length(btrim(reason)) <= 500))),
    CONSTRAINT store_relation_model_default_event_hash_chk CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT store_relation_model_default_event_transition_chk CHECK ((((previous_model IS NULL) AND (previous_policy_version IS NULL) AND (new_policy_version = 1)) OR ((previous_model IS NOT NULL) AND (previous_policy_version IS NOT NULL) AND (previous_model <> new_model) AND ((new_policy_version)::bigint = ((previous_policy_version)::bigint + 1)))))
);


--
-- Name: store_relation_commercial_model_defaults; Type: TABLE; Schema: wlt; Owner: -
--

CREATE TABLE wlt.store_relation_commercial_model_defaults (
    relation_model text CONSTRAINT store_relation_commercial_model_default_relation_model_not_null NOT NULL,
    commercial_model text CONSTRAINT store_relation_commercial_model_defau_commercial_model_not_null NOT NULL,
    policy_version integer CONSTRAINT store_relation_commercial_model_default_policy_version_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    last_changed_by_actor_id text CONSTRAINT store_relation_commercial_mod_last_changed_by_actor_id_not_null NOT NULL,
    last_change_reason text CONSTRAINT store_relation_commercial_model_def_last_change_reason_not_null NOT NULL,
    CONSTRAINT store_relation_commercial_model__last_changed_by_actor_id_check CHECK (((length(btrim(last_changed_by_actor_id)) >= 1) AND (length(btrim(last_changed_by_actor_id)) <= 128))),
    CONSTRAINT store_relation_commercial_model_defaul_last_change_reason_check CHECK (((length(btrim(last_change_reason)) >= 8) AND (length(btrim(last_change_reason)) <= 500))),
    CONSTRAINT store_relation_commercial_model_defaults_commercial_model_check CHECK ((commercial_model = ANY (ARRAY['COMMISSION'::text, 'SUBSCRIPTION'::text]))),
    CONSTRAINT store_relation_commercial_model_defaults_policy_version_check CHECK ((policy_version > 0)),
    CONSTRAINT store_relation_commercial_model_defaults_relation_model_check CHECK ((relation_model = ANY (ARRAY['BTHWANI_PARTNER'::text, 'INDEPENDENT_STORE'::text])))
);


--
-- Name: partner_financial_terms_policy_events id; Type: DEFAULT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_terms_policy_events ALTER COLUMN id SET DEFAULT nextval('wlt.partner_financial_terms_policy_events_id_seq'::regclass);


--
-- Name: approved_payout_snapshots approved_payout_snapshots_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.approved_payout_snapshots
    ADD CONSTRAINT approved_payout_snapshots_pkey PRIMARY KEY (payout_id);


--
-- Name: beneficiary_settlement_intakes beneficiary_settlement_intakes_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.beneficiary_settlement_intakes
    ADD CONSTRAINT beneficiary_settlement_intakes_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: beneficiary_settlement_intakes beneficiary_settlement_intakes_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.beneficiary_settlement_intakes
    ADD CONSTRAINT beneficiary_settlement_intakes_pkey PRIMARY KEY (id);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_revie_submitted_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_revie_submitted_idempotency_key_key UNIQUE (submitted_idempotency_key);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_review_approval_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_review_approval_idempotency_key_key UNIQUE (approval_idempotency_key);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_evidence_document_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_evidence_document_id_key UNIQUE (evidence_document_id);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_order_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_order_id_key UNIQUE (order_id);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_payment_intent_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_payment_intent_id_key UNIQUE (payment_intent_id);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_pkey PRIMARY KEY (id);


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_reservation_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_reservation_id_key UNIQUE (reservation_id);


--
-- Name: captain_cod_reservation_events captain_cod_reservation_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_reservation_events
    ADD CONSTRAINT captain_cod_reservation_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: captain_cod_reservation_events captain_cod_reservation_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_reservation_events
    ADD CONSTRAINT captain_cod_reservation_events_pkey PRIMARY KEY (id);


--
-- Name: captain_cod_reservations captain_cod_reservations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_reservations
    ADD CONSTRAINT captain_cod_reservations_pkey PRIMARY KEY (id);


--
-- Name: captain_cod_reservations captain_cod_reservations_reserve_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_reservations
    ADD CONSTRAINT captain_cod_reservations_reserve_idempotency_key_key UNIQUE (reserve_idempotency_key);


--
-- Name: captain_minimum_balance_policies captain_minimum_balance_policies_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_minimum_balance_policies
    ADD CONSTRAINT captain_minimum_balance_policies_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: captain_minimum_balance_policies captain_minimum_balance_policies_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_minimum_balance_policies
    ADD CONSTRAINT captain_minimum_balance_policies_pkey PRIMARY KEY (id);


--
-- Name: captain_wallet_funding captain_wallet_funding_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_wallet_funding
    ADD CONSTRAINT captain_wallet_funding_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: captain_wallet_funding captain_wallet_funding_ledger_transaction_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_wallet_funding
    ADD CONSTRAINT captain_wallet_funding_ledger_transaction_id_key UNIQUE (ledger_transaction_id);


--
-- Name: captain_wallet_funding captain_wallet_funding_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_wallet_funding
    ADD CONSTRAINT captain_wallet_funding_pkey PRIMARY KEY (id);


--
-- Name: cash_in_funding_intent_events cash_in_funding_intent_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intent_events
    ADD CONSTRAINT cash_in_funding_intent_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: cash_in_funding_intent_events cash_in_funding_intent_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intent_events
    ADD CONSTRAINT cash_in_funding_intent_events_pkey PRIMARY KEY (id);


--
-- Name: cash_in_funding_intents cash_in_funding_intents_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intents
    ADD CONSTRAINT cash_in_funding_intents_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: cash_in_funding_intents cash_in_funding_intents_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intents
    ADD CONSTRAINT cash_in_funding_intents_pkey PRIMARY KEY (id);


--
-- Name: cash_in_funding_intents cash_in_funding_intents_provider_ref_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intents
    ADD CONSTRAINT cash_in_funding_intents_provider_ref_uq UNIQUE (provider_key, provider_transaction_reference);


--
-- Name: cash_in_funding_intents cash_in_funding_intents_reference_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intents
    ADD CONSTRAINT cash_in_funding_intents_reference_uq UNIQUE (provider_key, external_reference);


--
-- Name: cash_remittance_events cash_remittance_events_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittance_events
    ADD CONSTRAINT cash_remittance_events_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: cash_remittance_events cash_remittance_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittance_events
    ADD CONSTRAINT cash_remittance_events_pkey PRIMARY KEY (id);


--
-- Name: cash_remittances cash_remittances_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittances
    ADD CONSTRAINT cash_remittances_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: cash_remittances cash_remittances_payment_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittances
    ADD CONSTRAINT cash_remittances_payment_uq UNIQUE (payment_intent_id);


--
-- Name: cash_remittances cash_remittances_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittances
    ADD CONSTRAINT cash_remittances_pkey PRIMARY KEY (id);


--
-- Name: commercial_store_type_commission_defaults commercial_store_type_commission_defaults_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.commercial_store_type_commission_defaults
    ADD CONSTRAINT commercial_store_type_commission_defaults_pkey PRIMARY KEY (commercial_store_type_id, fulfillment_mode);


--
-- Name: commercial_store_type_commission_default_events commercial_store_type_commission_policy_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.commercial_store_type_commission_default_events
    ADD CONSTRAINT commercial_store_type_commission_policy_events_pkey PRIMARY KEY (idempotency_key);


--
-- Name: customer_manual_withdrawal_events customer_manual_withdrawal_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_events
    ADD CONSTRAINT customer_manual_withdrawal_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: customer_manual_withdrawal_events customer_manual_withdrawal_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_events
    ADD CONSTRAINT customer_manual_withdrawal_events_pkey PRIMARY KEY (id);


--
-- Name: customer_manual_withdrawal_intakes customer_manual_withdrawal_intakes_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_intakes
    ADD CONSTRAINT customer_manual_withdrawal_intakes_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: customer_manual_withdrawal_intakes customer_manual_withdrawal_intakes_payout_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_intakes
    ADD CONSTRAINT customer_manual_withdrawal_intakes_payout_id_key UNIQUE (payout_id);


--
-- Name: customer_manual_withdrawal_intakes customer_manual_withdrawal_intakes_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_intakes
    ADD CONSTRAINT customer_manual_withdrawal_intakes_pkey PRIMARY KEY (id);


--
-- Name: customer_wallet_compensations customer_wallet_compensations_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_wallet_compensations
    ADD CONSTRAINT customer_wallet_compensations_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: customer_wallet_compensations customer_wallet_compensations_ledger_transaction_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_wallet_compensations
    ADD CONSTRAINT customer_wallet_compensations_ledger_transaction_id_key UNIQUE (ledger_transaction_id);


--
-- Name: customer_wallet_compensations customer_wallet_compensations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_wallet_compensations
    ADD CONSTRAINT customer_wallet_compensations_pkey PRIMARY KEY (case_id);


--
-- Name: delivery_fee_policies delivery_fee_policies_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.delivery_fee_policies
    ADD CONSTRAINT delivery_fee_policies_pkey PRIMARY KEY (id);


--
-- Name: delivery_fee_policies delivery_fee_policies_policy_version_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.delivery_fee_policies
    ADD CONSTRAINT delivery_fee_policies_policy_version_key UNIQUE (policy_version);


--
-- Name: delivery_fee_policy_events delivery_fee_policy_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.delivery_fee_policy_events
    ADD CONSTRAINT delivery_fee_policy_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: delivery_fee_policy_events delivery_fee_policy_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.delivery_fee_policy_events
    ADD CONSTRAINT delivery_fee_policy_events_pkey PRIMARY KEY (id);


--
-- Name: field_acquisition_entitlements field_acquisition_entitlements_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_entitlements
    ADD CONSTRAINT field_acquisition_entitlements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: field_acquisition_entitlements field_acquisition_entitlements_ledger_transaction_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_entitlements
    ADD CONSTRAINT field_acquisition_entitlements_ledger_transaction_id_key UNIQUE (ledger_transaction_id);


--
-- Name: field_acquisition_entitlements field_acquisition_entitlements_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_entitlements
    ADD CONSTRAINT field_acquisition_entitlements_pkey PRIMARY KEY (store_id);


--
-- Name: field_acquisition_reward_policies field_acquisition_reward_policies_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_reward_policies
    ADD CONSTRAINT field_acquisition_reward_policies_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: field_acquisition_reward_policies field_acquisition_reward_policies_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_reward_policies
    ADD CONSTRAINT field_acquisition_reward_policies_pkey PRIMARY KEY (id);


--
-- Name: finance_evidence_documents finance_evidence_documents_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.finance_evidence_documents
    ADD CONSTRAINT finance_evidence_documents_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: finance_evidence_documents finance_evidence_documents_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.finance_evidence_documents
    ADD CONSTRAINT finance_evidence_documents_pkey PRIMARY KEY (id);


--
-- Name: finance_transfer_receipt_claims finance_transfer_receipt_claims_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.finance_transfer_receipt_claims
    ADD CONSTRAINT finance_transfer_receipt_claims_pkey PRIMARY KEY (evidence_document_id);


--
-- Name: finance_transfer_receipt_claims finance_transfer_receipt_claims_transfer_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.finance_transfer_receipt_claims
    ADD CONSTRAINT finance_transfer_receipt_claims_transfer_uq UNIQUE (transfer_type, transfer_id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_sequence_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.ledger_entries
    ADD CONSTRAINT ledger_entries_sequence_uq UNIQUE (transaction_id, line_sequence);


--
-- Name: ledger_transactions ledger_transactions_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.ledger_transactions
    ADD CONSTRAINT ledger_transactions_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: ledger_transactions ledger_transactions_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.ledger_transactions
    ADD CONSTRAINT ledger_transactions_pkey PRIMARY KEY (id);


--
-- Name: ledger_transactions ledger_transactions_source_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.ledger_transactions
    ADD CONSTRAINT ledger_transactions_source_uq UNIQUE (source_type, source_id);


--
-- Name: manual_transfer_executions manual_transfer_executions_payout_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_payout_id_key UNIQUE (payout_id);


--
-- Name: manual_transfer_executions manual_transfer_executions_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_pkey PRIMARY KEY (id);


--
-- Name: manual_transfer_executions manual_transfer_executions_reconciliation_chk; Type: CHECK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_reconciliation_chk CHECK ((((reconciled_by IS NULL) AND (reconciled_at IS NULL) AND (statement_row_id IS NULL)) OR ((reconciled_by IS NOT NULL) AND (reconciled_at IS NOT NULL) AND (statement_row_id IS NOT NULL)))) NOT VALID;


--
-- Name: manual_transfer_executions manual_transfer_executions_reference_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_reference_uq UNIQUE (provider_key, external_transfer_reference);


--
-- Name: manual_transfer_executions manual_transfer_executions_statement_row_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_statement_row_uq UNIQUE (statement_row_id);


--
-- Name: manual_transfer_executions manual_transfer_receipt_document_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_receipt_document_uq UNIQUE (receipt_document_id);


--
-- Name: manual_transfer_executions manual_transfer_receipt_required_chk; Type: CHECK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_receipt_required_chk CHECK ((receipt_document_id IS NOT NULL)) NOT VALID;


--
-- Name: official_wallet_destination_transitions official_wallet_destination_transitions_key_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.official_wallet_destination_transitions
    ADD CONSTRAINT official_wallet_destination_transitions_key_uq UNIQUE (idempotency_key);


--
-- Name: official_wallet_destination_transitions official_wallet_destination_transitions_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.official_wallet_destination_transitions
    ADD CONSTRAINT official_wallet_destination_transitions_pkey PRIMARY KEY (id);


--
-- Name: official_wallet_destinations official_wallet_destinations_actor_version_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.official_wallet_destinations
    ADD CONSTRAINT official_wallet_destinations_actor_version_uq UNIQUE (actor_type, actor_id, version);


--
-- Name: official_wallet_destinations official_wallet_destinations_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.official_wallet_destinations
    ADD CONSTRAINT official_wallet_destinations_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: official_wallet_destinations official_wallet_destinations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.official_wallet_destinations
    ADD CONSTRAINT official_wallet_destinations_pkey PRIMARY KEY (id);


--
-- Name: order_adjustment_reconciliation_cases order_adjustment_reconciliation_case_order_adjustment_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.order_adjustment_reconciliation_cases
    ADD CONSTRAINT order_adjustment_reconciliation_case_order_adjustment_uq UNIQUE (order_id, adjustment_id);


--
-- Name: order_adjustment_reconciliation_cases order_adjustment_reconciliation_cases_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.order_adjustment_reconciliation_cases
    ADD CONSTRAINT order_adjustment_reconciliation_cases_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: order_adjustment_reconciliation_cases order_adjustment_reconciliation_cases_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.order_adjustment_reconciliation_cases
    ADD CONSTRAINT order_adjustment_reconciliation_cases_pkey PRIMARY KEY (id);


--
-- Name: order_promotion_funding order_promotion_funding_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.order_promotion_funding
    ADD CONSTRAINT order_promotion_funding_pkey PRIMARY KEY (id);


--
-- Name: partner_commission_credit_policies partner_commission_credit_policies_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_credit_policies
    ADD CONSTRAINT partner_commission_credit_policies_pkey PRIMARY KEY (partner_actor_id);


--
-- Name: partner_commission_rate_history partner_commission_rate_history_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_rate_history
    ADD CONSTRAINT partner_commission_rate_history_pkey PRIMARY KEY (source_relation, source_id);


--
-- Name: partner_commission_remittances partner_commission_remittances_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_remittances
    ADD CONSTRAINT partner_commission_remittances_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: partner_commission_remittances partner_commission_remittances_ledger_transaction_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_remittances
    ADD CONSTRAINT partner_commission_remittances_ledger_transaction_id_key UNIQUE (ledger_transaction_id);


--
-- Name: partner_commission_remittances partner_commission_remittances_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_remittances
    ADD CONSTRAINT partner_commission_remittances_pkey PRIMARY KEY (id);


--
-- Name: partner_financial_profile_events partner_financial_profile_events_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profile_events
    ADD CONSTRAINT partner_financial_profile_events_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: partner_financial_profile_events partner_financial_profile_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profile_events
    ADD CONSTRAINT partner_financial_profile_events_pkey PRIMARY KEY (id);


--
-- Name: partner_financial_profiles partner_financial_profiles_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profiles
    ADD CONSTRAINT partner_financial_profiles_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: partner_financial_profiles partner_financial_profiles_joining_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profiles
    ADD CONSTRAINT partner_financial_profiles_joining_uq UNIQUE (joining_case_id);


--
-- Name: partner_financial_profiles partner_financial_profiles_partner_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profiles
    ADD CONSTRAINT partner_financial_profiles_partner_uq UNIQUE (partner_actor_id);


--
-- Name: partner_financial_profiles partner_financial_profiles_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profiles
    ADD CONSTRAINT partner_financial_profiles_pkey PRIMARY KEY (id);


--
-- Name: partner_financial_terms_policies partner_financial_terms_policies_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_terms_policies
    ADD CONSTRAINT partner_financial_terms_policies_pkey PRIMARY KEY (id);


--
-- Name: partner_financial_terms_policies partner_financial_terms_policies_policy_version_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_terms_policies
    ADD CONSTRAINT partner_financial_terms_policies_policy_version_key UNIQUE (policy_version);


--
-- Name: partner_financial_terms_policy_events partner_financial_terms_policy_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_terms_policy_events
    ADD CONSTRAINT partner_financial_terms_policy_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: partner_financial_terms_policy_events partner_financial_terms_policy_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_terms_policy_events
    ADD CONSTRAINT partner_financial_terms_policy_events_pkey PRIMARY KEY (id);


--
-- Name: partner_order_earnings partner_order_earnings_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_order_earnings
    ADD CONSTRAINT partner_order_earnings_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: partner_order_earnings partner_order_earnings_ledger_transaction_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_order_earnings
    ADD CONSTRAINT partner_order_earnings_ledger_transaction_id_key UNIQUE (ledger_transaction_id);


--
-- Name: partner_order_earnings partner_order_earnings_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_order_earnings
    ADD CONSTRAINT partner_order_earnings_pkey PRIMARY KEY (order_id);


--
-- Name: partner_payout_request_payouts partner_payout_request_payouts_payout_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_payout_request_payouts
    ADD CONSTRAINT partner_payout_request_payouts_payout_id_key UNIQUE (payout_id);


--
-- Name: partner_payout_request_payouts partner_payout_request_payouts_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_payout_request_payouts
    ADD CONSTRAINT partner_payout_request_payouts_pkey PRIMARY KEY (request_id, payout_id);


--
-- Name: partner_payout_requests partner_payout_requests_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_payout_requests
    ADD CONSTRAINT partner_payout_requests_pkey PRIMARY KEY (id);


--
-- Name: partner_store_cash_commissions partner_store_cash_commissions_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_cash_commissions
    ADD CONSTRAINT partner_store_cash_commissions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: partner_store_cash_commissions partner_store_cash_commissions_ledger_transaction_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_cash_commissions
    ADD CONSTRAINT partner_store_cash_commissions_ledger_transaction_id_key UNIQUE (ledger_transaction_id);


--
-- Name: partner_store_cash_commissions partner_store_cash_commissions_payment_intent_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_cash_commissions
    ADD CONSTRAINT partner_store_cash_commissions_payment_intent_id_key UNIQUE (payment_intent_id);


--
-- Name: partner_store_cash_commissions partner_store_cash_commissions_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_cash_commissions
    ADD CONSTRAINT partner_store_cash_commissions_pkey PRIMARY KEY (order_id);


--
-- Name: partner_store_commission_policies_legacy partner_store_commission_policies_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_commission_policies_legacy
    ADD CONSTRAINT partner_store_commission_policies_pkey PRIMARY KEY (store_id, fulfillment_mode);


--
-- Name: partner_store_commission_policy_events_legacy partner_store_commission_policy_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_commission_policy_events_legacy
    ADD CONSTRAINT partner_store_commission_policy_events_pkey PRIMARY KEY (idempotency_key);


--
-- Name: partner_store_commission_policy_initializations_legacy partner_store_commission_policy_initializations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_commission_policy_initializations_legacy
    ADD CONSTRAINT partner_store_commission_policy_initializations_pkey PRIMARY KEY (idempotency_key);


--
-- Name: customer_payment_allocation_events payment_allocation_events_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocation_events
    ADD CONSTRAINT payment_allocation_events_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: customer_payment_allocation_events payment_allocation_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocation_events
    ADD CONSTRAINT payment_allocation_events_pkey PRIMARY KEY (id);


--
-- Name: customer_payment_allocations payment_allocations_order_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocations
    ADD CONSTRAINT payment_allocations_order_uq UNIQUE (order_id);


--
-- Name: customer_payment_allocations payment_allocations_payment_intent_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocations
    ADD CONSTRAINT payment_allocations_payment_intent_uq UNIQUE (payment_intent_id);


--
-- Name: customer_payment_allocations payment_allocations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocations
    ADD CONSTRAINT payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: payment_intent_events payment_intent_events_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payment_intent_events
    ADD CONSTRAINT payment_intent_events_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: payment_intent_events payment_intent_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payment_intent_events
    ADD CONSTRAINT payment_intent_events_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_external_method_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payment_intents
    ADD CONSTRAINT payment_intents_external_method_uq UNIQUE (external_reference, method);


--
-- Name: payment_intents payment_intents_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payment_intents
    ADD CONSTRAINT payment_intents_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: payout_audit_events payout_audit_events_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_audit_events
    ADD CONSTRAINT payout_audit_events_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: payout_audit_events payout_audit_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_audit_events
    ADD CONSTRAINT payout_audit_events_pkey PRIMARY KEY (id);


--
-- Name: payout_holds payout_holds_payout_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_holds
    ADD CONSTRAINT payout_holds_payout_id_key UNIQUE (payout_id);


--
-- Name: payout_holds payout_holds_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_holds
    ADD CONSTRAINT payout_holds_pkey PRIMARY KEY (id);


--
-- Name: payout_requests payout_requests_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_requests
    ADD CONSTRAINT payout_requests_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: payout_requests payout_requests_ledger_transaction_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_requests
    ADD CONSTRAINT payout_requests_ledger_transaction_uq UNIQUE (ledger_transaction_id);


--
-- Name: payout_requests payout_requests_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_requests
    ADD CONSTRAINT payout_requests_pkey PRIMARY KEY (id);


--
-- Name: payout_store_allocations payout_store_allocations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_store_allocations
    ADD CONSTRAINT payout_store_allocations_pkey PRIMARY KEY (payout_id, store_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: settlement_batch_exports settlement_batch_exports_evidence_document_id_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_exports
    ADD CONSTRAINT settlement_batch_exports_evidence_document_id_key UNIQUE (evidence_document_id);


--
-- Name: settlement_batch_exports settlement_batch_exports_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_exports
    ADD CONSTRAINT settlement_batch_exports_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: settlement_batch_exports settlement_batch_exports_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_exports
    ADD CONSTRAINT settlement_batch_exports_pkey PRIMARY KEY (id);


--
-- Name: settlement_batch_items settlement_batch_items_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_items
    ADD CONSTRAINT settlement_batch_items_pkey PRIMARY KEY (batch_id, payout_id);


--
-- Name: settlement_batch_items settlement_batch_items_sequence_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_items
    ADD CONSTRAINT settlement_batch_items_sequence_uq UNIQUE (batch_id, row_sequence);


--
-- Name: settlement_batches settlement_batches_idempotency_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batches
    ADD CONSTRAINT settlement_batches_idempotency_uq UNIQUE (idempotency_key);


--
-- Name: settlement_batches settlement_batches_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batches
    ADD CONSTRAINT settlement_batches_pkey PRIMARY KEY (id);


--
-- Name: settlement_statement_rows settlement_statement_rows_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statement_rows
    ADD CONSTRAINT settlement_statement_rows_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: settlement_statement_rows settlement_statement_rows_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statement_rows
    ADD CONSTRAINT settlement_statement_rows_pkey PRIMARY KEY (id);


--
-- Name: settlement_statement_rows settlement_statement_rows_statement_sequence_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statement_rows
    ADD CONSTRAINT settlement_statement_rows_statement_sequence_uq UNIQUE (statement_id, row_sequence);


--
-- Name: settlement_statement_rows settlement_statement_rows_transfer_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statement_rows
    ADD CONSTRAINT settlement_statement_rows_transfer_uq UNIQUE (matched_transfer_id);


--
-- Name: settlement_statements settlement_statements_evidence_document_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statements
    ADD CONSTRAINT settlement_statements_evidence_document_uq UNIQUE (evidence_document_id);


--
-- Name: settlement_statements settlement_statements_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statements
    ADD CONSTRAINT settlement_statements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: settlement_statements settlement_statements_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statements
    ADD CONSTRAINT settlement_statements_pkey PRIMARY KEY (id);


--
-- Name: store_commercial_agreement_events store_commercial_agreement_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreement_events
    ADD CONSTRAINT store_commercial_agreement_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: store_commercial_agreement_events store_commercial_agreement_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreement_events
    ADD CONSTRAINT store_commercial_agreement_events_pkey PRIMARY KEY (id);


--
-- Name: store_commercial_agreement_rates store_commercial_agreement_rates_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreement_rates
    ADD CONSTRAINT store_commercial_agreement_rates_pkey PRIMARY KEY (agreement_id, fulfillment_mode);


--
-- Name: store_commercial_agreements store_commercial_agreements_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreements
    ADD CONSTRAINT store_commercial_agreements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: store_commercial_agreements store_commercial_agreements_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreements
    ADD CONSTRAINT store_commercial_agreements_pkey PRIMARY KEY (agreement_id);


--
-- Name: store_commercial_agreements store_commercial_agreements_store_version_uq; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreements
    ADD CONSTRAINT store_commercial_agreements_store_version_uq UNIQUE (store_id, agreement_version);


--
-- Name: store_payout_recipient_assignments store_payout_recipient_assignments_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_payout_recipient_assignments
    ADD CONSTRAINT store_payout_recipient_assignments_pkey PRIMARY KEY (id);


--
-- Name: store_payout_recipient_events store_payout_recipient_events_idempotency_key_key; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_payout_recipient_events
    ADD CONSTRAINT store_payout_recipient_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: store_payout_recipient_events store_payout_recipient_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_payout_recipient_events
    ADD CONSTRAINT store_payout_recipient_events_pkey PRIMARY KEY (id);


--
-- Name: store_relation_commercial_model_default_events store_relation_commercial_model_default_events_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_relation_commercial_model_default_events
    ADD CONSTRAINT store_relation_commercial_model_default_events_pkey PRIMARY KEY (idempotency_key);


--
-- Name: store_relation_commercial_model_defaults store_relation_commercial_model_defaults_pkey; Type: CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_relation_commercial_model_defaults
    ADD CONSTRAINT store_relation_commercial_model_defaults_pkey PRIMARY KEY (relation_model);


--
-- Name: approved_payout_snapshots_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX approved_payout_snapshots_actor_idx ON wlt.approved_payout_snapshots USING btree (actor_type, actor_id, created_at DESC);


--
-- Name: beneficiary_settlement_intakes_one_open_per_actor; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX beneficiary_settlement_intakes_one_open_per_actor ON wlt.beneficiary_settlement_intakes USING btree (actor_type, actor_id) WHERE (status = 'REQUESTED'::text);


--
-- Name: beneficiary_settlement_intakes_queue_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX beneficiary_settlement_intakes_queue_idx ON wlt.beneficiary_settlement_intakes USING btree (status, created_at DESC, id DESC);


--
-- Name: captain_cod_reservation_events_reservation_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX captain_cod_reservation_events_reservation_idx ON wlt.captain_cod_reservation_events USING btree (reservation_id, created_at DESC);


--
-- Name: captain_cod_reservations_active_order_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX captain_cod_reservations_active_order_uq ON wlt.captain_cod_reservations USING btree (order_id) WHERE (state = 'ACTIVE'::text);


--
-- Name: captain_cod_reservations_active_payment_intent_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX captain_cod_reservations_active_payment_intent_uq ON wlt.captain_cod_reservations USING btree (payment_intent_id) WHERE (state = 'ACTIVE'::text);


--
-- Name: captain_cod_reservations_actor_state_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX captain_cod_reservations_actor_state_idx ON wlt.captain_cod_reservations USING btree (captain_actor_id, state, created_at DESC);


--
-- Name: captain_cod_reservations_unremitted_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX captain_cod_reservations_unremitted_idx ON wlt.captain_cod_reservations USING btree (captain_actor_id, state, created_at DESC) WHERE (state = ANY (ARRAY['ACTIVE'::text, 'FINALIZED'::text]));


--
-- Name: captain_minimum_balance_one_active; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX captain_minimum_balance_one_active ON wlt.captain_minimum_balance_policies USING btree (state) WHERE (state = 'ACTIVE'::text);


--
-- Name: captain_minimum_balance_versions; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX captain_minimum_balance_versions ON wlt.captain_minimum_balance_policies USING btree (version);


--
-- Name: captain_wallet_funding_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX captain_wallet_funding_actor_idx ON wlt.captain_wallet_funding USING btree (captain_actor_id, created_at DESC);


--
-- Name: cash_in_funding_intents_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX cash_in_funding_intents_actor_idx ON wlt.cash_in_funding_intents USING btree (actor_type, actor_id, created_at DESC, id DESC);


--
-- Name: cash_in_funding_intents_state_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX cash_in_funding_intents_state_idx ON wlt.cash_in_funding_intents USING btree (state, created_at DESC);


--
-- Name: cash_remittance_events_payment_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX cash_remittance_events_payment_idx ON wlt.cash_remittance_events USING btree (payment_intent_id, created_at, id);


--
-- Name: cash_remittances_captain_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX cash_remittances_captain_idx ON wlt.cash_remittances USING btree (captain_actor_id, created_at DESC, id DESC);


--
-- Name: cash_remittances_unreconciled_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX cash_remittances_unreconciled_idx ON wlt.cash_remittances USING btree (captain_actor_id, created_at DESC, id DESC) WHERE (state = 'SUBMITTED'::text);


--
-- Name: commercial_store_type_commission_default_events_scope_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX commercial_store_type_commission_default_events_scope_idx ON wlt.commercial_store_type_commission_default_events USING btree (commercial_store_type_id, fulfillment_mode, changed_at DESC);


--
-- Name: customer_manual_withdrawal_events_intake_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_manual_withdrawal_events_intake_idx ON wlt.customer_manual_withdrawal_events USING btree (intake_id, created_at, id);


--
-- Name: customer_wallet_compensations_order_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_wallet_compensations_order_idx ON wlt.customer_wallet_compensations USING btree (order_id);


--
-- Name: customer_withdrawal_intakes_actor_prefix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_actor_prefix_idx ON wlt.customer_manual_withdrawal_intakes USING btree (lower(customer_actor_id) text_pattern_ops);


--
-- Name: customer_withdrawal_intakes_beneficiary_prefix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_beneficiary_prefix_idx ON wlt.customer_manual_withdrawal_intakes USING btree (lower(beneficiary_name) text_pattern_ops);


--
-- Name: customer_withdrawal_intakes_customer_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_customer_idx ON wlt.customer_manual_withdrawal_intakes USING btree (customer_actor_id, requested_at DESC, id DESC);


--
-- Name: customer_withdrawal_intakes_id_prefix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_id_prefix_idx ON wlt.customer_manual_withdrawal_intakes USING btree (lower(id) text_pattern_ops);


--
-- Name: customer_withdrawal_intakes_provider_prefix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_provider_prefix_idx ON wlt.customer_manual_withdrawal_intakes USING btree (lower(provider_key) text_pattern_ops);


--
-- Name: customer_withdrawal_intakes_queue_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_queue_idx ON wlt.customer_manual_withdrawal_intakes USING btree (status, requested_at DESC, id DESC);


--
-- Name: customer_withdrawal_intakes_requested_queue_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_requested_queue_idx ON wlt.customer_manual_withdrawal_intakes USING btree (requested_at DESC, id DESC);


--
-- Name: customer_withdrawal_intakes_wallet_suffix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX customer_withdrawal_intakes_wallet_suffix_idx ON wlt.customer_manual_withdrawal_intakes USING btree ("right"(wallet_identifier_masked, 4));


--
-- Name: delivery_fee_policies_active_scope_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX delivery_fee_policies_active_scope_uq ON wlt.delivery_fee_policies USING btree (service_city_id) WHERE (state = 'ACTIVE'::text);


--
-- Name: delivery_fee_policies_scope_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX delivery_fee_policies_scope_idx ON wlt.delivery_fee_policies USING btree (service_city_id, version DESC, created_at DESC);


--
-- Name: field_acquisition_entitlements_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX field_acquisition_entitlements_actor_idx ON wlt.field_acquisition_entitlements USING btree (field_actor_id, created_at DESC, store_id);


--
-- Name: field_acquisition_entitlements_joining_case_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX field_acquisition_entitlements_joining_case_uq ON wlt.field_acquisition_entitlements USING btree (joining_case_id) WHERE (joining_case_id IS NOT NULL);


--
-- Name: field_acquisition_entitlements_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX field_acquisition_entitlements_partner_idx ON wlt.field_acquisition_entitlements USING btree (partner_actor_id, created_at DESC) WHERE (partner_actor_id IS NOT NULL);


--
-- Name: field_acquisition_reward_policies_active_scope_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX field_acquisition_reward_policies_active_scope_uq ON wlt.field_acquisition_reward_policies USING btree (scope_type, COALESCE(scope_id, ''::text)) WHERE (state = 'ACTIVE'::text);


--
-- Name: field_acquisition_reward_policies_scope_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX field_acquisition_reward_policies_scope_idx ON wlt.field_acquisition_reward_policies USING btree (scope_type, scope_id, state, created_at DESC);


--
-- Name: finance_evidence_documents_digest_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX finance_evidence_documents_digest_idx ON wlt.finance_evidence_documents USING btree (content_sha256, purpose);


--
-- Name: ledger_entries_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX ledger_entries_actor_idx ON wlt.ledger_entries USING btree (account_code, actor_id, direction, created_at DESC);


--
-- Name: ledger_entries_transaction_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX ledger_entries_transaction_idx ON wlt.ledger_entries USING btree (transaction_id, line_sequence);


--
-- Name: manual_transfer_executions_batch_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX manual_transfer_executions_batch_idx ON wlt.manual_transfer_executions USING btree (batch_id, execution_status, created_at DESC);


--
-- Name: official_wallet_destination_transitions_destination_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX official_wallet_destination_transitions_destination_idx ON wlt.official_wallet_destination_transitions USING btree (destination_id, created_at DESC);


--
-- Name: official_wallet_destinations_active_actor_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX official_wallet_destinations_active_actor_uq ON wlt.official_wallet_destinations USING btree (actor_type, actor_id) WHERE (status = 'ACTIVE_FOR_PAYOUT'::text);


--
-- Name: official_wallet_destinations_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX official_wallet_destinations_actor_idx ON wlt.official_wallet_destinations USING btree (actor_type, actor_id, version DESC);


--
-- Name: order_adjustment_reconciliation_case_order_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX order_adjustment_reconciliation_case_order_idx ON wlt.order_adjustment_reconciliation_cases USING btree (order_id, created_at, id);


--
-- Name: order_promotion_funding_intent_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX order_promotion_funding_intent_idx ON wlt.order_promotion_funding USING btree (payment_intent_id);


--
-- Name: order_promotion_funding_order_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX order_promotion_funding_order_uq ON wlt.order_promotion_funding USING btree (order_id) WHERE (kind = 'ORDER'::text);


--
-- Name: partner_commission_remittances_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_commission_remittances_partner_idx ON wlt.partner_commission_remittances USING btree (partner_actor_id, created_at DESC, id);


--
-- Name: partner_commission_remittances_receipt_document_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX partner_commission_remittances_receipt_document_uq ON wlt.partner_commission_remittances USING btree (receipt_document_id) WHERE (receipt_document_id IS NOT NULL);


--
-- Name: partner_financial_profile_events_profile_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_financial_profile_events_profile_idx ON wlt.partner_financial_profile_events USING btree (profile_id, created_at, id);


--
-- Name: partner_financial_profiles_state_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_financial_profiles_state_idx ON wlt.partner_financial_profiles USING btree (state, updated_at, id);


--
-- Name: partner_financial_terms_policy_active_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX partner_financial_terms_policy_active_uq ON wlt.partner_financial_terms_policies USING btree (state) WHERE (state = 'ACTIVE'::text);


--
-- Name: partner_financial_terms_policy_events_created_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_financial_terms_policy_events_created_idx ON wlt.partner_financial_terms_policy_events USING btree (created_at DESC, id DESC);


--
-- Name: partner_order_earnings_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_order_earnings_partner_idx ON wlt.partner_order_earnings USING btree (partner_actor_id, created_at DESC, order_id);


--
-- Name: partner_order_earnings_partner_store_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_order_earnings_partner_store_idx ON wlt.partner_order_earnings USING btree (partner_actor_id, store_id, created_at DESC);


--
-- Name: partner_order_earnings_payment_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_order_earnings_payment_idx ON wlt.partner_order_earnings USING btree (payment_intent_id);


--
-- Name: partner_payout_requests_idempotency_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX partner_payout_requests_idempotency_uq ON wlt.partner_payout_requests USING btree (idempotency_key);


--
-- Name: partner_payout_requests_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_payout_requests_partner_idx ON wlt.partner_payout_requests USING btree (partner_actor_id, created_at DESC);


--
-- Name: partner_store_cash_commissions_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_store_cash_commissions_partner_idx ON wlt.partner_store_cash_commissions USING btree (partner_actor_id, created_at DESC, order_id);


--
-- Name: partner_store_commission_policies_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_store_commission_policies_partner_idx ON wlt.partner_store_commission_policies_legacy USING btree (partner_actor_id, store_id, fulfillment_mode);


--
-- Name: partner_store_commission_policy_events_store_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX partner_store_commission_policy_events_store_idx ON wlt.partner_store_commission_policy_events_legacy USING btree (store_id, fulfillment_mode, changed_at DESC);


--
-- Name: payment_allocation_events_allocation_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_allocation_events_allocation_idx ON wlt.customer_payment_allocation_events USING btree (allocation_id, created_at, id);


--
-- Name: payment_allocations_policy_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_allocations_policy_idx ON wlt.customer_payment_allocations USING btree (policy_version, created_at DESC, id DESC);


--
-- Name: payment_intent_events_intent_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_intent_events_intent_idx ON wlt.payment_intent_events USING btree (intent_id, created_at, id);


--
-- Name: payment_intents_cash_custody_captain_prefix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_intents_cash_custody_captain_prefix_idx ON wlt.payment_intents USING btree (lower(collected_by_actor_id) text_pattern_ops) WHERE ((state = 'COLLECTED'::text) AND (method = 'CASH_ON_DELIVERY'::text));


--
-- Name: payment_intents_cash_custody_queue_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_intents_cash_custody_queue_idx ON wlt.payment_intents USING btree (collected_at, id) WHERE ((state = 'COLLECTED'::text) AND (method = 'CASH_ON_DELIVERY'::text));


--
-- Name: payment_intents_cash_custody_reference_prefix_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_intents_cash_custody_reference_prefix_idx ON wlt.payment_intents USING btree (lower(external_reference) text_pattern_ops) WHERE ((state = 'COLLECTED'::text) AND (method = 'CASH_ON_DELIVERY'::text));


--
-- Name: payment_intents_external_reference_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_intents_external_reference_idx ON wlt.payment_intents USING btree (external_reference);


--
-- Name: payment_intents_state_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payment_intents_state_idx ON wlt.payment_intents USING btree (state, updated_at DESC);


--
-- Name: payout_audit_events_batch_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payout_audit_events_batch_idx ON wlt.payout_audit_events USING btree (batch_id, created_at DESC);


--
-- Name: payout_audit_events_payout_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payout_audit_events_payout_idx ON wlt.payout_audit_events USING btree (payout_id, created_at DESC);


--
-- Name: payout_holds_actor_active_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payout_holds_actor_active_idx ON wlt.payout_holds USING btree (actor_type, actor_id, status, created_at DESC);


--
-- Name: payout_requests_actor_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payout_requests_actor_idx ON wlt.payout_requests USING btree (actor_type, actor_id, created_at DESC);


--
-- Name: payout_store_allocations_store_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX payout_store_allocations_store_idx ON wlt.payout_store_allocations USING btree (store_id);


--
-- Name: settlement_batch_exports_batch_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX settlement_batch_exports_batch_idx ON wlt.settlement_batch_exports USING btree (batch_id, created_at DESC);


--
-- Name: settlement_batch_items_payout_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX settlement_batch_items_payout_idx ON wlt.settlement_batch_items USING btree (payout_id);


--
-- Name: settlement_batches_status_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX settlement_batches_status_idx ON wlt.settlement_batches USING btree (status, created_at DESC);


--
-- Name: settlement_statement_rows_reference_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX settlement_statement_rows_reference_idx ON wlt.settlement_statement_rows USING btree (external_transfer_reference);


--
-- Name: settlement_statement_rows_unmatched_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX settlement_statement_rows_unmatched_idx ON wlt.settlement_statement_rows USING btree (statement_id, row_sequence) WHERE (matched_transfer_id IS NULL);


--
-- Name: settlement_statements_period_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX settlement_statements_period_idx ON wlt.settlement_statements USING btree (provider_key, period_start, period_end, created_at DESC);


--
-- Name: store_commercial_agreement_events_history_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX store_commercial_agreement_events_history_idx ON wlt.store_commercial_agreement_events USING btree (agreement_id, created_at, id);


--
-- Name: store_commercial_agreements_one_active_store_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX store_commercial_agreements_one_active_store_uq ON wlt.store_commercial_agreements USING btree (store_id) WHERE (status = 'ACTIVE'::text);


--
-- Name: store_commercial_agreements_one_pending_store_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX store_commercial_agreements_one_pending_store_uq ON wlt.store_commercial_agreements USING btree (store_id) WHERE (status = ANY (ARRAY['PROPOSED'::text, 'PARTNER_ACCEPTED'::text]));


--
-- Name: store_commercial_agreements_store_history_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX store_commercial_agreements_store_history_idx ON wlt.store_commercial_agreements USING btree (store_id, agreement_version DESC);


--
-- Name: store_payout_recipient_assignments_beneficiary_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX store_payout_recipient_assignments_beneficiary_idx ON wlt.store_payout_recipient_assignments USING btree (beneficiary_actor_id, state);


--
-- Name: store_payout_recipient_assignments_partner_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX store_payout_recipient_assignments_partner_idx ON wlt.store_payout_recipient_assignments USING btree (partner_actor_id, store_id);


--
-- Name: store_payout_recipient_assignments_store_uq; Type: INDEX; Schema: wlt; Owner: -
--

CREATE UNIQUE INDEX store_payout_recipient_assignments_store_uq ON wlt.store_payout_recipient_assignments USING btree (store_id);


--
-- Name: store_payout_recipient_events_history_idx; Type: INDEX; Schema: wlt; Owner: -
--

CREATE INDEX store_payout_recipient_events_history_idx ON wlt.store_payout_recipient_events USING btree (store_id, created_at, id);


--
-- Name: payout_store_allocations payout_store_allocations_guard; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER payout_store_allocations_guard BEFORE INSERT OR DELETE OR UPDATE ON wlt.payout_store_allocations FOR EACH ROW EXECUTE FUNCTION wlt.guard_payout_store_allocation();


--
-- Name: store_commercial_agreements store_agreement_reject_retired_hybrid; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER store_agreement_reject_retired_hybrid BEFORE INSERT OR UPDATE ON wlt.store_commercial_agreements FOR EACH ROW EXECUTE FUNCTION wlt.reject_retired_hybrid_store_agreement();


--
-- Name: store_commercial_agreement_events store_commercial_agreement_events_immutable; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER store_commercial_agreement_events_immutable BEFORE DELETE OR UPDATE ON wlt.store_commercial_agreement_events FOR EACH ROW EXECUTE FUNCTION wlt.reject_store_commercial_agreement_event_mutation();


--
-- Name: store_commercial_agreements store_commercial_agreement_model_immutable; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER store_commercial_agreement_model_immutable BEFORE UPDATE ON wlt.store_commercial_agreements FOR EACH ROW EXECUTE FUNCTION wlt.guard_store_commercial_model_immutability();


--
-- Name: store_commercial_agreement_rates store_commercial_agreement_rates_immutable; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER store_commercial_agreement_rates_immutable BEFORE DELETE OR UPDATE ON wlt.store_commercial_agreement_rates FOR EACH ROW EXECUTE FUNCTION wlt.reject_store_commercial_agreement_rate_mutation();


--
-- Name: store_commercial_agreements store_commercial_agreements_lifecycle_guard; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER store_commercial_agreements_lifecycle_guard BEFORE UPDATE ON wlt.store_commercial_agreements FOR EACH ROW EXECUTE FUNCTION wlt.guard_store_commercial_agreement_mutation();


--
-- Name: store_payout_recipient_events store_payout_recipient_events_immutable; Type: TRIGGER; Schema: wlt; Owner: -
--

CREATE TRIGGER store_payout_recipient_events_immutable BEFORE DELETE OR UPDATE ON wlt.store_payout_recipient_events FOR EACH ROW EXECUTE FUNCTION wlt.reject_store_payout_recipient_event_mutation();


--
-- Name: approved_payout_snapshots approved_payout_snapshots_destination_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.approved_payout_snapshots
    ADD CONSTRAINT approved_payout_snapshots_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT;


--
-- Name: approved_payout_snapshots approved_payout_snapshots_payout_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.approved_payout_snapshots
    ADD CONSTRAINT approved_payout_snapshots_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_evidence_document_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_evidence_document_id_fkey FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_payment_intent_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_payment_intent_id_fkey FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: captain_cod_legacy_recovery_reviews captain_cod_legacy_recovery_reviews_reservation_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_legacy_recovery_reviews
    ADD CONSTRAINT captain_cod_legacy_recovery_reviews_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES wlt.captain_cod_reservations(id) ON DELETE RESTRICT;


--
-- Name: captain_cod_reservation_events captain_cod_reservation_events_reservation_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_cod_reservation_events
    ADD CONSTRAINT captain_cod_reservation_events_reservation_fk FOREIGN KEY (reservation_id) REFERENCES wlt.captain_cod_reservations(id) ON DELETE RESTRICT;


--
-- Name: captain_wallet_funding captain_wallet_funding_ledger_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.captain_wallet_funding
    ADD CONSTRAINT captain_wallet_funding_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: cash_in_funding_intent_events cash_in_funding_intent_events_intent_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intent_events
    ADD CONSTRAINT cash_in_funding_intent_events_intent_fk FOREIGN KEY (funding_intent_id) REFERENCES wlt.cash_in_funding_intents(id) ON DELETE RESTRICT;


--
-- Name: cash_in_funding_intents cash_in_funding_intents_ledger_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_in_funding_intents
    ADD CONSTRAINT cash_in_funding_intents_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: cash_remittance_events cash_remittance_events_evidence_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittance_events
    ADD CONSTRAINT cash_remittance_events_evidence_fk FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: cash_remittance_events cash_remittance_events_payment_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittance_events
    ADD CONSTRAINT cash_remittance_events_payment_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: cash_remittance_events cash_remittance_events_remittance_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittance_events
    ADD CONSTRAINT cash_remittance_events_remittance_fk FOREIGN KEY (remittance_id) REFERENCES wlt.cash_remittances(id) ON DELETE RESTRICT;


--
-- Name: cash_remittances cash_remittances_payment_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittances
    ADD CONSTRAINT cash_remittances_payment_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: cash_remittances cash_remittances_receipt_document_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.cash_remittances
    ADD CONSTRAINT cash_remittances_receipt_document_fk FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: commercial_store_type_commission_default_events commercial_store_type_commission_default_event_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.commercial_store_type_commission_default_events
    ADD CONSTRAINT commercial_store_type_commission_default_event_fk FOREIGN KEY (commercial_store_type_id, fulfillment_mode) REFERENCES wlt.commercial_store_type_commission_defaults(commercial_store_type_id, fulfillment_mode) ON DELETE RESTRICT;


--
-- Name: customer_manual_withdrawal_events customer_manual_withdrawal_events_evidence_document_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_events
    ADD CONSTRAINT customer_manual_withdrawal_events_evidence_document_id_fkey FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: customer_manual_withdrawal_events customer_manual_withdrawal_events_intake_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_events
    ADD CONSTRAINT customer_manual_withdrawal_events_intake_id_fkey FOREIGN KEY (intake_id) REFERENCES wlt.customer_manual_withdrawal_intakes(id) ON DELETE RESTRICT;


--
-- Name: customer_manual_withdrawal_events customer_manual_withdrawal_events_payout_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_events
    ADD CONSTRAINT customer_manual_withdrawal_events_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: customer_manual_withdrawal_intakes customer_manual_withdrawal_in_request_evidence_document_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_intakes
    ADD CONSTRAINT customer_manual_withdrawal_in_request_evidence_document_id_fkey FOREIGN KEY (request_evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: customer_manual_withdrawal_intakes customer_manual_withdrawal_intakes_destination_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_intakes
    ADD CONSTRAINT customer_manual_withdrawal_intakes_destination_id_fkey FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT;


--
-- Name: customer_manual_withdrawal_intakes customer_manual_withdrawal_intakes_payout_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_manual_withdrawal_intakes
    ADD CONSTRAINT customer_manual_withdrawal_intakes_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: customer_payment_allocations customer_payment_allocations_commission_agreement_id_snaps_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocations
    ADD CONSTRAINT customer_payment_allocations_commission_agreement_id_snaps_fkey FOREIGN KEY (commission_agreement_id_snapshot) REFERENCES wlt.store_commercial_agreements(agreement_id) ON DELETE RESTRICT;


--
-- Name: customer_wallet_compensations customer_wallet_compensations_case_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_wallet_compensations
    ADD CONSTRAINT customer_wallet_compensations_case_id_fkey FOREIGN KEY (case_id) REFERENCES wlt.order_adjustment_reconciliation_cases(id) ON DELETE RESTRICT;


--
-- Name: customer_wallet_compensations customer_wallet_compensations_ledger_transaction_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_wallet_compensations
    ADD CONSTRAINT customer_wallet_compensations_ledger_transaction_id_fkey FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: delivery_fee_policy_events delivery_fee_policy_events_policy_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.delivery_fee_policy_events
    ADD CONSTRAINT delivery_fee_policy_events_policy_fk FOREIGN KEY (policy_id) REFERENCES wlt.delivery_fee_policies(id) ON DELETE RESTRICT;


--
-- Name: field_acquisition_entitlements field_acquisition_entitlements_ledger_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_entitlements
    ADD CONSTRAINT field_acquisition_entitlements_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: field_acquisition_entitlements field_acquisition_entitlements_policy_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.field_acquisition_entitlements
    ADD CONSTRAINT field_acquisition_entitlements_policy_fk FOREIGN KEY (policy_id) REFERENCES wlt.field_acquisition_reward_policies(id) ON DELETE RESTRICT;


--
-- Name: finance_transfer_receipt_claims finance_transfer_receipt_claims_evidence_document_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.finance_transfer_receipt_claims
    ADD CONSTRAINT finance_transfer_receipt_claims_evidence_document_id_fkey FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: ledger_entries ledger_entries_transaction_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.ledger_entries
    ADD CONSTRAINT ledger_entries_transaction_fk FOREIGN KEY (transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: manual_transfer_executions manual_transfer_executions_batch_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT;


--
-- Name: manual_transfer_executions manual_transfer_executions_destination_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT;


--
-- Name: manual_transfer_executions manual_transfer_executions_payout_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: manual_transfer_executions manual_transfer_executions_snapshot_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_snapshot_fk FOREIGN KEY (payout_id) REFERENCES wlt.approved_payout_snapshots(payout_id) ON DELETE RESTRICT;


--
-- Name: manual_transfer_executions manual_transfer_executions_statement_row_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_executions_statement_row_fk FOREIGN KEY (statement_row_id) REFERENCES wlt.settlement_statement_rows(id) ON DELETE RESTRICT;


--
-- Name: manual_transfer_executions manual_transfer_receipt_document_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.manual_transfer_executions
    ADD CONSTRAINT manual_transfer_receipt_document_fk FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: official_wallet_destination_transitions official_wallet_destination_transitions_destination_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.official_wallet_destination_transitions
    ADD CONSTRAINT official_wallet_destination_transitions_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT;


--
-- Name: order_adjustment_reconciliation_cases order_adjustment_reconciliation_cases_payment_intent_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.order_adjustment_reconciliation_cases
    ADD CONSTRAINT order_adjustment_reconciliation_cases_payment_intent_id_fkey FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: partner_commission_remittances partner_commission_remittances_ledger_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_remittances
    ADD CONSTRAINT partner_commission_remittances_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: partner_commission_remittances partner_commission_remittances_receipt_document_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_commission_remittances
    ADD CONSTRAINT partner_commission_remittances_receipt_document_fk FOREIGN KEY (receipt_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: partner_financial_profile_events partner_financial_profile_events_profile_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_profile_events
    ADD CONSTRAINT partner_financial_profile_events_profile_fk FOREIGN KEY (profile_id) REFERENCES wlt.partner_financial_profiles(id) ON DELETE RESTRICT;


--
-- Name: partner_financial_terms_policy_events partner_financial_terms_policy_events_policy_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_financial_terms_policy_events
    ADD CONSTRAINT partner_financial_terms_policy_events_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES wlt.partner_financial_terms_policies(id) ON DELETE RESTRICT;


--
-- Name: partner_order_earnings partner_order_earnings_ledger_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_order_earnings
    ADD CONSTRAINT partner_order_earnings_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: partner_payout_request_payouts partner_payout_request_payouts_payout_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_payout_request_payouts
    ADD CONSTRAINT partner_payout_request_payouts_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: partner_payout_request_payouts partner_payout_request_payouts_request_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_payout_request_payouts
    ADD CONSTRAINT partner_payout_request_payouts_request_id_fkey FOREIGN KEY (request_id) REFERENCES wlt.partner_payout_requests(id) ON DELETE RESTRICT;


--
-- Name: partner_store_cash_commissions partner_store_cash_commissions_ledger_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_cash_commissions
    ADD CONSTRAINT partner_store_cash_commissions_ledger_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: partner_store_cash_commissions partner_store_cash_commissions_payment_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_cash_commissions
    ADD CONSTRAINT partner_store_cash_commissions_payment_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: partner_store_commission_policies_legacy partner_store_commission_policies_profile_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_commission_policies_legacy
    ADD CONSTRAINT partner_store_commission_policies_profile_fk FOREIGN KEY (profile_id) REFERENCES wlt.partner_financial_profiles(id) ON DELETE RESTRICT;


--
-- Name: partner_store_commission_policy_events_legacy partner_store_commission_policy_events_policy_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_commission_policy_events_legacy
    ADD CONSTRAINT partner_store_commission_policy_events_policy_fk FOREIGN KEY (store_id, fulfillment_mode) REFERENCES wlt.partner_store_commission_policies_legacy(store_id, fulfillment_mode) ON DELETE RESTRICT;


--
-- Name: partner_store_commission_policy_initializations_legacy partner_store_commission_policy_initializations_profile_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.partner_store_commission_policy_initializations_legacy
    ADD CONSTRAINT partner_store_commission_policy_initializations_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES wlt.partner_financial_profiles(id) ON DELETE RESTRICT;


--
-- Name: customer_payment_allocation_events payment_allocation_events_allocation_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocation_events
    ADD CONSTRAINT payment_allocation_events_allocation_fk FOREIGN KEY (allocation_id) REFERENCES wlt.customer_payment_allocations(id) ON DELETE RESTRICT;


--
-- Name: customer_payment_allocations payment_allocations_payment_intent_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.customer_payment_allocations
    ADD CONSTRAINT payment_allocations_payment_intent_fk FOREIGN KEY (payment_intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: payment_intent_events payment_intent_events_intent_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payment_intent_events
    ADD CONSTRAINT payment_intent_events_intent_fk FOREIGN KEY (intent_id) REFERENCES wlt.payment_intents(id) ON DELETE RESTRICT;


--
-- Name: payout_audit_events payout_audit_events_batch_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_audit_events
    ADD CONSTRAINT payout_audit_events_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT;


--
-- Name: payout_audit_events payout_audit_events_payout_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_audit_events
    ADD CONSTRAINT payout_audit_events_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: payout_holds payout_holds_payout_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_holds
    ADD CONSTRAINT payout_holds_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: payout_requests payout_requests_destination_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_requests
    ADD CONSTRAINT payout_requests_destination_fk FOREIGN KEY (destination_id) REFERENCES wlt.official_wallet_destinations(id) ON DELETE RESTRICT;


--
-- Name: payout_requests payout_requests_ledger_transaction_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_requests
    ADD CONSTRAINT payout_requests_ledger_transaction_fk FOREIGN KEY (ledger_transaction_id) REFERENCES wlt.ledger_transactions(id) ON DELETE RESTRICT;


--
-- Name: payout_store_allocations payout_store_allocations_payout_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.payout_store_allocations
    ADD CONSTRAINT payout_store_allocations_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: settlement_batch_exports settlement_batch_exports_batch_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_exports
    ADD CONSTRAINT settlement_batch_exports_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT;


--
-- Name: settlement_batch_exports settlement_batch_exports_document_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_exports
    ADD CONSTRAINT settlement_batch_exports_document_fk FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: settlement_batch_items settlement_batch_items_batch_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_items
    ADD CONSTRAINT settlement_batch_items_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT;


--
-- Name: settlement_batch_items settlement_batch_items_payout_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_items
    ADD CONSTRAINT settlement_batch_items_payout_fk FOREIGN KEY (payout_id) REFERENCES wlt.payout_requests(id) ON DELETE RESTRICT;


--
-- Name: settlement_batch_items settlement_batch_items_snapshot_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_batch_items
    ADD CONSTRAINT settlement_batch_items_snapshot_fk FOREIGN KEY (payout_id) REFERENCES wlt.approved_payout_snapshots(payout_id) ON DELETE RESTRICT;


--
-- Name: settlement_statement_rows settlement_statement_rows_statement_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statement_rows
    ADD CONSTRAINT settlement_statement_rows_statement_fk FOREIGN KEY (statement_id) REFERENCES wlt.settlement_statements(id) ON DELETE RESTRICT;


--
-- Name: settlement_statement_rows settlement_statement_rows_transfer_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statement_rows
    ADD CONSTRAINT settlement_statement_rows_transfer_fk FOREIGN KEY (matched_transfer_id) REFERENCES wlt.manual_transfer_executions(id) ON DELETE RESTRICT;


--
-- Name: settlement_statements settlement_statements_batch_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statements
    ADD CONSTRAINT settlement_statements_batch_fk FOREIGN KEY (batch_id) REFERENCES wlt.settlement_batches(id) ON DELETE RESTRICT;


--
-- Name: settlement_statements settlement_statements_evidence_fk; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.settlement_statements
    ADD CONSTRAINT settlement_statements_evidence_fk FOREIGN KEY (evidence_document_id) REFERENCES wlt.finance_evidence_documents(id) ON DELETE RESTRICT;


--
-- Name: store_commercial_agreement_events store_commercial_agreement_events_agreement_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreement_events
    ADD CONSTRAINT store_commercial_agreement_events_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES wlt.store_commercial_agreements(agreement_id) ON DELETE RESTRICT;


--
-- Name: store_commercial_agreement_rates store_commercial_agreement_rates_agreement_id_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_commercial_agreement_rates
    ADD CONSTRAINT store_commercial_agreement_rates_agreement_id_fkey FOREIGN KEY (agreement_id) REFERENCES wlt.store_commercial_agreements(agreement_id) ON DELETE RESTRICT;


--
-- Name: store_relation_commercial_model_default_events store_relation_commercial_model_default_eve_relation_model_fkey; Type: FK CONSTRAINT; Schema: wlt; Owner: -
--

ALTER TABLE ONLY wlt.store_relation_commercial_model_default_events
    ADD CONSTRAINT store_relation_commercial_model_default_eve_relation_model_fkey FOREIGN KEY (relation_model) REFERENCES wlt.store_relation_commercial_model_defaults(relation_model) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: ledger_transactions; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: official_wallet_destinations; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: payout_requests; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: approved_payout_snapshots; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: beneficiary_settlement_intakes; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: captain_cod_reservations; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: finance_evidence_documents; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: payment_intents; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: captain_cod_legacy_recovery_reviews; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: captain_cod_reservation_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: captain_minimum_balance_policies; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: captain_wallet_funding; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: cash_in_funding_intents; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: cash_in_funding_intent_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: cash_remittances; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: cash_remittance_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: commercial_store_type_commission_defaults; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: commercial_store_type_commission_default_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: customer_manual_withdrawal_intakes; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: customer_manual_withdrawal_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_commercial_agreements; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: customer_payment_allocations; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: customer_payment_allocation_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: order_adjustment_reconciliation_cases; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: customer_wallet_compensations; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: delivery_fee_policies; Type: TABLE DATA; Schema: wlt; Owner: -
--

INSERT INTO wlt.delivery_fee_policies VALUES ('delivery-policy-global-v1', '', 'delivery-fee:global:v1', 'ACTIVE', 0, 1000, 0, 1, 0, 0, 50, 1, 'system:migration', '2026-11-11 22:44:28.924724+00', NULL, NULL);


--
-- Data for Name: delivery_fee_policy_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: field_acquisition_reward_policies; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: field_acquisition_entitlements; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: finance_transfer_receipt_claims; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: ledger_entries; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: settlement_batches; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: manual_transfer_executions; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: official_wallet_destination_transitions; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: order_promotion_funding; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_commission_credit_policies; Type: TABLE DATA; Schema: wlt; Owner: -
--

INSERT INTO wlt.partner_commission_credit_policies VALUES ('platform-default', 200000, 7, 'ACTIVE', 1, 'system:local-development-bootstrap', '2026-11-11 22:44:31.149786+00');


--
-- Data for Name: partner_commission_rate_history; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_commission_remittances; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_financial_profiles; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_financial_profile_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_financial_terms_policies; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_financial_terms_policy_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_order_earnings; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_payout_requests; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_payout_request_payouts; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_store_cash_commissions; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_store_commission_policies_legacy; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_store_commission_policy_events_legacy; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: partner_store_commission_policy_initializations_legacy; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: payment_intent_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: payout_audit_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: payout_holds; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: payout_store_allocations; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: settlement_batch_exports; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: settlement_batch_items; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: settlement_statements; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: settlement_statement_rows; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_commercial_agreement_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_commercial_agreement_rates; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_payout_recipient_assignments; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_payout_recipient_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_relation_commercial_model_defaults; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Data for Name: store_relation_commercial_model_default_events; Type: TABLE DATA; Schema: wlt; Owner: -
--



--
-- Name: cash_remittance_events_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.cash_remittance_events_id_seq', 1, false);


--
-- Name: delivery_fee_policy_events_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.delivery_fee_policy_events_id_seq', 1, false);


--
-- Name: ledger_entries_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.ledger_entries_id_seq', 1, false);


--
-- Name: partner_financial_profile_events_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.partner_financial_profile_events_id_seq', 1, false);


--
-- Name: partner_financial_terms_policy_events_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.partner_financial_terms_policy_events_id_seq', 1, false);


--
-- Name: payment_allocation_events_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.payment_allocation_events_id_seq', 1, false);


--
-- Name: store_payout_recipient_events_id_seq; Type: SEQUENCE SET; Schema: wlt; Owner: -
--

SELECT pg_catalog.setval('wlt.store_payout_recipient_events_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--

INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(1,'001_payment_intents.sql','469dfaf49af48808f35e42865f0ec95d7a4fa38c5659226bcc317339a583365a');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(2,'002_cash_remittances.sql','c2810f886471945f3d638248f91b8c664fd426d164f99704042bc7d9bee3f3d2');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(3,'003_partner_financial_profiles.sql','06b5cfc922bbbceb08eff8e266e8c168656366dd59c7942d5e6273206726b3da');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(4,'004_payment_allocations.sql','88fefef65cdfba5b08de1ace5336c64626a49ad08052f17e069640141c7e39a3');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(5,'005_delivery_fee_policies.sql','d1482b880f47badeacff2f7b8b275cc7d1d1b4a15b62e71b83bcca30c9c2d6b0');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(6,'006_partner_order_earnings_ledger.sql','3c4f8f0aab3c911276355bfccba32340efb07bf124aed90b4a37d6466fcdad01');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(7,'007_official_wallet_destinations_and_payout_intents.sql','07adc54669960092fd23568244553ea5dab5639cd632a5077df4725df9c9c524');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(8,'008_field_commission_policies_and_earnings.sql','0f27ba0681a6c09ee1c6c7a219484740b5b97525e258d466e0c0bd3b54a937e4');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(9,'009_manual_settlement_governance.sql','ea19f73376d9c38e0738dcc66c919ba55885070c5a9444167fa204a0af068769');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(10,'010_captain_wallet_cod_reservations.sql','decf2e913c770ca6ac99c8eac645429226a155f23ddae3ffd52c9ebc15ade9f5');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(11,'011_captain_cod_collateral_settlement.sql','79597784cb9badf7567ce4c0f2a4e4d9991564986bde2216dfc831411fa0ebe2');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(12,'012_customer_payment_allocation_refoundation.sql','2912ed6126e75a7f695b651a43d0a9980aab1d011c48c40e608fec025e34a0f0');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(13,'013_captain_cod_reassignment_reservations.sql','3f1e449a68fcb377270c6e7099bcc816cd6252684ce0ef112bea0b15372d774d');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(14,'014_partner_store_pickup_commission_receivables.sql','e9ea9b113c3c35fbfc574b5fd9253f895f0ec67770f7f40b7d920e4406e50cec');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(15,'015_partner_store_cash_commission_generalization.sql','7bee58e0a83e9d3418c128b6c38041b68bea800646c20079ef66d8171585cf72');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(16,'016_partner_store_mode_commission_snapshots.sql','7343158efaf71732bec489d21005470b5fb8c6283d80fd9b09dcd80d5c1ee0e8');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(17,'017_policy_change_control.sql','da8e2be280a44d9948835d2d79eee96aee7cd84b40791f0e4e12fa205a856cce');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(18,'018_partner_financial_terms_policies.sql','ab02d2ad27feca811432a9cf5b6e0d82c1147fc3760d1d71cc7a25e7e3b3e884');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(19,'019_settlement_statement_reconciliation.sql','4ff5dff8274a4d1e1fc924e37b2cb3116945c0a34169f814a295e415f665f979');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(20,'020_settlement_batch_execution_artifacts.sql','b1b1813a1a396452e4f2dcc64faa12802694f9fb2a82062463c7538f33257bd2');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(21,'021_finance_evidence_download_audit.sql','735ff4ccd05c19fccab4321bed82e6fb2269e6194e141709d9e1bdf82dd6f717');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(22,'022_cash_in_funding_intents.sql','d1c4be1491cb864c7de961aa30717086801c24a0b37be9d1e16917ef9db018fd');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(23,'023_destination_identity_name_provenance.sql','a19c0a2873da80fdb27a992dfb112d8fbb67f419716dd630bd8195091227de85');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(24,'024_customer_manual_withdrawal_intakes.sql','aad3f00e98d47a05f464faa8083b743540bd6e24f616dee7c583be2ded9bab27');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(25,'025_customer_withdrawal_registry_search.sql','f78c602f56251bd57859aaef8c5fbdd248a4c5aa0ceae690af791c284e85548d');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(26,'026_cash_custody_operational_registry.sql','a8dba963be862ee26c49278bba94ed88948f1cf1f068110311fa3c14a2bbfeef');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(27,'027_partner_commission_policy_snapshot_length.sql','34f9395b2dc349d15b2fac5eb48582e0f202c5daecce91883e04b66e1147e171');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(28,'028_customer_balance_order_settlement.sql','be970921ace0e4f2ffe462285120480a460cc7a55f512d6af9aa98e936340ec8');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(29,'029_settlement_separation_of_duties.sql','a5998df1268ef06f5b22313bf3f929ec0076ad0d4982807dfadd411eab43a630');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(30,'030_field_reward_category_policy_scope.sql','3f65a4017af455265a0f4b9d294c0eecb1782a2597e5310c9c2cde658dd1f02f');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(31,'031_field_acquisition_entitlement.sql','6fe3d63b485a0100c2f25a1aae8ac66b46f7c3c49b7b18504fdee28ba1357d66');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(32,'032_commercial_store_type_policies.sql','da8ccfff25398dd64f2d020d02ce0fc031273dc2d8af63e54810c30700f34f83');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(33,'033_commercial_store_type_commission_policies.sql','5e2eb1bb86db3780329603ac464e17ee19d54a8904694ec8f49f7235e6aa3918');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(34,'034_store_type_commission_owns_rate.sql','1b71584b4f7455508218adf576ae28685667635b82524dc74d96c5cfffaf155f');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(35,'035_captain_cod_remittance_reconciliation.sql','4cf78da63c58c19749a7f13f09bd3140db8d05b9836073228e47b46188aac086');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(36,'036_partner_commission_remittance_receipts.sql','7f16d4fb93d9d3c13175f1140a7d311ae698742d4e4137d89d73318112eed54d');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(37,'037_finance_transfer_receipt_claims.sql','3393d483da49598263288c47c013a3030e4618bb4d5a952fb7ab524e642600ba');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(38,'038_order_adjustment_reconciliation_cases.sql','f8146216cf2d896843a4ad42f32aa901a227072b5e11ddad01f360b3c6b314b8');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(39,'039_store_agreements_and_identity_reverification.sql','f986e30d636f3cd3f11fd21c86076ddb1a9baeaa80dc9ad0fc7513b8a9084698');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(40,'040_store_agreement_finance_decision_facts.sql','ea9e541369f05652b77436ce0f1670d6b824fbfbd201a1ee81503c42b68259b4');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(41,'041_official_wallet_identity_stale_transition.sql','651a530f9e4a8675d37293bb52fc22ac3b43533314d5279d93c7823d81faa7cf');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(42,'042_store_payout_recipient_assignments.sql','e386c1dea70516a54999eab33be7943aa4a1d7edea9ba965040f1047b494dc82');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(43,'043_partner_earnings_store_attribution.sql','e57806785ba1e886026906e80962008893799f2b3a10ad48ff72dcf4ad6fce67');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(44,'044_partner_payout_partitioning.sql','d5103571b97f60dbb0f51ecc65c3518cc06bdaf6d7a3cc02a914eb7ea9c232fe');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(45,'045_order_promotion_funding.sql','dc9079b287d005c547e36366cbddd7e48fb08bff62203828ec6713a9484fd905');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(46,'046_partner_payout_store_scope.sql','4d3f8b04fb0aebba7a1815d56c61387105cb6515732998c797f9cb26f908efd5');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(47,'047_promotion_expense_ledger_account.sql','59c2be9e2fde91354ece7d691279c392311f726017e13def82515007820b1c26');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(48,'048_customer_wallet_compensation.sql','a579cf2087961bec0af2f5daef5013dfe4cc781c7a326196ed388fe509babe1b');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(49,'049_captain_minimum_balance_policy.sql','5991d37d583708008896f89a1dcc8358a1c4c9bb9efac3ce823377acacd314ae');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(50,'050_delivery_distance_bands.sql','9725d3613c7b9eddbba88ea568a8599fe7fe07ad36fb4c8e74a72e98199c0666');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(51,'051_beneficiary_settlement_intake.sql','166ae87f7a84f274cf701c99791515ca9576307cba11f91793e4efd3cfe0196b');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(52,'052_captain_cod_wallet_debit.sql','36bc4e1b03afde5fbe51ce462ffdbfa42933574a69e0cdeabb57d5fddc54e3e4');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(53,'053_delivery_margin_and_store_markup.sql','ccccdeed3c2f13313035d809152e930428c6a097a0a7aa66ecf6c54025b2bfe4');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(54,'054_partner_delivery_pricing_modes.sql','04fdc79a8bf457bc7dd93630159fbf9c1e635c96accac4f21590c714a50c30af');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(55,'055_cash_in_provider_fee_platform_expense.sql','ba8776746fe1d297043f538cce07485112cd829546907c8cc54ea8e22c5149b6');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(56,'056_customer_compensation_closes_reviewed_case.sql','38b96db597299bd84b8c9012b25145fb32d799c0ae6db17eb99189f44da73e45');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(57,'057_partner_commission_credit_guard.sql','4ce8ddc517d8ba2311f1d3acc339d3d3b2df384a5a0bb1d42be4a4f60ca6760d');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(58,'058_self_service_partner_profile_origin.sql','07ef532f4ccf88848c7e73852d0d7ddd338d1ffae2b972427c428b8c6591b3b7');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(59,'059_store_agreement_commercial_models.sql','c5f556c9ced1aefdac42e36c1d4a0913a29c50d9dcc8993ddcaaa86ee74e9592');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(60,'060_retire_hybrid_store_agreements.sql','5f74d6d0ee56ad5b4f8abc16d4aac90a37a2b6de93dc94106eaabab2025cd2dd');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(61,'061_legacy_cod_recovery_reviews.sql','5031aae38c8c82a7c503fe846ad939603002c45b9857fbc96c8b066729b3ee89');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(62,'062_store_relation_commercial_model_defaults.sql','372d9aeb818b7d6e0000702571a0797125c7f434a712898c0018c20a9b7a9bca');
INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES(63,'063_store_relation_model_default_event_integrity.sql','6f3bc02d45cffcbb446e861218cad336b8c2ee298cf9e9baf959590ee877b805');
