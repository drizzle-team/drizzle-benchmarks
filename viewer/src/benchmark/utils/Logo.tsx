import { type FC } from "react";
import DrizzleLogo from "../../icons/DrizzleLogo";
import PrismaIcon from "../../icons/PrismaIcon";
import GoIcon from "../../icons/GoIcon";

interface Props {
  logo: string;
}

const Logo: FC<Props> = ({ logo }) => {
  if (logo.startsWith("drizzle")) {
    return <DrizzleLogo />;
  }
  if (logo.startsWith("prisma")) {
    return <PrismaIcon />;
  }
  if (logo.startsWith("go")) {
    return <GoIcon />;
  }
  // local: any other run name gets its initial
  return (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">
        {logo.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  );
};

export default Logo;
