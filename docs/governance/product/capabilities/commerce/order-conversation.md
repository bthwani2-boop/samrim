# Order Conversation

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/order-conversation.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: ORDER_CONVERSATION

## Outcome

Authorized participants exchange bounded Order-scoped operational messages without creating a general social/chat system or parallel Order truth.

## Ownership

DSH owns conversation membership, message identity/content relation, read state, lifecycle and moderation/visibility rules. Media/notification providers are technical adapters only.

## Invariants

- conversation is bound to one canonical Store Order;
- participants derive from current authorized Order/Store/Captain/customer relations; the captain joins only during an active assignment, not via public self-registration;
- senders select one or more operational recipients; DSH filters message reads and read receipts to only the sender, selected recipients and authorized operations;
- authorized operations can review every Order message without opening a separate chat, while their composer is explicitly opt-in and requires operations permission;
- an Order message, media item or support escalation cannot perform payment, payout, refund, settlement or custody state changes;
- text is the baseline message type; each message may attach one image (JPEG/PNG/WebP, at most 3 MiB), one voice recording (admitted MP4/M4A/3GPP/AAC/WebM, at most 1.5 MiB), or one operational video (MP4/WebM, at most 6 MiB), with declared type checked against the actual content; video remains Order-scoped private media subject to the same authorization, idempotency and lifecycle restrictions as other attachments;
- message attachments are stored as private DSH data, without public object URLs; every retrieval checks the same order, current participant and per-message recipients; operations require explicit authorization;
- a message and its attachment are inserted atomically, and retries preserve the original idempotency key, media content and recipients;
- recording or playback requiring a new native mobile module is activated only on a compatible Android/iOS development build, without blocking text and photo chat on older builds;
- messages cannot mutate Order/payment/custody truth;
- notification delivery is a projection of message/owner events, not message authority;
- when the Order reaches DELIVERED, PICKED_UP, REJECTED or CANCELLED, DSH immediately prevents any new message; prior committed idempotent messages may be replayed without a fresh write; the recorded conversation remains readable to authorized actors;
- rating submission does not control conversation closure;
- deletion/redaction, where legally admitted, preserves required audit meaning.

## Failure and recovery

Offline send, duplicate retry, attachment failure, participant-role change, unread/read retry and notification-delivery failure preserve one DSH message/read-state truth.
