"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import DataTable from "@/components/ui/DataTable";
import { Column } from "primereact/column";
import { ProgressSpinner } from "primereact/progressspinner";
import Link from "next/link";
import { InputText } from "primereact/inputtext";
import { Dialog } from "primereact/dialog";
import { Message } from "primereact/message";
import {
  fetchWallet,
  fetchWalletTransactions,
  topUpWallet,
  verifyWallet,
  formatTaka,
  TRANSACTION_LABELS,
} from "@/lib/booking";
import { requestWithdrawal } from "@/lib/postSale";
import FakeGatewayDialog from "@/components/payment/FakeGatewayDialog";
import "@/components/postsale/postsale.css";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSIONS } from "@/constants/permissions";
import "./wallet.css";

import { TIP } from "@/components/ui/tip";
const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export default function WalletPage() {
  const { hasPermission } = useAuth();
  const toast = useRef(null);

  const [wallet, setWallet] = useState(null);
  const [history, setHistory] = useState({ transactions: [], pagination: null });
  const [page, setPage] = useState(1);
  const [amount, setAmount] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawal, setWithdrawal] = useState({ amount: 0, destination: "", reason: "" });
  const [sending, setSending] = useState(false);
  const [payingIn, setPayingIn] = useState(false);

  const canUse = hasPermission(PERMISSIONS.BOOKING_CREATE);

  const load = useCallback(async () => {
    try {
      const [w, h] = await Promise.all([fetchWallet(), fetchWalletTransactions({ page })]);
      setWallet(w);
      setHistory(h);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * Money entering the wallet comes through the gateway, the same as money
   * entering a booking does. Only money *leaving* the wallet is one click —
   * which is the whole argument for keeping credit in it, and is far more
   * convincing after you have been through this four-screen checkout once.
   */
  const topUp = () => setPayingIn(true);

  const completeTopUp = async () => {
    setPayingIn(false);
    setBusy(true);
    try {
      const result = await topUpWallet(amount);
      toast.current?.show({ severity: "success", summary: "Added", detail: result.message });
      setPage(1);
      await load();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Could not add credit", detail: err.message });
    } finally {
      setBusy(false);
    }
  };

  const submitWithdrawal = async () => {
    setSending(true);
    try {
      const result = await requestWithdrawal({
        amount: withdrawal.amount,
        destination: withdrawal.destination.trim(),
        reason: withdrawal.reason.trim() || undefined,
      });
      setWithdrawing(false);
      setWithdrawal({ amount: 0, destination: "", reason: "" });
      toast.current?.show({
        severity: "info",
        summary: "Waiting for approval",
        detail: result.message,
        life: 7000,
      });
      await load();
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Could not request it",
        detail: err.message,
        life: 7000,
      });
    } finally {
      setSending(false);
    }
  };

  /** Proves the balance shown is the sum of every entry behind it. */
  const check = async () => {
    try {
      const result = await verifyWallet();
      setLedger(result);
      toast.current?.show({
        severity: result.consistent ? "success" : "error",
        summary: result.consistent ? "Ledger balances" : "Ledger does not balance",
        detail: result.consistent
          ? `${result.entries} entries add up to ${result.cached}`
          : `Entries total ${result.ledger} but the balance reads ${result.cached}`,
        life: 6000,
      });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.message });
    }
  };

  if (!canUse) {
    return (
      <div className="card">
        <h1 className="page-title">Wallet</h1>
        <p className="page-subtitle">
          Your account cannot buy tickets, so it has no wallet.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="wallet-loading">
        <ProgressSpinner style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <div>
      <Toast ref={toast} />

      <h1 className="page-title">Wallet</h1>
      <p className="page-subtitle">
        Credit you hold for one-click payment. Every movement is recorded, and nothing is ever
        edited after the fact.
      </p>

      <div className="wallet-grid">
        <section className="wallet-balance">
          <span className="wallet-balance__label">Available balance</span>
          <strong className="wallet-balance__figure">৳ {wallet?.balanceFormatted}</strong>
          {wallet?.status === "frozen" && (
            <Tag severity="danger" value="Frozen — this wallet cannot be spent from" />
          )}
          <Button
            label="Check the ledger"
            icon="pi pi-verified"
            text
            size="small"
            onClick={check}
            className="wallet-balance__verify"
            tooltip="Re-adds every entry and compares it to the balance above"
            tooltipOptions={{ ...TIP, position: "bottom" }}
          />
          <Button
            label="Withdraw"
            icon="pi pi-arrow-up-right"
            text
            size="small"
            onClick={() => setWithdrawing(true)}
            className="wallet-balance__verify"
            disabled={!wallet?.balanceMinor}
            tooltip={
              wallet?.balanceMinor
                ? "Take credit out — needs approval"
                : "Nothing to withdraw"
            }
            tooltipOptions={{ ...TIP, position: "bottom" }}
          />
          {ledger && (
            <p className={`wallet-ledger ${ledger.consistent ? "is-ok" : "is-bad"}`}>
              {ledger.consistent
                ? `${ledger.entries} entries add up to ${ledger.cached}.`
                : `Mismatch: entries total ${ledger.ledger}, balance reads ${ledger.cached}.`}
            </p>
          )}
        </section>

        <section className="wallet-topup">
          <h2>Add credit</h2>
          <div className="wallet-topup__quick">
            {QUICK_AMOUNTS.map((value) => (
              <Button
                key={value}
                label={`৳ ${value.toLocaleString()}`}
                outlined={amount !== value}
                size="small"
                onClick={() => setAmount(value)}
              />
            ))}
          </div>

          <div className="wallet-topup__row">
            <InputNumber
              value={amount}
              onValueChange={(e) => setAmount(e.value ?? 0)}
              mode="decimal"
              minFractionDigits={0}
              maxFractionDigits={2}
              min={0}
              prefix="৳ "
              inputStyle={{ width: "100%" }}
              className="wallet-topup__input"
            />
            <Button
              label="Add"
              icon="pi pi-plus"
              onClick={topUp}
              loading={busy}
              disabled={!amount || amount <= 0}
            />
          </div>
          <p className="wallet-hint">
            The payment gateway is simulated in this build. The ledger behind it is not.
          </p>

          <FakeGatewayDialog
            visible={payingIn}
            amountMinor={Math.round((amount || 0) * 100)}
            purpose="top-up"
            onCancel={() => setPayingIn(false)}
            onAuthorised={completeTopUp}
          />
        </section>
      </div>

      <Dialog
        header="Withdraw credit"
        visible={withdrawing}
        onHide={() => (sending ? null : setWithdrawing(false))}
        className="transfer-dialog"
        dismissableMask={!sending}
        draggable={false}
      >
        <p className="transfer-current">
          Available to withdraw: <strong>৳ {wallet?.balanceFormatted}</strong>
        </p>

        <div className="passenger-fields transfer-fields">
          <div className="passenger-field">
            <label htmlFor="withdraw-amount">Amount</label>
            <InputNumber
              inputId="withdraw-amount"
              value={withdrawal.amount}
              onValueChange={(e) => setWithdrawal((w) => ({ ...w, amount: e.value ?? 0 }))}
              mode="decimal"
              minFractionDigits={0}
              maxFractionDigits={2}
              min={0}
              max={(wallet?.balanceMinor || 0) / 100}
              prefix="৳ "
              inputStyle={{ width: "100%" }}
            />
          </div>

          <div className="passenger-field">
            <label htmlFor="withdraw-to">Send it to</label>
            <InputText
              id="withdraw-to"
              value={withdrawal.destination}
              onChange={(e) => setWithdrawal((w) => ({ ...w, destination: e.target.value }))}
              placeholder="Account or mobile number"
            />
          </div>
        </div>

        <div className="passenger-field transfer-reason">
          <label htmlFor="withdraw-reason">Why? (optional)</label>
          <InputText
            id="withdraw-reason"
            value={withdrawal.reason}
            onChange={(e) => setWithdrawal((w) => ({ ...w, reason: e.target.value }))}
            placeholder="Shown to whoever reviews this"
          />
        </div>

        <Message
          severity="info"
          className="book-message"
          text="Withdrawals are the only way money leaves, so each one is checked by a person. Nothing is debited until it is approved."
        />

        <div className="return-actions">
          <Link href="/dashboard/requests" className="wallet-requests-link">
            <Button label="My requests" icon="pi pi-inbox" text size="small" />
          </Link>
          <span className="return-actions__spacer" />
          <Button label="Cancel" text onClick={() => setWithdrawing(false)} disabled={sending} />
          <Button
            label="Request withdrawal"
            icon="pi pi-send"
            onClick={submitWithdrawal}
            loading={sending}
            disabled={
              !withdrawal.amount ||
              withdrawal.amount <= 0 ||
              withdrawal.amount > (wallet?.balanceMinor || 0) / 100 ||
              withdrawal.destination.trim().length < 4
            }
          />
        </div>
      </Dialog>

      <section className="wallet-history">
        <h2>History</h2>
        <DataTable
          value={history.transactions}
          emptyMessage="Nothing yet — add credit or buy a ticket and it will appear here."
          size="small"
          stripedRows
          paginator={history.pagination?.pages > 1}
          rows={history.pagination?.limit || 25}
          totalRecords={history.pagination?.total || 0}
          lazy
          first={((history.pagination?.page || 1) - 1) * (history.pagination?.limit || 25)}
          onPage={(e) => setPage(Math.floor(e.first / e.rows) + 1)}
        >
          <Column
            header="When"
            body={(row) =>
              new Date(row.createdAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Dhaka",
              })
            }
          />
          <Column
            header="What"
            body={(row) => (
              <div className="wallet-what">
                <span>{TRANSACTION_LABELS[row.reason] || row.reason}</span>
                {row.description && <small>{row.description}</small>}
              </div>
            )}
          />
          <Column
            header="Amount"
            align="right"
            body={(row) => (
              <span className={row.direction === "credit" ? "amount-in" : "amount-out"}>
                {row.direction === "credit" ? "+" : "−"} {formatTaka(row.amountMinor)}
              </span>
            )}
          />
          <Column
            header="Balance after"
            align="right"
            body={(row) => formatTaka(row.balanceAfterMinor)}
          />
        </DataTable>
      </section>
    </div>
  );
}
