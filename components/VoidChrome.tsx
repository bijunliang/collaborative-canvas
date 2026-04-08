'use client';

/**
 * Editorial “Collective Void” chrome: fold lines, header, bottom stats/metadata.
 * Fixed layers use pointer-events: none so the canvas stays interactive underneath.
 */
export type VoidChromeProps = {
  patchCount: number;
  /** LLM-generated exhibition title; uppercased for display. */
  paintingTitle: string;
  /** True while Comet title request is in flight. */
  titlePending?: boolean;
};

export default function VoidChrome({
  patchCount,
  paintingTitle,
  titlePending = false,
}: VoidChromeProps) {
  const marksLabel = patchCount.toLocaleString();
  const raw = paintingTitle.trim();
  const titleUpper =
    titlePending && !raw ? '…' : raw.length > 0 ? raw.toUpperCase() : 'UNTITLED';
  const titleLine =
    titleUpper.length > 56 ? `${titleUpper.slice(0, 56)}…` : titleUpper;

  return (
    <>
      <header className="void-header">
        <div className="void-title">
          COLLECTIVE
          <br />
          VOID.01
        </div>
        <div className="void-metadata">
          CO-AUTHORED BY {marksLabel} MARK{patchCount === 1 ? '' : 'S'}
          <br />
          AI MURAL · REALTIME
          <br />
          MODEL: NANO-BANANA (GEMINI 2.5 FLASH IMAGE)
          <br />
          --<br />
          An experiment in collective authorship. 
          Each layer holds an image left by the mark of a person.
          Is this painting AI-made or human-made? 
          Pick a spot and add your mark, big or small...
        </div>
      </header>

      <div className="void-bottom-nav">
        <div className="void-stats">
          <div>TOTAL MARKS // {marksLabel}</div>
          <div>TITLE // {titleLine}</div>
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
