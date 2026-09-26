"use client";

import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { ProgressBar } from "primereact/progressbar";
import { Message } from "primereact/message";
import {
  PROVIDERS,
  PROVIDER_KINDS,
  PROCESSING_STEPS,
  randomChallenge,
} from "./providers";
import { formatTaka } from "@/lib/booking";
import "./gateway.css";

/**
 * A simulated gateway checkout, for paying by anything other than the wallet.
 *
 * It exists to make a point as much as to fill a gap. Paying from the wallet is
 * one button; this is four screens, a PIN, a security question and a progress
 * bar — which is about what a real gateway costs a passenger in attention. The
 * contrast is the argument for keeping credit in the wallet, and it is far more
 * convincing felt than explained.
 *
 * Nothing here is real. No value is validated, no credential leaves the
 * browser, and the banner says so on every screen — a fake checkout that looked
 * serious would be a phishing rehearsal.
 *
 * `onAuthorised` hands back a token for the API's simulated gateway, which is
 * where the actual money movement is pretended.
 */

const STEPS = ["choose", "credentials", "challenge", "processing"];

export default function FakeGatewayDialog({
  visible,
  amountMinor,
  purpose = "payment",
  onCancel,
  onAuthorised,
}) {
  const [step, setStep] = useState("choose");
  const [kind, setKind] = useState("mfs");
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [secret, setSecret] = useState("");
  const [challenge, setChallenge] = useState(randomChallenge());
  const [answer, setAnswer] = useState("");
  const [declineIt, setDeclineIt] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState(PROCESSING_STEPS[0]);

  useEffect(() => {
    if (!visible) return;
    setStep("choose");
    setKind("mfs");
    setProvider(null);
    setAccount("");
    setSecret("");
    setAnswer("");
    setDeclineIt(false);
    setProgress(0);
    setChallenge(randomChallenge());
  }, [visible]);

  // The theatre. Long enough to notice, short enough not to annoy.
  useEffect(() => {
    if (step !== "processing") return;

    let done = 0;
    const timer = setInterval(() => {
      done += 1;
      setProgress(Math.min(100, done * 20));
      setStatus(PROCESSING_STEPS[Math.min(done, PROCESSING_STEPS.length - 1)]);

      if (done >= 5) {
        clearInterval(timer);
        // "fail" is the token the API's simulated gateway declines on, so the
        // unhappy path is reachable deliberately rather than only by accident.
        onAuthorised(declineIt ? "fail" : `${provider.id}-${Date.now().toString(36)}`);
      }
    }, 420);

    return () => clearInterval(timer);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = PROVIDERS.filter((p) => p.kind === kind);
  const canContinue =
    step === "credentials" ? account.trim() && secret.trim() : step === "challenge" ? answer.trim() : true;

  return (
    <Dialog
      header={`Pay ${formatTaka(amountMinor)}`}
      visible={visible}
      onHide={step === "processing" ? () => {} : onCancel}
      className="gateway-dialog"
      dismissableMask={step !== "processing"}
      draggable={false}
      closable={step !== "processing"}
    >
      <div className="gateway-banner">
        <i className="pi pi-info-circle" aria-hidden="true" />
        <span>
          Simulated checkout. Every provider below is invented, nothing you type is sent anywhere,
          and no real money moves.
        </span>
      </div>

      <ol className="gateway-steps" aria-label="Checkout progress">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={
              STEPS.indexOf(step) === i ? "is-current" : STEPS.indexOf(step) > i ? "is-done" : ""
            }
          >
            <span>{i + 1}</span>
          </li>
        ))}
      </ol>

      {step === "choose" && (
        <>
          <div className="gateway-kinds">
            {PROVIDER_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={`gateway-kind${kind === k.key ? " is-chosen" : ""}`}
                onClick={() => setKind(k.key)}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="gateway-providers">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                className="gateway-provider"
                style={{ "--brand": p.colour }}
                onClick={() => {
                  setProvider(p);
                  setStep("credentials");
                }}
              >
                <span className="gateway-provider__logo" aria-hidden="true">
                  {p.emoji}
                </span>
                <span className="gateway-provider__body">
                  <strong>{p.name}</strong>
                  <small>{p.tagline}</small>
                </span>
                <i className="pi pi-angle-right" aria-hidden="true" />
              </button>
            ))}
          </div>
        </>
      )}

      {step === "credentials" && provider && (
        <>
          <ProviderHeader provider={provider} />

          <div className="gateway-fields">
            <div className="passenger-field">
              <label htmlFor="gw-account">{provider.field.label}</label>
              <InputText
                id="gw-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={provider.field.placeholder}
                inputMode={provider.field.mode}
                autoComplete="off"
              />
            </div>

            <div className="passenger-field">
              <label htmlFor="gw-secret">{provider.secret.label}</label>
              <InputText
                id="gw-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={provider.secret.placeholder}
                autoComplete="off"
              />
            </div>
          </div>

          <p className="gateway-hint">
            Anything you type is accepted. This is a simulation, and it is not being fussy.
          </p>
        </>
      )}

      {step === "challenge" && provider && (
        <>
          <ProviderHeader provider={provider} />

          <div className="gateway-challenge">
            <span className="gateway-challenge__label">Security question</span>
            <p className="gateway-challenge__question">{challenge}</p>

            <InputText
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Any answer at all"
              className="gateway-challenge__answer"
              autoComplete="off"
            />

            <Button
              label="Ask me something else"
              icon="pi pi-refresh"
              text
              size="small"
              onClick={() => setChallenge(randomChallenge())}
            />
          </div>

          <label className="gateway-decline">
            <Checkbox
              inputId="decline"
              checked={declineIt}
              onChange={(e) => setDeclineIt(e.checked)}
            />
            <span>
              Decline this payment — for trying the unhappy path on purpose
            </span>
          </label>
        </>
      )}

      {step === "processing" && provider && (
        <div className="gateway-processing">
          <span className="gateway-processing__logo" style={{ "--brand": provider.colour }}>
            {provider.emoji}
          </span>
          <strong>{provider.name}</strong>
          <ProgressBar value={progress} showValue={false} style={{ height: 8, width: "100%" }} />
          <p className="gateway-processing__status">{status}</p>
          {declineIt && (
            <Message
              severity="warn"
              text="This one is set to decline. Your seats stay held so you can try again."
              className="book-message"
            />
          )}
        </div>
      )}

      {step !== "processing" && (
        <div className="return-actions">
          {step !== "choose" && (
            <Button
              label="Back"
              icon="pi pi-angle-left"
              text
              onClick={() => setStep(step === "challenge" ? "credentials" : "choose")}
            />
          )}
          <span className="return-actions__spacer" />
          <Button label="Cancel" text onClick={onCancel} />
          {step !== "choose" && (
            <Button
              label={step === "challenge" ? `Pay ${formatTaka(amountMinor)}` : "Continue"}
              icon="pi pi-angle-right"
              iconPos="right"
              disabled={!canContinue}
              onClick={() => setStep(step === "credentials" ? "challenge" : "processing")}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}

function ProviderHeader({ provider }) {
  return (
    <div className="gateway-chosen" style={{ "--brand": provider.colour }}>
      <span className="gateway-chosen__logo" aria-hidden="true">
        {provider.emoji}
      </span>
      <span>
        <strong>{provider.name}</strong>
        <small>{provider.tagline}</small>
      </span>
    </div>
  );
}
