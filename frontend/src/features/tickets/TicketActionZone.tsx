/**
 * Ticket operation area (#91).
 *
 * The server owns the permission matrix: `allowed_actions` is computed from the
 * viewer, the ticket relationship and the current status. This component renders
 * exactly the lifecycle actions in that list — it never derives a capability from
 * role, status or ownership, and an action that is not allowed is absent rather
 * than rendered disabled.
 *
 * COMMENT_* tokens belong to the conversation composer (#54), not to this zone.
 * They are classified separately below so a new contract action fails the build
 * here instead of silently disappearing from the UI.
 */

import { useRef, useState } from "react";
import type { RefObject } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "../../api";
import type { Category, Priority, TicketAction, TicketDetail } from "../../api";
import { ConfirmDialog } from "../../components";
import { SelectField, TextAreaField } from "../../components/Field";
import { useToast } from "../../hooks/useToast";
import { classify } from "../../lib/errors";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
} from "../../lib/labels";
import { queryKeys, ticketActionMeta } from "../../lib/queryClient";

const COMMENT_ACTIONS = ["COMMENT_PUBLIC", "COMMENT_ADMIN_ONLY"] as const;
type CommentAction = (typeof COMMENT_ACTIONS)[number];

/** Workflow actions shown in the operation area; comments live with #54. */
export type LifecycleAction = Exclude<TicketAction, CommentAction>;

export const LIFECYCLE_ACTIONS = [
  "REVIEW",
  "ASSIGN",
  "START",
  "RESOLVE",
  "CONFIRM",
  "REWORK",
  "CANCEL",
] as const satisfies readonly LifecycleAction[];

// Compile-time census: a contract action added by #46 must be classified here.
type ClassifiedAction = (typeof LIFECYCLE_ACTIONS)[number] | CommentAction;
const _everyActionIsClassified: Exclude<TicketAction, ClassifiedAction> extends never ? true : never = true;
void _everyActionIsClassified;

const DANGER_ACTIONS: readonly LifecycleAction[] = ["REWORK", "CANCEL"];

export function allowedLifecycleActions(actions: readonly TicketAction[]): LifecycleAction[] {
  return LIFECYCLE_ACTIONS.filter((action) => actions.includes(action));
}

interface ActionRun {
  /** Present so §13.3's mutation cache can re-fetch the ticket that was acted on. */
  id: number;
  request: () => Promise<unknown>;
  success: string;
}

interface RunOptions {
  request: () => Promise<unknown>;
  success: string;
  fields?: readonly string[];
  setFieldError?: (field: string, message: string) => void;
}

/**
 * One mutation path for every action. Success invalidates the ticket detail and
 * lists; a conflict is already toasted and re-fetched by the mutation cache
 * (§13.3), so the dialog closes and lets the refreshed ticket speak.
 */
function useActionRunner(ticketId: number, close: () => void) {
  const client = useQueryClient();
  const { notify } = useToast();
  const mutation = useMutation({
    meta: ticketActionMeta,
    mutationFn: (run: ActionRun) => run.request(),
    onSuccess: async (_result, run) => {
      notify(run.success);
      await client.invalidateQueries({ queryKey: queryKeys.tickets.all });
      close();
    },
  });

  async function run(input: RunOptions): Promise<void> {
    try {
      await mutation.mutateAsync({ id: ticketId, request: input.request, success: input.success });
    } catch (error) {
      const classified = classify(error);
      if (classified.kind === "conflict") {
        close();
        return;
      }
      if (classified.kind === "validation" && input.setFieldError) {
        let matched = false;
        for (const [field, message] of Object.entries(classified.fields)) {
          if (!input.fields?.includes(field)) continue;
          input.setFieldError(field, message);
          matched = true;
        }
        if (matched) return;
      }
      throw error;
    }
  }

  return { run, pending: mutation.isPending };
}

interface DialogProps {
  ticket: TicketDetail;
  close: () => void;
  fallback: RefObject<HTMLElement>;
}

