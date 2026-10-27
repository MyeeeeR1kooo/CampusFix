/**
 * Ticket photos (#54).
 *
 * The two purposes are separate groups because a reader is asking two different
 * questions: what was reported, and what was done. Bytes come from the protected
 * `download_url`; the page never builds a storage path of its own.
 */

import { useEffect, useState } from "react";

import { api, type Attachment } from "../../api";
import { PHOTO_PURPOSE_LABELS } from "../../lib/labels";

function Photo({ photo }: { photo: Attachment }) {
  const [src, setSrc] = useState<string>();
  const [missing, setMissing] = useState(false);
  const alt = `${PHOTO_PURPOSE_LABELS[photo.purpose]}: ${photo.original_name}`;

  useEffect(() => {
    // Read through the shared API client so the Mock bridge can serve fixture
    // bytes. An <img src="/api/…"> would bypass mockBridge and hit the real proxy.
    let active = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    setSrc(undefined);
    setMissing(false);
    api.downloadAttachment(photo.id, controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id]);

  return (
    <li>
      <figure className="photo">
        {missing ? (
          <p className="photo-missing">Image unavailable</p>
        ) : src ? (
          <img src={src} alt={alt} loading="lazy" onError={() => setMissing(true)} />
        ) : (
          <p className="photo-missing" role="status">Loading image…</p>
        )}
        <figcaption>
          <span className="file-name">{photo.original_name}</span>
          <span className="muted">
            {new Date(photo.created_at).toLocaleDateString()}
          </span>
        </figcaption>
      </figure>
    </li>
  );
}

function PhotoGroup({ title, photos, empty }: {
  title: string;
  photos: readonly Attachment[];
  empty: string;
}) {
  return (
    <div className="gallery-group">
      <h3>{title}</h3>
      {photos.length > 0 ? (
        <ul className="gallery" aria-label={title}>
          {photos.map((photo) => <Photo key={photo.id} photo={photo} />)}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </div>
  );
}

export function TicketPhotoGallery({ ticket }: {
  ticket: { report_photos: readonly Attachment[]; resolution_photos: readonly Attachment[] };
}) {
  return (
    <section className="card" aria-labelledby="detail-photos-heading">
      <h2 id="detail-photos-heading">Photos</h2>
      <div className="gallery-groups">
        <PhotoGroup
          title="Report photos"
          photos={ticket.report_photos}
          empty="No report photos were attached."
        />
        <PhotoGroup
          title="Resolution photos"
          photos={ticket.resolution_photos}
          empty="No resolution photos have been submitted."
        />
      </div>
    </section>
  );
}
