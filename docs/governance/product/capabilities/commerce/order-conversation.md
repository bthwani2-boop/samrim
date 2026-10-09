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
- participants derive from current authorized Order/Store/Captain/customer relations;
- text is the baseline message type; admitted media remains bounded and provider-independent;
- messages cannot mutate Order/payment/custody truth;
- notification delivery is a projection of message/owner events, not message authority;
- after operational completion the conversation follows a versioned governed grace period then becomes read-only;
- rating submission does not control conversation closure;
- deletion/redaction, where legally admitted, preserves required audit meaning.

## Failure and recovery

Offline send, duplicate retry, attachment failure, participant-role change, unread/read retry and notification-delivery failure preserve one DSH message/read-state truth.
