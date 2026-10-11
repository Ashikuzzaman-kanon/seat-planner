"use client";

import { Button } from "primereact/button";
import { tip } from "@/components/ui/tip";
import { categoryMeta, timeAgo } from "@/lib/notifications";

/**
 * One notification, as the bell's panel and the full page both show it.
 *
 * The whole row opens it — goes where it points and counts it as read. Read /
 * unread and dismiss sit to the side: always visible on the page and on a
 * touch screen, on hover or focus in the compact panel, where they would
 * otherwise crowd every row.
 */
export default function NotificationItem({ n, compact = false, onOpen, onToggleRead, onDismiss }) {
  const meta = categoryMeta(n.category);
  const at = new Date(n.createdAt);

  return (
    <li className={`notif-item tone-${n.tone}${n.read ? "" : " is-unread"}${compact ? " is-compact" : ""}`}>
      <button type="button" className="notif-item__main" onClick={() => onOpen(n)}>
        <span className="notif-item__icon" aria-hidden="true">
          <i className={meta.icon} />
        </span>
        <span className="notif-item__text">
          <span className="notif-item__title">{n.title}</span>
          {n.body && <span className="notif-item__body">{n.body}</span>}
          <span className="notif-item__meta">
            <time dateTime={at.toISOString()} title={at.toLocaleString("en-GB")}>
              {timeAgo(at)}
            </time>
            {!compact && <span className="notif-item__category">{meta.label}</span>}
          </span>
        </span>
        {!n.read && <span className="notif-item__dot" aria-label="Unread" />}
      </button>

      <span className="notif-item__actions">
        <Button
          icon={n.read ? "pi pi-envelope" : "pi pi-check"}
          rounded
          text
          size="small"
          onClick={() => onToggleRead(n)}
          {...tip(n.read ? "Mark as unread" : "Mark as read")}
        />
        <Button icon="pi pi-times" rounded text size="small" severity="secondary" onClick={() => onDismiss(n)} {...tip("Dismiss")} />
      </span>
    </li>
  );
}