export function TicketActionZone({
  ticket,
  focusFallback,
}: {
  ticket: TicketDetail;
  /** Where focus goes when a completed action removes its own trigger (#91). */
  focusFallback?: RefObject<HTMLElement>;
}) {
  const [open, setOpen] = useState<LifecycleAction | null>(null);
  const zone = useRef<HTMLElement>(null);
  const actions = allowedLifecycleActions(ticket.allowed_actions);
  const close = () => setOpen(null);
  const fallback = focusFallback ?? zone;

  if (actions.length === 0) return null;

  return (
    <section ref={zone} tabIndex={-1} className="action-zone" aria-label="Actions available to you">
      <div className="action-panel">
        <h2>Actions</h2>
        <p className="action-hint">
          Only the steps your account can take on this ticket are shown.
        </p>
        <div className="action-buttons">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={DANGER_ACTIONS.includes(action) ? "danger" : "primary"}
              onClick={() => setOpen(action)}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      </div>

      {open === "REVIEW" ? <ReviewDialog ticket={ticket} close={close} fallback={fallback} /> : null}
      {open === "ASSIGN" ? <AssignDialog ticket={ticket} close={close} fallback={fallback} /> : null}
      {open === "START" ? <StartDialog ticket={ticket} close={close} fallback={fallback} /> : null}
      {open === "RESOLVE" ? <ResolveDialog ticket={ticket} close={close} fallback={fallback} /> : null}
      {open === "CONFIRM" ? <ConfirmDialogAction ticket={ticket} close={close} fallback={fallback} /> : null}
      {open === "REWORK" ? <ReworkDialog ticket={ticket} close={close} fallback={fallback} /> : null}
      {open === "CANCEL" ? <CancelDialog ticket={ticket} close={close} fallback={fallback} /> : null}
    </section>
  );
}

const reviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    category: z.string(),
    priority: z.string(),
    reason: z.string(),
  })
  .superRefine((values, context) => {
    if (values.decision === "APPROVE") {
      if (!CATEGORY_ORDER.includes(values.category as Category)) {
        context.addIssue({ code: "custom", path: ["category"], message: "Select a category." });
      }
      if (!PRIORITY_ORDER.includes(values.priority as Priority)) {
        context.addIssue({ code: "custom", path: ["priority"], message: "Select a priority." });
      }
      return;
    }
    if (!values.reason.trim()) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Enter a rejection reason." });
    }
  });

type ReviewValues = z.infer<typeof reviewSchema>;

function ReviewDialog({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { decision: "APPROVE", category: "", priority: "", reason: "" },
  });
  const decision = watch("decision");

  const onConfirm = handleSubmit(async (values) => {
    const request = values.decision === "APPROVE"
      ? () => api.reviewTicket(ticket.id, {
          decision: "APPROVE",
          category: values.category as Category,
          priority: values.priority as Priority,
          expected_version: ticket.version,
        })
      : () => api.reviewTicket(ticket.id, {
          decision: "REJECT",
          reason: values.reason.trim(),
          expected_version: ticket.version,
        });

    await run({
      request,
      success: values.decision === "APPROVE"
        ? `Ticket ${ticket.code} approved for assignment.`
        : `Ticket ${ticket.code} rejected.`,
      fields: ["category", "priority", "reason"],
      setFieldError: (field, message) => {
        if (field === "category") setError("category", { message });
        if (field === "priority") setError("priority", { message });
        if (field === "reason") setError("reason", { message });
      },
    });
  });

  return (
    <ConfirmDialog
      open
      title={`Review ticket ${ticket.code}`}
      description="Approving records the category and priority. Rejecting ends the ticket and keeps your reason on the timeline."
      confirmLabel={decision === "APPROVE" ? "Approve" : "Reject"}
      danger={decision === "REJECT"}
      pending={pending}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={onConfirm}
    >
      <SelectField id="review-decision" label="Decision" {...register("decision")}>
        <option value="APPROVE">Approve</option>
        <option value="REJECT">Reject</option>
      </SelectField>
      {decision === "APPROVE" ? (
        <>
          <SelectField
            id="review-category"
            label="Category"
            required
            error={errors.category?.message}
            {...register("category")}
          >
            <option value="">Select a category</option>
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
            ))}
          </SelectField>
          <SelectField
            id="review-priority"
            label="Priority"
            required
            error={errors.priority?.message}
            {...register("priority")}
          >
            <option value="">Select a priority</option>
            {PRIORITY_ORDER.map((priority) => (
              <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
            ))}
          </SelectField>
        </>
      ) : (
        <TextAreaField
          id="review-reason"
          label="Rejection reason"
          required
          rows={3}
          error={errors.reason?.message}
          {...register("reason")}
        />
      )}
    </ConfirmDialog>
  );
}

