"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import { fetchStanding, holdAccount, releaseAccount } from "@/lib/checking";

/**
 * Everything known about one account, and the two decisions available.
 *
 * Shared between the review queue and the user directory, because the question
 * is the same from both: is there a pattern here, and does it warrant stopping
 * this person buying. Reaching it only through a report — which is how this
 * started — meant an account nobody happened to report could not be looked at
 * at all.
 *
 * ## The score is shown as arithmetic, the travel as context
 *
 * Two upheld reports mean something different against a daily commuter of three
 * years than against an account that has bought six tickets and returned five.
 * The score cannot express that and should not try: weighting misconduct by
 * loyalty is how you end up policing infrequent travellers hardest. So the
 * travel summary sits beside the score, clearly separate, and the reviewer
 * holds both in mind rather than the system pretending to.
 */
export default function StandingDialog({ userId, name, onHide, onChanged }) {
  const { hasPermission } = useAuth();
  const toast = useRef(null);
  const canHold = hasPermission(PERMISSIONS.ACCOUNT_HOLD);

  const [standing, setStanding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [holding, setHolding] = useState(false);
  const [detail, setDetail] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setStanding(await fetchStanding(userId));
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not load", detail: err.message, life: 6000 });
      setStanding(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const place = async () => {
    try {
      await holdAccount(userId, { detail: detail.trim() });
      setHolding(false);
      setDetail("");
      await load();
      onChanged?.();
      toast.current?.show({ severity: "success", summary: "Account held", life: 5000 });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not held", detail: err.message, life: 6000 });
    }
  };

  const lift = async () => {
    try {
      await releaseAccount(userId, { note: note.trim() });
      setReleasing(false);
      setNote("");
      await load();
      onChanged?.();
      toast.current?.show({ severity: "success", summary: "Hold lifted", life: 5000 });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Not lifted", detail: err.message, life: 6000 });
    }
  };

  const travel = standing?.travel;

  return (
    <>
      <Toast ref={toast} />

      <Dialog
        header={name ? `${name} — standing` : "Account standing"}
        visible={Boolean(userId)}
        onHide={onHide}
        style={{ width: "min(680px, 94vw)" }}
        dismissableMask
      >
        {loading ? (
          <p>Loading…</p>
        ) : !standing ? (
          <p>Nothing to show.</p>
        ) : (
          <>
            <div className="standing__head">
              <div>
                <span className="standing__total">{standing.score?.total}</span>
                <small>of {standing.score?.threshold} before an automatic hold</small>
              </div>
              {standing.held ? (
                <Tag severity="danger" icon="pi pi-lock" value="Cannot book" />
              ) : (
                <Tag severity="success" icon="pi pi-check" value="Can book" />
              )}
            </div>

            <p className="standing__window">
              Signals from the last {standing.score?.windowDays} days. Older ones have aged out.
            </p>

            {/* ---------------- What they have actually done ---------------- */}

            {travel && (
              <section className="standing__travel">
                <h3 className="standing__heading">
                  Travel over the same {travel.windowDays} days
                </h3>
                <p className="standing__context">
                  Context for the score, not part of it — two reports mean something different
                  against a regular traveller than against a new account.
                </p>

                <div className="standing__stats">
                  <div>
                    <strong>{travel.bought}</strong>
                    <span>Tickets bought</span>
                  </div>
                  <div className="is-good">
                    <strong>{travel.travelled}</strong>
                    <span>Travelled on</span>
                  </div>
                  <div>
                    <strong>{travel.returned}</strong>
                    <span>Returned</span>
                  </div>
                  <div className={travel.unscanned > 0 ? "is-watch" : ""}>
                    <strong>{travel.unscanned}</strong>
                    {/* Only trains that have gone; a future booking is not a no-show. */}
                    <span>Never scanned</span>
                  </div>
                  <div>
                    <strong>{travel.upcoming}</strong>
                    <span>Still to travel</span>
                  </div>
                  <div className={travel.returnRate >= 70 ? "is-watch" : ""}>
                    <strong>{travel.returnRate}%</strong>
                    <span>Return rate</span>
                  </div>
                </div>

                <dl className="standing__money">
                  <div>
                    <dt>Spent</dt>
                    <dd>৳ {travel.spentFormatted}</dd>
                  </div>
                  <div>
                    <dt>Refunded</dt>
                    <dd>৳ {travel.refundedFormatted}</dd>
                  </div>
                  <div>
                    <dt>Net</dt>
                    <dd>৳ {travel.netFormatted}</dd>
                  </div>
                </dl>
              </section>
            )}

            {/* ---------------- The arithmetic ---------------- */}

            <h3 className="standing__heading">How the score is made up</h3>
            <div className="standing__scroll">
              <table className="standing__parts">
                <thead>
                  <tr>
                    <th>Signal</th>
                    <th>Count</th>
                    <th>Weight</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {(standing.score?.parts || []).map((p) => (
                    <tr key={p.signal} className={p.points > 0 ? "is-counting" : ""}>
                      <td>
                        {p.signal}
                        <small>{p.note}</small>
                      </td>
                      <td>{p.count}</td>
                      <td>{p.weight}</td>
                      <td>
                        <strong>{p.points}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(standing.reports || []).length > 0 && (
              <>
                <h3 className="standing__heading">Reports against this account</h3>
                <ul className="standing__reports">
                  {standing.reports.slice(0, 8).map((r) => (
                    <li key={r.reference}>
                      <Tag
                        severity={
                          r.status === "upheld" ? "danger" : r.status === "open" ? "warning" : "secondary"
                        }
                        value={r.status}
                      />
                      <span>{r.detail}</span>
                      <small>{new Date(r.reportedAt).toLocaleDateString("en-GB")}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {(standing.holds || []).length > 0 && (
              <>
                <h3 className="standing__heading">Hold history</h3>
                <ul className="standing__holds">
                  {standing.holds.map((h) => (
                    <li key={h.id}>
                      <strong>{h.active ? "Active" : "Lifted"}</strong>
                      <span>{h.detail}</span>
                      <small>
                        {h.automatic ? "automatic" : `by ${h.placedBy || "staff"}`}
                        {h.releaseNote && ` · lifted: ${h.releaseNote}`}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {canHold && (
              <div className="standing__actions">
                {standing.held ? (
                  <Button
                    label="Lift the hold"
                    icon="pi pi-unlock"
                    severity="secondary"
                    onClick={() => setReleasing(true)}
                  />
                ) : (
                  <Button
                    label="Stop this account booking"
                    icon="pi pi-lock"
                    severity="danger"
                    outlined
                    onClick={() => setHolding(true)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </Dialog>

      <Dialog
        header="Stop this account booking?"
        visible={holding}
        onHide={() => setHolding(false)}
        style={{ width: "min(520px, 94vw)" }}
        dismissableMask
      >
        <p className="reports__lead">
          This stops new bookings and nothing else. Existing tickets stay valid and can still be
          travelled on. It can be lifted at any time.
        </p>
        <label className="reports__field">
          <span>Why? The account holder reads this.</span>
          <InputTextarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            autoResize
            placeholder="Held while a series of identity mismatches is investigated."
          />
        </label>
        <div className="reports__actions">
          <Button label="Cancel" text severity="secondary" onClick={() => setHolding(false)} />
          <Button
            label="Hold the account"
            icon="pi pi-lock"
            severity="danger"
            disabled={detail.trim().length < 10}
            onClick={place}
          />
        </div>
      </Dialog>

      <Dialog
        header="Lift this hold?"
        visible={releasing}
        onHide={() => setReleasing(false)}
        style={{ width: "min(520px, 94vw)" }}
        dismissableMask
      >
        <p className="reports__lead">This lets the account buy again immediately.</p>
        <label className="reports__field">
          <span>Why is it being lifted?</span>
          <InputTextarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoResize
            placeholder="Reviewed the footage; the checker was mistaken."
          />
        </label>
        <div className="reports__actions">
          <Button label="Cancel" text severity="secondary" onClick={() => setReleasing(false)} />
          <Button
            label="Lift it"
            icon="pi pi-unlock"
            disabled={note.trim().length < 5}
            onClick={lift}
          />
        </div>
      </Dialog>
    </>
  );
}
