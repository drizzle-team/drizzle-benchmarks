import { type IData, type IRuns, type ISelection } from "../types";
import dataMapper from "./dataMapper";

// Local replacement for the site's hard-coded variants table: any two runs from results/.
const getBenchmarkData = (
  runs: IRuns,
  { left, right }: ISelection,
): null | { drizzleData: IData[]; compareData: IData[] } => {
  if (!runs[left]?.length || !runs[right]?.length) return null;
  return {
    drizzleData: dataMapper(runs[left]),
    compareData: dataMapper(runs[right]),
  };
};

export default getBenchmarkData;
