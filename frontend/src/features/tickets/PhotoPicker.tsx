/**
 * Report-photo picker (#54).
 *
 * Client-side checks mirror the frozen file rules (P0 §7.1) so the user gets an
 * immediate answer, but they are not the security boundary: creation still sends
 * the files as multipart parts and the backend re-checks real content.
 */

import { useEffect, useId, useState } from "react";

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

interface SelectedPreview {
  file: File;
  url: string;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

export function PhotoPicker({ files, onChange, error }: {
  files: readonly File[];
  onChange: (files: File[]) => void;
  error?: string;
}) {
  const id = useId();
  const [message, setMessage] = useState<string>();
  const [previews, setPreviews] = useState<SelectedPreview[]>([]);

  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [files]);

  function select(incoming: FileList | null, input: HTMLInputElement) {
    const chosen = Array.from(incoming ?? []);
    input.value = "";
    if (chosen.length === 0) return;

    const problems: string[] = [];
    const next = [...files];
    for (const file of chosen) {
      if (next.length >= MAX_PHOTOS) {
        problems.push(`You can attach at most ${MAX_PHOTOS} photos.`);
        break;
      }
      if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        problems.push(`${file.name}: use a JPEG, PNG or WebP image.`);
        continue;
      }
      if (file.size === 0) {
        problems.push(`${file.name}: the file is empty.`);
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        problems.push(`${file.name}: each photo must be 5 MiB or smaller.`);
        continue;
      }
      next.push(file);
    }

    setMessage(problems.length > 0 ? [...new Set(problems)].join(" ") : undefined);
    if (next.length !== files.length) onChange(next);
  }

  function remove(index: number) {
    setMessage(undefined);
    onChange(files.filter((_, position) => position !== index));
  }

  const describedBy = [message ? `${id}-message` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="field">
      <label htmlFor={`${id}-photos`}>
        Photos <span className="muted">(optional)</span>
      </label>
      <p className="field-hint" id={`${id}-hint`}>
        Up to {MAX_PHOTOS} images. JPEG, PNG or WebP; each 5 MiB or smaller.
      </p>
      <input
        id={`${id}-photos`}
        type="file"
        accept={ALLOWED_PHOTO_TYPES.join(",")}
        multiple
        aria-describedby={[`${id}-hint`, describedBy].filter(Boolean).join(" ")}
        aria-invalid={message || error ? true : undefined}
        onChange={(event) => select(event.target.files, event.currentTarget)}
      />
      <p className="field-hint" aria-live="polite">
        {files.length} of {MAX_PHOTOS} selected
      </p>
      {message ? (
        <p className="field-error" id={`${id}-message`} role="alert">{message}</p>
      ) : null}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">{error}</p>
      ) : null}
      {previews.length > 0 ? (
        <ul className="gallery" aria-label="Selected photos">
          {previews.map(({ file, url }, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`}>
              <figure className="photo">
                <img src={url} alt={`Preview of ${file.name}`} />
                <figcaption>
                  <span className="file-name">{file.name}</span>
                  <span className="muted">{sizeLabel(file.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => remove(index)}
                  >
                    Remove
                  </button>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