const assignSchema = z.object({
  technician_id: z.string().min(1, "Select a technician."),
});

type AssignValues = z.infer<typeof assignSchema>;

function AssignDialog({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);
  const technicians = useQuery({
    queryKey: queryKeys.users.list({ role: "TECHNICIAN", active: true, limit: 100 }),
    queryFn: ({ signal }) => api.listUsers({ role: "TECHNICIAN", active: true, limit: 100 }, signal),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AssignValues>({
    resolver: zodResolver(assignSchema),
    defaultValues: { technician_id: "" },
  });

  const items = technicians.data?.items ?? [];
  const unavailable = technicians.isPending || technicians.isError || items.length === 0;

  const onConfirm = handleSubmit(async (values) => {
    await run({
      request: () => api.assignTicket(ticket.id, {
        technician_id: Number(values.technician_id),
        expected_version: ticket.version,
      }),
      success: `Ticket ${ticket.code} assigned.`,
      fields: ["technician_id"],
      setFieldError: (field, message) => {
        if (field === "technician_id") setError("technician_id", { message });
      },
    });
  });

  return (
    <ConfirmDialog
      open
      title={`Assign ticket ${ticket.code}`}
      description="Choose an active technician. The ticket stays pending assignment until one is selected."
      confirmLabel="Assign"
      pending={pending}
      disabled={unavailable}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={onConfirm}
    >
      {technicians.isPending ? <p role="status">Loading technicians…</p> : null}
      {technicians.isError ? (
        <>
          <p role="alert">{classify(technicians.error).message}</p>
          <button type="button" onClick={() => { void technicians.refetch(); }}>Retry</button>
        </>
      ) : null}
      {!technicians.isPending && !technicians.isError && items.length === 0 ? (
        <p className="action-hint">
          No active technicians are available. The ticket stays pending assignment.
        </p>
      ) : null}
      {!unavailable ? (
        <SelectField
          id="assign-technician"
          label="Technician"
          required
          error={errors.technician_id?.message}
          {...register("technician_id")}
        >
          <option value="">Select a technician</option>
          {items.map((technician) => (
            <option key={technician.id} value={technician.id}>{technician.name}</option>
          ))}
        </SelectField>
      ) : null}
    </ConfirmDialog>
  );
}

const startSchema = z.object({ note: z.string() });

type StartValues = z.infer<typeof startSchema>;

function StartDialog({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);
  const { register, handleSubmit } = useForm<StartValues>({
    resolver: zodResolver(startSchema),
    defaultValues: { note: "" },
  });

  const onConfirm = handleSubmit(async (values) => {
    await run({
      request: () => api.startTicket(ticket.id, {
        note: values.note.trim() || undefined,
        expected_version: ticket.version,
      }),
      success: `Ticket ${ticket.code} — processing started.`,
    });
  });

  return (
    <ConfirmDialog
      open
      title={`Start work on ${ticket.code}`}
      description="This moves the ticket to In Progress and records you as the technician handling it."
      confirmLabel="Start work"
      pending={pending}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={onConfirm}
    >
      <TextAreaField
        id="start-note"
        label="Opening note"
        hint="Optional — recorded on the work-started event."
        rows={2}
        {...register("note")}
      />
    </ConfirmDialog>
  );
}

const resolveSchema = z.object({
  resolution_note: z.string().trim().min(1, "Describe the work you carried out."),
});

type ResolveValues = z.infer<typeof resolveSchema>;

function ResolveDialog({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResolveValues>({
    resolver: zodResolver(resolveSchema),
    defaultValues: { resolution_note: "" },
  });

  const onConfirm = handleSubmit(async (values) => {
    await run({
      request: () => api.resolveTicket(ticket.id, {
        resolution_note: values.resolution_note,
        expected_version: ticket.version,
      }),
      success: `Result submitted for ticket ${ticket.code}.`,
      fields: ["resolution_note"],
      setFieldError: (field, message) => {
        if (field === "resolution_note") setError("resolution_note", { message });
      },
    });
  });

  return (
    <ConfirmDialog
      open
      title={`Submit the result for ${ticket.code}`}
      description="Describe what was wrong and what you did. The reporter reads this before confirming."
      confirmLabel="Submit result"
      pending={pending}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={onConfirm}
    >
      <TextAreaField
        id="resolve-note"
        label="Resolution note"
        required
        rows={4}
        error={errors.resolution_note?.message}
        {...register("resolution_note")}
      />
    </ConfirmDialog>
  );
}

function ConfirmDialogAction({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);

  return (
    <ConfirmDialog
      open
      title={`Close ticket ${ticket.code}?`}
      description="Confirming closes the ticket and makes it read-only. The timeline keeps its full history."
      confirmLabel="Confirm completion"
      pending={pending}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={() => run({
        request: () => api.confirmTicket(ticket.id, { expected_version: ticket.version }),
        success: `Ticket ${ticket.code} closed.`,
      })}
    />
  );
}

const reworkSchema = z.object({
  reason: z.string().trim().min(1, "Enter a reason so the technician knows what to fix."),
});

type ReworkValues = z.infer<typeof reworkSchema>;

function ReworkDialog({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ReworkValues>({
    resolver: zodResolver(reworkSchema),
    defaultValues: { reason: "" },
  });

  const onConfirm = handleSubmit(async (values) => {
    await run({
      request: () => api.reworkTicket(ticket.id, {
        reason: values.reason,
        expected_version: ticket.version,
      }),
      success: `Rework requested for ticket ${ticket.code}.`,
      fields: ["reason"],
      setFieldError: (field, message) => {
        if (field === "reason") setError("reason", { message });
      },
    });
  });

  return (
    <ConfirmDialog
      open
      title={`Request rework for ${ticket.code}`}
      description="The ticket returns to In Progress and stays with the same technician."
      confirmLabel="Request rework"
      danger
      pending={pending}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={onConfirm}
    >
      <TextAreaField
        id="rework-reason"
        label="What still needs fixing?"
        required
        rows={4}
        error={errors.reason?.message}
        {...register("reason")}
      />
    </ConfirmDialog>
  );
}

const cancelSchema = z.object({ reason: z.string() });

type CancelValues = z.infer<typeof cancelSchema>;

function CancelDialog({ ticket, close, fallback }: DialogProps) {
  const { run, pending } = useActionRunner(ticket.id, close);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CancelValues>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: "" },
  });

  const onConfirm = handleSubmit(async (values) => {
    await run({
      request: () => api.cancelTicket(ticket.id, {
        reason: values.reason.trim() || undefined,
        expected_version: ticket.version,
      }),
      success: `Ticket ${ticket.code} cancelled.`,
      fields: ["reason"],
      setFieldError: (field, message) => {
        if (field === "reason") setError("reason", { message });
      },
    });
  });

  return (
    <ConfirmDialog
      open
      title={`Cancel ticket ${ticket.code}?`}
      description="This withdraws the ticket before review. It will not be repaired and becomes read-only."
      confirmLabel="Cancel request"
      danger
      pending={pending}
      fallbackFocusRef={fallback}
      onCancel={close}
      onConfirm={onConfirm}
    >
      <TextAreaField
        id="cancel-reason"
        label="Reason"
        hint="Optional — shown on the timeline."
        rows={3}
        error={errors.reason?.message}
        {...register("reason")}
      />
    </ConfirmDialog>
  );
}
