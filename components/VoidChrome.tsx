'use client';

/**
 * Editorial “Collective Void” chrome: fold lines, header, bottom stats/metadata.
 * Fixed layers use pointer-events: none so the canvas stays interactive underneath.
 */
export type VoidChromeProps = {
  patchCount: number;
  canvasReading: string;
};

export default function VoidChrome({ patchCount, canvasReading }: VoidChromeProps) {
  const marksLabel = patchCount.toLocaleString();
  const reading =
    canvasReading.trim().length > 0 ? canvasReading.toUpperCase() : 'UNTITLED';

  return (
    <>
      <div className="void-folds" aria-hidden>
        <div className="void-fold-line" />
        <div className="void-fold-line" />
        <div className="void-fold-line" />
        <div className="void-fold-line" />
      </div>

      <header className="void-header">
        <div className="void-title">
          COLLECTIVE
          <br />
          VOID.01
        </div>
        <div className="void-metadata">
          CO-AUTHORED BY {marksLabel} MARK{patchCount === 1 ? '' : 'S'}
          <br />
          SURFACE: AI MURAL · REALTIME
          <br />
          MODEL: NEURAL-GESTALT-V4
          <br />
          --<br />
          EVERY MARK IS PERMANENT.
          <br />
          EVERY VOID IS TEMPORARY.
        </div>
      </header>

      <div className="void-bottom-nav">
        <div className="void-stats">
          <div>TOTAL MARKS // {marksLabel}</div>
          <div>CANVAS // {reading.length > 48 ? `${reading.slice(0, 48)}…` : reading}</div>
        </div>
        <div className="void-metadata void-metadata--footer">
          LONDON / BERLIN / TOKYO / THE VOID
        </div>
      </div>

      <svg className="void-noise-svg" aria-hidden>
        <filter id="void-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </svg>
    </>
  );
}
