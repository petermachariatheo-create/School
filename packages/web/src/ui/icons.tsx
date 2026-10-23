import type { ReactNode } from "react";
import type { IconName } from "../app/catalog.ts";

/**
 * The icon set.
 *
 * Icons are drawn here rather than pulled from a library: the set is small,
 * it never changes, and a school that installs the client offline should
 * not have to fetch anything to render a page.
 */

export type UiIconName =
  | "plus"
  | "search"
  | "back"
  | "close"
  | "check"
  | "alert"
  | "info"
  | "offline"
  | "sync"
  | "download"
  | "upload"
  | "trash"
  | "save"
  | "device"
  | "list"
  | "grid"
  | "more"
  | "empty"
  | "edit"
  | "chevron-left"
  | "chevron-right"
  | "user"
  | "clock";

export type AnyIconName = IconName | UiIconName;

const PATHS: Record<AnyIconName, ReactNode> = {
  /* --- the domain ------------------------------------------------------ */
  student: (
    <>
      <path d="M12 4.2a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" />
      <path d="M6.2 19.4a5.8 5.8 0 0 1 11.6 0" />
    </>
  ),
  guardian: (
    <>
      <path d="M9.4 5.4a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z" />
      <path d="M4.6 19a4.8 4.8 0 0 1 9.6 0" />
      <path d="M16.4 8.2a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z" />
      <path d="M14.6 19a3.6 3.6 0 0 1 5.2-3.2" />
    </>
  ),
  link: (
    <>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1 1" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1-1" />
    </>
  ),
  class: (
    <>
      <path d="M9.4 4.6a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Z" />
      <path d="M3.8 19a5.6 5.6 0 0 1 11.2 0" />
      <path d="M16.6 6.4a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
      <path d="M13.6 19a5 5 0 0 1 6.6-2.2" />
    </>
  ),
  enrollment: (
    <>
      <path d="M5 6.5h9M5 12h9M5 17.5h5" />
      <path d="m15.5 15 2 2 4-4.5" />
    </>
  ),
  attendance: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
      <path d="m9 14.5 2 2 4-4" />
    </>
  ),
  assessment: (
    <>
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V8H18M9.5 12.5h6M9.5 16.5h4" />
    </>
  ),
  result: (
    <>
      <path d="M5 20.5V11M12 20.5V4.5M19 20.5v-6" />
      <path d="M3.5 20.5h17" />
    </>
  ),
  invoice: (
    <>
      <path d="M5.5 3.5h13v17l-2.2-1.6-2.2 1.6-2.2-1.6-2.2 1.6-2.2-1.6-2 1.6Z" />
      <path d="M9 8.5h6M9 12.5h6" />
    </>
  ),
  payment: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v.01M18 14.5v.01" />
    </>
  ),
  record: (
    <>
      <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V8H18M8.5 12.5h7M8.5 16.5h5" />
    </>
  ),

  /* --- the interface --------------------------------------------------- */
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  back: (
    <>
      <path d="M20 12H4.5" />
      <path d="m11 5-6.5 7L11 19" />
    </>
  ),
  close: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 4 2.8 20h18.4Z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.01" />
    </>
  ),
  offline: (
    <>
      <path d="M7.5 18.5A4.5 4.5 0 0 1 7 9.6a5.5 5.5 0 0 1 9.6-2.2 4 4 0 0 1 1.9 7.1" />
      <path d="M4 4 20 20" />
    </>
  ),
  sync: (
    <>
      <path d="M4 12a8 8 0 0 1 13.4-5.9L20 8.5" />
      <path d="M20 4.5v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.4 5.9L4 15.5" />
      <path d="M4 19.5v-4h4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4 4.5-4" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20.5v-11" />
      <path d="m7.5 13.5 4.5-4 4.5 4" />
      <path d="M4.5 4.5h15" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.2h5v2.3" />
      <path d="m6.8 6.5 1 13.3h8.4l1-13.3" />
      <path d="M10.5 10v6M13.5 10v6" />
    </>
  ),
  save: (
    <>
      <path d="M5 4.5h11l3 3v12H5Z" />
      <path d="M8.5 4.5v5.5h6.5V4.5" />
      <path d="M8 20v-6h8v6" />
    </>
  ),
  device: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  empty: (
    <>
      <path d="M3.5 13 6 5.5h12L20.5 13v5.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" />
      <path d="M3.5 13H9l1 2.5h4L15 13h5.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5Z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  "chevron-left": <path d="m14.5 6-6 6 6 6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  timetable: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
};

export interface IconProps {
  readonly name: AnyIconName;
  readonly size?: number;
  readonly className?: string;
}

/** Draw an icon. The icon inherits the colour of its surroundings. */
export function Icon({ name, size = 18, className }: IconProps): React.ReactNode {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
