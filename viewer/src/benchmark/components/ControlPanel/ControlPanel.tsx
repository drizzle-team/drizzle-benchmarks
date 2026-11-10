import { useEffect, useMemo, useState, type FC } from "react";

import styles from "./ControlPanel.module.css";
import type { IData, IRuns } from "../../types.ts";

import SpeedSelector from "../SpeedSelector/SpeedSelector.tsx";
import Performance from "../Performance/Performance.tsx";
import { useBenchmarkContext } from "../../context/useBenchmarkContext.tsx";
import getBenchmarkData from "../../utils/getBenchmarkData.ts";
import Rewind from "../Rewind/Rewind.tsx";

interface Props {
  runs: IRuns;
}

// Local version of the site's ControlPanel: same playback controls, but the ORM/runtime
// configuration modal is replaced by two pickers over the runs found in results/.
const ControlPanel: FC<Props> = ({ runs }) => {
  const {
    setIsTimerActive,
    isTimerActive,
    time,
    setTime,
    intervalId,
    selectedItems,
    setSelectedItems,
  } = useBenchmarkContext();
  const [speed, setSpeed] = useState<number>(2);
  const [drizzleData, setDrizzleData] = useState<IData[] | null>(null);
  const [compareData, setCompareData] = useState<IData[] | null>(null);
  const isConfigOpen = false;
  const names = useMemo(() => Object.keys(runs), [runs]);

  const maxDataLength = useMemo(() => {
    if (drizzleData && compareData) {
      return Math.min(drizzleData.length - 1, compareData.length - 1);
    }
    return 0;
  }, [drizzleData, compareData]);

  // VUs per second for the scrubber: the larger of the two runs at each second
  const vus = useMemo(() => {
    if (!drizzleData || !compareData) return [];
    return Array.from({ length: maxDataLength + 1 }, (_, i) =>
      Math.max(drizzleData[i]?.vus ?? 0, compareData[i]?.vus ?? 0),
    );
  }, [drizzleData, compareData, maxDataLength]);

  const skipToResults = () => {
    if (!drizzleData || !compareData) return;
    clearInterval(intervalId.current);
    setTime(maxDataLength * 100);
  };

  const pause = () => {
    if (!drizzleData || !compareData) return;
    clearInterval(intervalId.current);
    setIsTimerActive(false);
  };

  const rerun = () => {
    if (!drizzleData || !compareData) return;
    setTime(0);
    setIsTimerActive(true);
  };

  const resume = () => {
    if (!drizzleData || !compareData) return;
    setIsTimerActive(true);
  };

  const rewind = (e: any) => {
    if (!drizzleData || !compareData) return;
    setTime(Number(e.target.value));
    setIsTimerActive(false);
    clearInterval(intervalId.current);
  };

  useEffect(() => {
    const data = getBenchmarkData(runs, selectedItems);
    if (data) {
      setDrizzleData(data.drizzleData);
      setCompareData(data.compareData);
    }
    return () => {
      setDrizzleData(null);
      setCompareData(null);
    };
  }, [runs, selectedItems]);

  useEffect(() => {
    rerun();
  }, [drizzleData, compareData]);

  return (
    <div className={styles.content}>
      {/* local: run selection, above the site's original control bar */}
      <div className={styles.pickers}>
        {(["left", "right"] as const).map((side, i) => (
          <label key={side} className={styles.picker}>
            <span>{i === 0 ? "A" : "B"}</span>
            <select
              value={selectedItems[side]}
              onChange={(e) => setSelectedItems((prev) => ({ ...prev, [side]: e.target.value }))}
            >
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          className={styles["play-wrap"]}
          onClick={() => setSelectedItems(({ left, right }) => ({ left: right, right: left }))}
        >
          Swap
        </button>
        <button type="button" className={styles["play-wrap"]} onClick={skipToResults}>
          Results
        </button>
      </div>
      <div className={styles.control}>
        <div className={styles.time}>
          {!isConfigOpen && <SpeedSelector speed={speed} setSpeed={setSpeed} />}
          {!isTimerActive &&
            !isConfigOpen &&
            (time === maxDataLength * 100 || time === 0) && (
              <>
                <div className={styles.divider}></div>
                <button
                  type="button"
                  className={styles["play-wrap"]}
                  onClick={rerun}
                >
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
                    className="lucide lucide-play"
                  >
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                  Run
                </button>
                <div className={styles.divider}></div>
              </>
            )}
          {!isTimerActive &&
            !isConfigOpen &&
            time !== maxDataLength * 100 &&
            time !== 0 && (
              <>
                <div className={styles.divider}></div>
                <button
                  type="button"
                  className={styles["play-wrap"]}
                  onClick={resume}
                >
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
                    className="lucide lucide-play"
                  >
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                  Resume
                </button>
                <div className={styles.divider}></div>
              </>
            )}
          {isTimerActive && !isConfigOpen && (
            <>
              <div className={styles.divider}></div>
              <button
                type="button"
                className={styles["play-wrap"]}
                onClick={pause}
              >
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
                  className="lucide lucide-pause"
                >
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                </svg>
                Pause
              </button>
              <div className={styles.divider}></div>
            </>
          )}
          {!isConfigOpen && (
            <Rewind maxDataLength={maxDataLength} time={time} rewind={rewind} vus={vus} />
          )}
        </div>
      </div>
      <div className={styles.container}>
        <Performance
          selectedItems={selectedItems}
          isConfigOpen={isConfigOpen}
          speed={speed}
          data={drizzleData}
          compareData={compareData}
          maxElements={81}
          maxDataLength={maxDataLength}
        />
      </div>
    </div>
  );
};

export default ControlPanel;
