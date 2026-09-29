"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Wallet, X } from "lucide-react";

export function SignInDialog({
  open,
  busy,
  notice,
  onClose,
  onConnect,
}: {
  open: boolean;
  busy: boolean;
  notice: string;
  onClose: () => void;
  onConnect: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sign-in-dialog"
      aria-labelledby="sign-in-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <button
        className="dialog-close icon-button"
        aria-label="Close sign-in"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="signin-icon">
        <Wallet size={26} />
      </div>
      <p className="eyebrow">A PLACE FOR YOUR PLANS</p>
      <h2 id="sign-in-title">Let's get you signed in.</h2>
      <p>
        This prototype uses MetaMask as your account. It lets you return to your
        plans and approve your own share later.
      </p>
      <ol className="signin-steps">
        <li>Open MetaMask and choose your account.</li>
        <li>Sign a message to confirm it's you.</li>
        <li>Create a plan or join your friends.</li>
      </ol>
      <p className="flow-note">
        Signing in does not send money or approve a payment.
      </p>
      <button className="primary" disabled={busy} onClick={onConnect}>
        {busy ? "Check MetaMask…" : "Continue with MetaMask"}
        <ArrowRight size={18} />
      </button>
      <p role="status" aria-live="polite" className="signin-notice">
        {notice}
      </p>
      <details>
        <summary>New to wallets?</summary>
        <p>
          A wallet is an app that identifies your account. You'll need the
          MetaMask browser extension for this prototype. You can also{" "}
          <a href="/demo">try the demo</a> without signing in.
        </p>
      </details>
    </dialog>
  );
}
