ALTER TABLE dsh.notification_read_state
    DROP CONSTRAINT notification_read_state_notification_chk,
    ADD CONSTRAINT notification_read_state_notification_chk
        CHECK (notification_id ~ '^(order|captain|field):[1-9][0-9]*$');
