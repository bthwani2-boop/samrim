"use client";

import { Button, Modal } from "antd";
import { useEffect, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { OperatorOrderConversation } from "./operator-order-conversation";

type Props = Readonly<{ orderId: string; reference: string; status: string; summary: string; total: string }>;

export function OperatorOrderChatDialog({ orderId, reference, status, summary, total }: Props) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let live = true;
    setUnreadCount(0);
    if (open) return () => { live = false; };

    const read = async () => {
      try {
        const response = await identityFetch("/api/operations/" + encodeURIComponent(orderId) + "/conversation", { cache: "no-store" });
        if (!response.ok) return;
        const value = await response.json() as { unreadCount?: number };
        if (live && Number.isSafeInteger(value.unreadCount) && Number(value.unreadCount) >= 0) {
          setUnreadCount(Number(value.unreadCount));
        }
      } catch {
        // Hide the badge when the private read fails.
      }
    };

    void read();
    const poll = setInterval(() => void read(), 20000);
    return () => {
      live = false;
      clearInterval(poll);
    };
  }, [open, orderId]);

  return (
    <>
      <Button
        type="default"
        className="operator-order-chat-trigger"
        aria-label={"محادثة الطلب " + reference}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">💬</span>
        <span>محادثة الطلب</span>
        {unreadCount > 0 ? (
          <span className="operator-order-chat-unread-badge" role="status" aria-label={unreadCount + " رسائل غير مقروءة"}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>
      <Modal
        className="operator-order-chat-modal"
        open={open}
        title={
          <div className="operator-order-chat-heading">
            <div className="operator-order-chat-heading-content">
              <h2>محادثة الطلب #{reference}</h2>
              <span className="muted">{status}</span>
            </div>
            <Button type="default" onClick={() => setOpen(false)}>إغلاق</Button>
          </div>
        }
        footer={null}
        width={620}
        destroyOnHidden
        closable={false}
        keyboard
        maskClosable={false}
        onCancel={() => setOpen(false)}
        getContainer={() => document.getElementById("control-panel-overlay-root") ?? document.body}
      >
        <div className="operator-order-chat-content">
          <div className="operator-order-chat-summary">
            <div className="operator-order-chat-summary-line">
              <span>{summary}</span>
              <strong>{total}</strong>
            </div>
            <Button type="link" className="operator-order-chat-order-link" onClick={() => setOpen(false)}>
              عرض تفاصيل الطلب ←
            </Button>
          </div>
          <div className="operator-order-chat-messages">
            <OperatorOrderConversation orderId={orderId} />
          </div>
        </div>
      </Modal>
    </>
  );
}
