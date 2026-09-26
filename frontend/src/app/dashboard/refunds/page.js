"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { Checkbox } from "primereact/checkbox";
import { Paginator } from "primereact/paginator";
import { ProgressBar } from "primereact/progressbar";
import { ProgressSpinner } from "primereact/progressspinner";
import {
  fetchRefunds,
  REFUND_STATUS_LABELS,
  REFUND_STATUS_SEVERITY,
  REFUND_TYPE_LABELS,
} from "@/lib/postSale";
import { formatTaka } from "@/lib/booking";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "@/components/booking/booking.css";
import "@/components/postsale/postsale.css";

/**
 * Tickets given back, and what each one has paid.
 *
 * A demand-based return is the reason this screen needs to exist at all: it can
 * sit open for days, paying out segment by segment as the seat resells, and a
 * passenger has no other way to see how far along it is. A convenient return is
 * a single settled line and needs no watching.
 */
export default function RefundsPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [all, setAll] = useState(false);
  const [loading, setLoading] = useState(true);

  const canReturn = hasPermission(PERMISSIONS.REFUND_REQUEST);
  const canViewAll = hasPermission(PERMISSIONS.REFUND_VIEW_ALL);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchRefunds({ page, all }));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [page, all]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canReturn && !canViewAll) {
    return (
      <div className="card">
        <h1 className="page-title">My returns</h1>
        <p className="page-subtitle">Your account cannot view returns.</p>
      </div>
    );
  }

  const refunds = data?.refunds || [];

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">{all ? "All returns" : "My returns"}</h1>
      <p className="page-subtitle">
        A demand-based return pays as each segment of the seat resells, so it can stay open for
        a while. A convenient return pays once, straight away.
      </p>

      {canViewAll && (
        <div className="card bookings-toolbar">
          <label className="bookings-toggle">
            <Checkbox
              inputId="all"
              checked={all}
              onChange={(e) => {
                setAll(e.checked);
                setPage(1);
              }}
            />
            <span>Everyone&apos;s returns</span>
          </label>
        </div>
      )}

      {loading ? (
        <div className="book-centre">
          <ProgressSpinner style={{ width: 36, height: 36 }} />
        </div>
      ) : refunds.length === 0 ? (
        <div className="card bookings-empty">
          <i className="pi pi-undo" aria-hidden="true" />
          <p>{all ? "Nothing has been returned yet." : "You have not returned any tickets."}</p>
          <Link href="/dashboard/bookings">
            <Button label="My bookings" icon="pi pi-arrow-right" iconPos="right" outlined />
          </Link>
        </div>
      ) : (
        <div className="bookings-list">
          {refunds.map((refund) => (
            <RefundRow key={refund.id} refund={refund} />
          ))}
        </div>
      )}

      {data?.pagination?.pages > 1 && (
        <Paginator
          first={(data.pagination.page - 1) * data.pagination.limit}
          rows={data.pagination.limit}
          totalRecords={data.pagination.total}
          onPageChange={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
        />
      )}
    </div>
  );
}

function RefundRow({ refund }) {
  const settledSegments = (refund.segments || []).filter((s) => s.isResold).length;
  const totalSegments = (refund.segments || []).length;
  const paidRatio = refund.maximumMinor > 0 ? (refund.refundedMinor / refund.maximumMinor) * 100 : 100;

  return (
    <article className="card booking-row">
      <div className="booking-row__head">
        <div>
          <span className="booking-ref">{refund.reference}</span>
          <h3>{REFUND_TYPE_LABELS[refund.type] || refund.type}</h3>
          <p className="booking-journey">
            Ticket {refund.ticket?.ticketNumber || refund.ticketId}
            {refund.ticket?.seatNumber && <span>seat {refund.ticket.seatNumber}</span>}
            <span className="booking-date">
              {new Date(refund.requestedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Dhaka",
              })}
            </span>
          </p>
        </div>

        <div className="booking-row__meta">
          <Tag
            value={REFUND_STATUS_LABELS[refund.status] || refund.status}
            severity={REFUND_STATUS_SEVERITY[refund.status] || "info"}
          />
          <strong>৳ {refund.refundedFormatted}</strong>
          {refund.maximumMinor !== refund.refundedMinor && (
            <small className="refund-ceiling">of up to ৳ {refund.maximumFormatted}</small>
          )}
        </div>
      </div>

      {totalSegments > 0 && (
        <div className="refund-progress">
          <div className="refund-progress__head">
            <span>
              {settledSegments} of {totalSegments} segment{totalSegments === 1 ? "" : "s"} resold
            </span>
            <span>{Math.round(paidRatio)}%</span>
          </div>
          <ProgressBar value={paidRatio} showValue={false} style={{ height: 6 }} />

          <ul className="refund-segments">
            {refund.segments.map((segment) => (
              <li key={segment.id} className={segment.isResold ? "is-resold" : ""}>
                <i
                  className={segment.isResold ? "pi pi-check-circle" : "pi pi-clock"}
                  aria-hidden="true"
                />
                <span>Segment {segment.segmentIndex + 1}</span>
                <strong>{formatTaka(segment.refundMinor)}</strong>
                <small>{segment.isResold ? "resold" : "waiting"}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {refund.note && <p className="refund-note">{refund.note}</p>}

      {refund.status === "closed" && (
        <p className="refund-note refund-note--muted">
          The train has departed, so the segments that never resold will not pay.
        </p>
      )}
    </article>
  );
}
