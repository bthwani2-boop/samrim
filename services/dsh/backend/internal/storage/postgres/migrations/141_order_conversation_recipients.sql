-- Route one Order conversation by per-message audience; existing messages retain all-party visibility.
ALTER TABLE dsh.commerce_order_conversation_messages
    ADD COLUMN recipient_roles text[] NOT NULL DEFAULT ARRAY['client','partner','captain']::text[];
ALTER TABLE dsh.commerce_order_conversation_messages
    DROP CONSTRAINT commerce_order_conversation_messages_sender_role_chk;
ALTER TABLE dsh.commerce_order_conversation_messages
    ADD CONSTRAINT commerce_order_conversation_messages_sender_role_chk
        CHECK (sender_role IN ('client','partner','captain','operator'));
ALTER TABLE dsh.commerce_order_conversation_messages
    ADD CONSTRAINT commerce_order_conversation_messages_recipients_chk CHECK (
        cardinality(recipient_roles) BETWEEN 1 AND 4
        AND recipient_roles <@ ARRAY['client','partner','captain','operator']::text[]
    );
