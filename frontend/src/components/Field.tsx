/**
 * Form controls with the accessibility wiring done once (P0 Baseline §13.3).
 *
 * Every control renders a *visible* label (placeholders never substitute for one),
 * associates its hint and error with `aria-describedby`, and sets `aria-invalid` when the
 * value was rejected. Using these instead of raw `<input>`s is what keeps the rules from
 * drifting across the nine pages.
 *
 * All three forward their ref. §13.2 mandates React Hook Form, whose `register()` returns
 * a `ref` callback that is how a field gets registered at all — on React 18 a function
 * component without `forwardRef` silently swallows it, and the field then submits as
 * `undefined` while the DOM still shows what the user typed. That failure is invisible
 * until a test drives a real submit, which is why `src/test/App.test.tsx` does.
 */

import type { ReactNode, Ref } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function FieldShell({ id, label, required, hint, error, children }: FieldShellProps) {
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <>
            {" "}
            <span className="field-required" aria-hidden="true">
              *
            </span>
            <span className="visually-hidden">(required)</span>
          </>
        ) : null}
      </label>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface CommonFieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, CommonFieldProps & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ id, label, required, hint, error, ...rest }, ref: Ref<HTMLInputElement>) {
    return (
      <FieldShell id={id} label={label} required={required} hint={hint} error={error}>
        <input
          id={id}
          ref={ref}
          aria-describedby={describedBy(id, hint, error)}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          {...rest}
        />
      </FieldShell>
    );
  },
);

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  CommonFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextAreaField({ id, label, required, hint, error, ...rest }, ref: Ref<HTMLTextAreaElement>) {
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error}>
      <textarea
        id={id}
        ref={ref}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        {...rest}
      />
    </FieldShell>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  CommonFieldProps & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }
>(function SelectField({ id, label, required, hint, error, children, ...rest }, ref: Ref<HTMLSelectElement>) {
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error}>
      <select
        id={id}
        ref={ref}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

/** Inline error for controls that are not one of the three field types above. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="field-error" role="alert">
      {message}
    </p>
  );
}
