import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
  pending?: boolean;
  disabled?: boolean;
  danger?: boolean;
  fallbackFocusRef?: RefObject<HTMLElement>;
  children?: ReactNode;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, title, description, onConfirm, onCancel, pending = false, disabled = false, danger = false, confirmLabel = "Confirm", children } = props;
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const busy = pending || submitting;
  const latest = useRef({ busy, onCancel, fallbackFocusRef: props.fallbackFocusRef });
  latest.current = { busy, onCancel, fallbackFocusRef: props.fallbackFocusRef };

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const siblings = [...document.body.children].filter((element) => !element.contains(panel.current));
    const previousInert = siblings.map((element) => element.hasAttribute("inert"));
    siblings.forEach((element) => element.setAttribute("inert", ""));
    cancel.current?.focus();
    const keepFocus = (event: FocusEvent) => {
      if (!panel.current?.contains(event.target as Node)) panel.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!latest.current.busy) latest.current.onCancel(); }
      if (event.key === "Tab") {
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])]
          .filter((element) => !element.hidden && !element.closest("[hidden]"));
        const first = controls[0]; const last = controls.at(-1);
        if (!first) { event.preventDefault(); panel.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", keepFocus);
      siblings.forEach((element, index) => { if (!previousInert[index]) element.removeAttribute("inert"); });
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
      if (!previousFocus || previousFocus === document.body || document.activeElement !== previousFocus) {
        latest.current.fallbackFocusRef?.current?.focus();
      }
    };
  }, [open]);

  useEffect(() => { if (open && busy) panel.current?.focus(); }, [open, busy]);

  async function confirm() {
    if (locked.current || busy || disabled) return;
    locked.current = true; setSubmitting(true); setError(undefined);
    try { await onConfirm(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The action could not be completed."); }
    finally { locked.current = false; setSubmitting(false); }
  }

  if (!open) return null;
  return createPortal(<div className="modal-backdrop">
    <div ref={panel} className={`modal${danger ? " modal-danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} tabIndex={-1}>
      <div className="modal-head"><h2 id={`${id}-title`}>{title}</h2></div>
      <p className="modal-description" id={`${id}-description`}>{description}</p>
      {children && <div className="modal-body">{children}</div>}
      {error && <p role="alert">{error}</p>}
      <div className="modal-footer">
        <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className={danger ? "danger" : "primary"} disabled={busy || disabled} onClick={() => { void confirm(); }}>{busy ? "Submitting…" : confirmLabel}</button>
      </div>
    </div>
  </div>, document.body);
}
