import { when } from "@/lib/allocation";

export const OFFICIAL_SITE = "https://eticket.railway.gov.bd";

/**
 * Where the data comes from and how current it is, for everyone who is not
 * staff: on the public page, and in the app for those seeing it because it is
 * public. No railway logo or styling — the words and a link to the official
 * site, and a plain disclaimer.
 */
export default function SourceNotice({ lastUpdated }) {
  return (
    <section className="al-notice" aria-label="About this data">
      <p>
        <i className="pi pi-info-circle" aria-hidden="true" />
        <span>
          Prepared from the seat availability on Bangladesh Railway&apos;s official e-ticket site,{" "}
          <a href={OFFICIAL_SITE} target="_blank" rel="noopener noreferrer">
            eticket.railway.gov.bd
          </a>
          .{lastUpdated && (
            <>
              {" "}
              Last updated <strong>{when(lastUpdated)}</strong>.
            </>
          )}
        </span>
      </p>
      <p className="al-notice__fine">
        Not affiliated with Bangladesh Railway. Seats change all the time — check the official site before you travel.
      </p>
    </section>
  );
}

/** When the data was last brought up to date: the newer of the census and the counts. */
export function lastUpdatedOf(meta) {
  if (meta?.lastUpdated) return meta.lastUpdated;
  const dates = [meta?.latest?.census?.at, meta?.latest?.counts?.at].filter(Boolean).map((d) => new Date(d));
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}
