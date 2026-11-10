import { type FC, useMemo, useRef } from "react";

import styles from "./Rewind.module.css";

interface Props {
  maxDataLength: number;
  time: number;
  rewind: (e: any) => void;
  /** VUs per second of the runs being compared (local: replaces the site's hard-coded 0→3000 stages) */
  vus: number[];
}

const WIDTH = 350; // px, same track width as the site
const SEGMENTS = 4;

const fmt = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v)));

const Arrow = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-arrow-right"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const Rewind: FC<Props> = ({ maxDataLength, time, rewind, vus }) => {
  const sliderRef = useRef<any>();

  const progress = useMemo(() => {
    return maxDataLength ? (time / (maxDataLength * 100)) * 100 : 0;
  }, [time, maxDataLength]);

  const currentUsers = vus[Math.min(Math.floor(time / 100), vus.length - 1)] ?? 0;

  // four equal-time segments labelled with the VUs at their start and end
  const segments = useMemo(() => {
    const last = Math.max(0, vus.length - 1);
    return Array.from({ length: SEGMENTS }, (_, i) => {
      const from = vus[Math.round((last * i) / SEGMENTS)] ?? 0;
      const to = vus[Math.round((last * (i + 1)) / SEGMENTS)] ?? 0;
      return { from, to };
    });
  }, [vus]);

  return (
    <div className={styles.wrap}>
      <div className={styles.tooltip} style={{ left: `${(WIDTH * progress) / 100}px` }}>
        {currentUsers} VUs
      </div>
      <div className={styles.rangeContainer}>
        <div className={styles["progress-line"]} style={{ width: `${progress}%` }}></div>
        {segments.map(({ from, to }, i) => (
          <div
            key={i}
            className={styles.rangeStep}
            style={{
              width: `${WIDTH / SEGMENTS}px`,
              ...(i === SEGMENTS - 1 ? { borderRight: "1px solid transparent" } : {}),
            }}
          >
            {fmt(from) === fmt(to) ? (
              fmt(to)
            ) : (
              <>
                {fmt(from)}
                <Arrow />
                {fmt(to)}
              </>
            )}
          </div>
        ))}
        <input
          ref={sliderRef}
          className={styles["rewind-input"]}
          type="range"
          min={0}
          max={maxDataLength * 100}
          value={time}
          onChange={rewind}
          step={1}
        />
      </div>
    </div>
  );
};

export default Rewind;
