import "./auth.css";

/**
 * The brand side of the sign-in pages.
 *
 * On a laptop it is a panel beside the form: what the product is, shown rather
 * than described — a boarding pass of the kind it issues, floating over the
 * pitch. On a phone and a narrow tablet it shrinks to a coloured header band
 * with the mark and one line, and the form card overlaps it. There is no room
 * for a pitch there, and nobody signing in on a platform needs one.
 *
 * Shared by all five auth pages, so they cannot drift into five versions of it.
 */

/*
 * A QR code drawn, not scanned: 21 modules square, the three finder squares a
 * real code has, and a fixed pseudo-random fill between them. It only has to
 * read as a QR code at a glance; it is never meant to decode.
 */
const QR_SIZE = 21;
const QR_CELLS = (() => {
  const cells = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const inFinder = (x, y) =>
    (x < 8 && y < 8) || (x > QR_SIZE - 9 && y < 8) || (x < 8 && y > QR_SIZE - 9);
  for (let y = 0; y < QR_SIZE; y++) {
    for (let x = 0; x < QR_SIZE; x++) {
      if (!inFinder(x, y) && next() > 0.52) cells.push([x, y]);
    }
  }
  return cells;
})();

function Finder({ x, y }) {
  return (
    <g>
      <rect x={x} y={y} width="7" height="7" rx="1.2" fill="currentColor" />
      <rect x={x + 1} y={y + 1} width="5" height="5" rx="0.8" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.6" fill="currentColor" />
    </g>
  );
}

function DrawnQr() {
  return (
    <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} className="pass__qr" aria-hidden="true">
      {QR_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" rx="0.25" fill="currentColor" />
      ))}
      <Finder x={0} y={0} />
      <Finder x={QR_SIZE - 7} y={0} />
      <Finder x={0} y={QR_SIZE - 7} />
    </svg>
  );
}

/** A sample ticket, so the first thing a visitor sees is what they will get. */
function BoardingPass() {
  return (
    <div className="pass" aria-hidden="true">
      <div className="pass__top">
        <span className="pass__train">
          <i className="pi pi-ticket" /> Ekota Express
        </span>
        <span className="pass__status">
          <i className="pi pi-check-circle" /> Confirmed
        </span>
      </div>

      <div className="pass__route">
        <div>
          <small>From</small>
          <strong>DHK</strong>
          <span>Dhaka · 22:00</span>
        </div>
        <div className="pass__line">
          <i className="pi pi-arrow-right" />
        </div>
        <div className="pass__to">
          <small>To</small>
          <strong>DNJ</strong>
          <span>Dinajpur · 07:30</span>
        </div>
      </div>

      <div className="pass__tear" />

      <div className="pass__bottom">
        <dl>
          <div>
            <dt>Coach</dt>
            <dd>SHOVON-2</dd>
          </div>
          <div>
            <dt>Seat</dt>
            <dd>B-12</dd>
          </div>
          <div>
            <dt>Class</dt>
            <dd>AC Chair</dd>
          </div>
        </dl>
        <DrawnQr />
      </div>
    </div>
  );
}

export default function AuthBrand() {
  return (
    <aside className="auth-brand">
      <div className="auth-brand__logo">
        <span className="auth-brand__mark" aria-hidden="true">
          <i className="pi pi-ticket" />
        </span>
        <span>
          <strong>Seat Planner</strong>
          <small>Railway ticketing</small>
        </span>
      </div>

      <div className="auth-brand__stage">
        <div className="auth-brand__pitch">
          <p className="auth-brand__eyebrow">Railway ticketing, end to end</p>
          <h2>
            Book, check and run the railway <span>— from one place.</span>
          </h2>
          <p className="auth-brand__lead">
            Seats are sold stretch by stretch, so a train that looks full end to end often still
            has room on yours.
          </p>
        </div>

        <div className="auth-brand__art">
          <BoardingPass />
          <span className="auth-brand__chip auth-brand__chip--a">
            <i className="pi pi-verified" /> Scanned offline
          </span>
          <span className="auth-brand__chip auth-brand__chip--b">
            <i className="pi pi-wallet" /> Paid from wallet
          </span>
        </div>
      </div>

      <ul className="auth-brand__features">
        <li>
          <i className="pi pi-map" aria-hidden="true" />
          <span>
            <strong>Stretch-by-stretch seats</strong>
            <small>More room on the part you travel</small>
          </span>
        </li>
        <li>
          <i className="pi pi-qrcode" aria-hidden="true" />
          <span>
            <strong>Signed QR tickets</strong>
            <small>Checked even without signal</small>
          </span>
        </li>
        <li>
          <i className="pi pi-replay" aria-hidden="true" />
          <span>
            <strong>Fair returns</strong>
            <small>Paid out as your seat resells</small>
          </span>
        </li>
      </ul>
    </aside>
  );
}
