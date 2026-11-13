/**
 * Public comments and admin-only notes (#54, P0 §5.4).
 *
 * The composer exists only when the server's `allowed_actions` says the viewer
 * may comment; a terminal ticket therefore renders a read-only notice and keeps
 * its history in the timeline above. The admin-only option is gated by the
 * server's `COMMENT_ADMIN_ONLY` token, not by a client-side role check.
 */

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api, type TicketDetail, type Visibility } from "../../api";
import { SelectField, TextAreaField } from "../../components/Field";
import { useToast } from "../../hooks/useToast";
import { classify } from "../../lib/errors";
import { VISIBILITY_LABELS, isTerminal } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";
import { currentSessionVersion } from "../../lib/session";

const commentSchema = z.object({
  body: z.string()
    .min(1, "Enter a comment.")
    .max(2000, "Keep the comment to 2000 characters or fewer."),
  visibility: z.enum(["PUBLIC", "ADMIN_ONLY"]),
});

type CommentValues = z.infer<typeof commentSchema>;

export function CommentComposer({ ticket }: { ticket: TicketDetail }) {
  const client = useQueryClient();
  const { notify } = useToast();
  const [requestError, setRequestError] = useState<string>();
  const [pending, setPending] = useState(false);
  const canComment = ticket.allowed_actions.includes("COMMENT_PUBLIC");
  const canWriteInternal = ticket.allowed_actions.includes("COMMENT_ADMIN_ONLY");

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<CommentValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: "", visibility: "PUBLIC" },
  });
  const visibility = watch("visibility");

  if (!canComment) {
    if (!isTerminal(ticket.status)) return null;
    return (
      <p className="muted" role="status">
        This ticket is read-only in its current status. Existing comments remain
        visible, but new comments cannot be added.
      </p>
    );
  }

  const submit = handleSubmit(async (values) => {
    const issuedIn = currentSessionVersion();
    const chosen: Visibility = canWriteInternal ? values.visibility : "PUBLIC";
    setRequestError(undefined);
    setPending(true);
    try {
      await api.createComment(ticket.id, { body: values.body, visibility: chosen });
      // A late success must not reset the form, toast or invalidate data in a
      // different account's session.
      if (issuedIn !== currentSessionVersion()) return;
      reset({ body: "", visibility: "PUBLIC" });
      notify(chosen === "ADMIN_ONLY" ? "Internal note added." : "Comment added.");
      await client.invalidateQueries({ queryKey: queryKeys.tickets.detail(ticket.id) });
    } catch (failure) {
      if (issuedIn !== currentSessionVersion()) return;
      const error = classify(failure);
      setRequestError(error.message);
      for (const field of ["body", "visibility"] as const) {
        if (error.fields[field]) setError(field, { message: error.fields[field] });
      }
      // §13.3: a terminal-ticket comment conflict shows the server's message and
      // must not refresh the ticket detail. The error stays visible here.
    } finally {
      setPending(false);
    }
  });

  return (
    <form className="composer" onSubmit={submit} noValidate aria-label="Add a comment">
      <h3>Add a comment</h3>
      <TextAreaField
        id="comment-body"
        label="Comment"
        required
        rows={3}
        hint="1–2000 characters. Your text is kept as written."
        error={errors.body?.message}
        disabled={pending}
        {...register("body")}
      />
      {canWriteInternal ? (
        <SelectField
          id="comment-visibility"
          label="Visibility"
          hint={visibility === "ADMIN_ONLY"
            ? "Only administrators can read this note. Reporters and technicians never receive it."
            : "Everyone with access to this ticket can read this comment."}
          error={errors.visibility?.message}
          disabled={pending}
          {...register("visibility")}
        >
          <option value="PUBLIC">{VISIBILITY_LABELS.PUBLIC}</option>
          <option value="ADMIN_ONLY">{VISIBILITY_LABELS.ADMIN_ONLY}</option>
        </SelectField>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={pending}>
          {pending
            ? "Posting…"
            : canWriteInternal && visibility === "ADMIN_ONLY"
              ? "Post internal note"
              : "Post comment"}
        </button>
      </div>
      {requestError ? <p role="alert">{requestError}</p> : null}
    </form>
  );
}
