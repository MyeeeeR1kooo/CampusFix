/**
 * Reporter create page (#51) with the #54 photo picker.
 *
 * Fields and rules come from the frozen baseline §5.1 and the contract's
 * `CreateTicketRequest`; the server remains the authority for content, active
 * locations and image decoding. The form uses React Hook Form + Zod like every
 * other form in the app (§13.2) and keeps entered values when the server rejects.
 */

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { api, type Category } from "../../api";
import { SelectField, TextAreaField, TextField } from "../../components/Field";
import { useToast } from "../../hooks/useToast";
import { classify } from "../../lib/errors";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "../../lib/labels";
import { queryKeys } from "../../lib/queryClient";
import { currentSessionVersion } from "../../lib/session";
import { LocationCascade } from "../locations/LocationCascade";
import { PhotoPicker } from "./PhotoPicker";

const reportSchema = z.object({
  title: z.string()
    .min(1, "Enter a title.")
    .max(120, "Keep the title to 120 characters or fewer."),
  description: z.string()
    .min(1, "Describe the problem.")
    .max(4000, "Keep the description to 4000 characters or fewer."),
  category: z.string().refine(
    (value) => CATEGORY_ORDER.includes(value as Category),
    "Select a category.",
  ),
  location_id: z.number()
    .int()
    .positive()
    .nullable(),
}).superRefine((values, context) => {
  if (values.location_id === null) {
    context.addIssue({ code: "custom", path: ["location_id"], message: "Select a location." });
  }
});

type ReportValues = z.infer<typeof reportSchema>;

const FIELD_NAMES = ["title", "description", "category", "location_id"] as const;
type FieldName = (typeof FIELD_NAMES)[number];

export function CreateRepairPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { notify } = useToast();
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const [pending, setPending] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, submitCount },
  } = useForm<ReportValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: { title: "", description: "", category: "", location_id: null },
  });

  const submit = handleSubmit(async (values) => {
    const issuedIn = currentSessionVersion();
    setServerError(undefined);
    setPhotoError(undefined);
    setPending(true);
    try {
      const ticket = await api.createTicket({
        title: values.title,
        description: values.description,
        category: values.category as Category,
        location_id: values.location_id as number,
        photos,
      });
      // The account may have changed while the request was in flight. A late
      // success belongs to the previous session: no toast, no cache invalidation
      // and no navigation into a ticket the current account cannot see.
      if (issuedIn !== currentSessionVersion()) return;
      notify(`Ticket ${ticket.code} submitted.`);
      // A new ticket must appear in the reporter's list without a manual reload.
      await client.invalidateQueries({ queryKey: queryKeys.tickets.all });
      if (issuedIn !== currentSessionVersion()) return;
      navigate(`/tickets/${ticket.id}`);
    } catch (failure) {
      if (issuedIn !== currentSessionVersion()) return;
      const error = classify(failure);
      setServerError(error.message);
      for (const field of FIELD_NAMES) {
        if (error.fields[field]) setError(field as FieldName, { message: error.fields[field] });
      }
      const photoKey = Object.keys(error.fields).find(
        (field) => field === "photos" || field.startsWith("photos."),
      );
      if (photoKey) setPhotoError(error.fields[photoKey]);
    } finally {
      setPending(false);
    }
  });

  const invalidSubmit = submitCount > 0 && Object.keys(errors).length > 0;

  return (
    <div className="page page-narrow">
      <p className="back-link"><Link to="/reports">← My reports</Link></p>

      <header className="page-head">
        <div>
          <h1>Create a repair report</h1>
          <p className="page-sub">
            Describe one facility problem and choose where it is. The dispatcher reviews it next.
          </p>
        </div>
      </header>

      {/* Baseline §2.2: emergencies are not CampusFix's to handle. */}
      <div className="banner banner-notice-warning" role="note">
        <div className="banner-body">
          <strong className="banner-title">Emergencies</strong>
          <span>
            Safety incidents, medical events and police reports must use the university's
            existing emergency channels. CampusFix does not handle emergencies.
          </span>
        </div>
      </div>

      {invalidSubmit ? (
        <div className="banner banner-error" role="alert">
          <div className="banner-body"><span>Check the required fields below.</span></div>
        </div>
      ) : null}
      {serverError ? (
        <div className="banner banner-error" role="alert">
          <div className="banner-body"><span>{serverError}</span></div>
        </div>
      ) : null}

      <form
        className="form card"
        onSubmit={submit}
        onChange={() => setServerError(undefined)}
        noValidate
      >
        <TextField
          id="report-title"
          label="Title"
          required
          hint="A short summary, 1–120 characters."
          error={errors.title?.message}
          {...register("title")}
        />

        <SelectField
          id="report-category"
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

        <TextAreaField
          id="report-description"
          label="Description"
          required
          rows={5}
          hint="What is wrong, and anything the technician should know. 1–4000 characters."
          error={errors.description?.message}
          {...register("description")}
        />

        <Controller
          control={control}
          name="location_id"
          render={({ field, fieldState }) => (
            <LocationCascade
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <PhotoPicker
          files={photos}
          onChange={(next) => {
            setPhotos(next);
            setPhotoError(undefined);
            // Removing a photo is a button click, not a form change event.
            setServerError(undefined);
          }}
          error={photoError}
        />

        <div className="form-actions">
          <button type="submit" className="primary" disabled={pending}>
            {pending ? "Submitting…" : "Submit report"}
          </button>
          <Link className="button" to="/reports">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
